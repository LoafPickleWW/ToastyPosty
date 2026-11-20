// ZeroSignal: private, pay-per-request AI on Algorand (https://github.com/TxnLab/zerosignal).
// Runs entirely in this browser tab. Each request is encrypted here, sent to a node through a relay,
// and paid for in USDC from a small "AI wallet" whose key is saved in this browser like the other keys.
//
// Why a separate AI wallet instead of signing with Pera/Defly: ZeroSignal signs every request
// (a raw Ed25519 reserve signature plus the escrow transactions). Browser wallets can't do raw
// signing, and a wallet popup on every caption would be miserable. So the connected wallet
// (via use-wallet) is only used to top the AI wallet up with USDC and a little ALGO.

let vendorP;
const vendor = () => (vendorP ||= import('/js/vendor/zerosignal.js').catch((e) => {
  vendorP = null;
  throw new Error('Couldn’t load ZeroSignal. Run npm install, then restart Toasty Posty. (' + e.message + ')');
}));

// Mainnet only: testnet has too few operators to relay through, so nothing routes there.
const NETWORK = 'mainnet';
export const explorer = (addr) => `https://explorer.perawallet.app/address/${addr}`;

// ---------- the AI wallet (payer key) ----------
export async function newPayer() {
  const { algosdk } = await vendor();
  const acct = algosdk.generateAccount();
  return { mnemonic: algosdk.secretKeyToMnemonic(acct.sk), address: acct.addr.toString() };
}
export async function payerAddress(mnemonic) {
  const { mnemonicSigner } = await vendor();
  return mnemonicSigner(mnemonic).address; // validates the phrase too
}

// ---------- browser storage the SDK keeps (catalog cache, ticket journal) ----------
const safeLS = {
  get: (k) => { try { return localStorage.getItem(k) ?? undefined; } catch { return undefined; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const storage = { get: async (k) => safeLS.get(k), set: async (k, v) => safeLS.set(k, v), delete: async (k) => safeLS.del(k) };

// Open tickets survive a reload, so a request interrupted mid-answer is settled or refunded next visit.
function localJournal(ownsRecord) {
  const KEY = 'toastyposty.zs.journal';
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const replacer = (_, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v instanceof Uint8Array ? { $bytes: b64(v) } : v);
  const reviver = (_, v) => (v && typeof v === 'object' ? ('$bigint' in v ? BigInt(v.$bigint) : '$bytes' in v ? unb64(v.$bytes) : v) : v);
  const load = () => { try { return JSON.parse(safeLS.get(KEY) || '{}', reviver); } catch { return {}; } };
  const update = (fn) => { const all = load(); fn(all); safeLS.set(KEY, JSON.stringify(all, replacer)); return Promise.resolve(); };
  return {
    put: (rec) => update((all) => { all[rec.ticketId] = rec; }),
    delete: (id) => update((all) => { delete all[id]; }),
    list: async (payer, d) => Object.values(load()).filter((r) => r.payer === payer && ownsRecord(d, r)).sort((a, b) => a.createdAt - b.createdAt),
  };
}

// ---------- the client ----------
let current = null; // { key, zs: Promise<Client> }
const zsOf = (ai) => ({ mnemonic: ai.zsMnemonic, network: NETWORK });

async function client(ai) {
  const { mnemonic, network } = zsOf(ai);
  if (!mnemonic) throw new Error('Set up a ZeroSignal AI wallet in Settings first.');
  const key = network + ':' + mnemonic;
  if (current?.key === key) return current.zs;
  if (current) current.zs.then((c) => c.close()).catch(() => {});
  const zsP = (async () => {
    const { Client, mnemonicSigner, ownsRecord } = await vendor();
    return Client.create({ signer: mnemonicSigner(mnemonic), network: { network }, storage, stores: { journal: localJournal(ownsRecord) } });
  })();
  current = { key, zs: zsP };
  zsP.catch(() => { if (current?.zs === zsP) current = null; });
  return zsP;
}
addEventListener('pagehide', () => { current?.zs.then(async (c) => { await c.waitSettles(AbortSignal.timeout(5000)).catch(() => {}); await c.close(); }).catch(() => {}); });

export function forget() {
  if (current) current.zs.then((c) => c.close()).catch(() => {});
  current = null;
}

// The SDK reports failures as OpenAI-shaped error bodies with a code.
const FRIENDLY = {
  wallet_unfunded: 'Your ZeroSignal AI wallet needs USDC (and a little ALGO). Top it up in Settings.',
  payer_not_opted_in: 'Your ZeroSignal AI wallet isn’t set up for payments yet. Top it up in Settings.',
  operators_busy: 'Every ZeroSignal node serving that model is busy. Try again in a minute.',
  no_capacity: 'No ZeroSignal node is serving that model right now. Pick another in Settings.',
};
async function call(ai, path, { method = 'POST', body } = {}) {
  const zs = await client(ai);
  const res = await zs.fetch(zs.baseURL.replace(/\/$/, '') + path.replace(/^\/v1/, ''), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    const err = new Error(FRIENDLY[e.code] || `ZeroSignal: ${e.message || `request failed (${res.status})`}`);
    err.status = res.status;
    err.code = e.code;
    throw err;
  }
  return data;
}

// Models the network routes to right now, with what each can take in and put out.
export async function models(ai) {
  const r = await call(ai, '/v1/models', { method: 'GET' });
  return (r.data || []).map((m) => {
    const ins = m.architecture?.input_modalities || ['text'];
    const outs = m.architecture?.output_modalities || ['text'];
    const per1M = (x) => (x == null ? null : Number(x) * 1e6);
    return {
      id: m.id,
      vision: ins.includes('image'),
      text: outs.includes('text'),
      image: outs.includes('image'),
      inPrice: per1M(m.pricing?.prompt),
      outPrice: per1M(m.pricing?.completion),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// Pull the first JSON object out of a reply, for models that wrap it in prose or a code fence.
function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  throw new Error('ZeroSignal: the model didn’t reply in the expected format. Try again or pick another model.');
}

async function imageDataUrl(blob) {
  if (!blob || !blob.type?.startsWith('image/') || blob.size > 4.5e6) return null;
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
}

// One structured-output chat call: same contract as the server's jsonCall.
export async function jsonCall(ai, { system, prompt, schema, image }) {
  const model = ai.zsTextModel || fail('Pick a ZeroSignal text model in Settings.');
  const url = image ? await imageDataUrl(image) : null;
  const content = [...(url ? [{ type: 'image_url', image_url: { url } }] : []), { type: 'text', text: prompt }];
  // Not every upstream honours json_schema, so the schema is also spelled out in the prompt.
  const sys = `${system}\n\nReply with only a JSON object matching this JSON Schema, no other text:\n${JSON.stringify(schema)}`;
  const body = { model, messages: [{ role: 'system', content: sys }, { role: 'user', content }], response_format: { type: 'json_schema', json_schema: { name: 'toast', strict: true, schema } } };
  let r;
  try {
    r = await call(ai, '/v1/chat/completions', { body });
  } catch (e) {
    if (e.status !== 400 && e.status !== 422) throw e;
    delete body.response_format; // the node's upstream refused structured output; the prompt still asks for JSON
    r = await call(ai, '/v1/chat/completions', { body });
  }
  return parseJSON(r.choices?.[0]?.message?.content || '');
}

export async function generateImage(ai, { prompt, size }) {
  const model = ai.zsImageModel || fail('Pick a ZeroSignal image model in Settings.');
  const r = await call(ai, '/v1/images/generations', { body: { model, prompt, n: 1, size: size || '1024x1024' } });
  const img = r.data?.[0] || fail('ZeroSignal: the node sent no image.');
  if (img.b64_json) return (await fetch(`data:image/png;base64,${img.b64_json}`)).blob();
  if (img.url) return (await fetch(img.url)).blob();
  fail('ZeroSignal: the node sent no image.');
}

// ---------- status: what the AI wallet still needs (no signing, nothing spent) ----------
export async function checkup(ai) {
  const { diagnose, mnemonicSigner } = await vendor();
  const { mnemonic, network } = zsOf(ai);
  const address = mnemonicSigner(mnemonic).address;
  const r = await diagnose({ network: { network }, storage }, address);
  const usdcId = r.checks.find((c) => c.id === 'escrow')?.message.match(/USDC asset (\d+)/)?.[1];
  return { address, network, checks: r.checks, failed: r.failed, usdcAssetId: usdcId ? BigInt(usdcId) : null };
}

// The escrow names the USDC asset it takes, so read it from there once.
const usdcIds = {};
async function usdcAsset(ai) {
  const { network } = zsOf(ai);
  if (usdcIds[network]) return usdcIds[network];
  const { usdcAssetId } = await checkup(ai);
  if (!usdcAssetId) fail('Couldn’t read which USDC the ZeroSignal escrow uses. Check your connection and try again.');
  return (usdcIds[network] = usdcAssetId);
}

// ---------- onboarding: fund with ALGO -> opt in to USDC -> send USDC ----------
const MICRO = 1e6;
export const ALGO_READY = 0.6; // 0.1 to exist + 0.1 to hold USDC + the escrow's first deposit (~0.39) + fees
const OPT_IN_COST = 101_000n; // what holding USDC adds to the minimum balance, plus one fee

// Balances of the AI wallet, straight from algod. Read-only.
export async function balances(ai) {
  const { algosdk } = await vendor();
  const { mnemonic, network } = zsOf(ai);
  const address = algosdk.mnemonicToSecretKey(mnemonic).addr.toString();
  const [usdcAssetId, algod] = await Promise.all([usdcAsset(ai), walletManager(network).then((m) => m.algodClient)]);
  const info = await algod.accountInformation(address).do();
  const holding = (info.assets || []).find((a) => BigInt(a.assetId) === usdcAssetId);
  const amount = BigInt(info.amount ?? 0), minBalance = BigInt(info.minBalance ?? 100_000);
  return {
    address,
    network,
    algo: Number(amount) / MICRO,
    spendableAlgo: Number(amount > minBalance ? amount - minBalance : 0n) / MICRO,
    optedIn: !!holding,
    canOptIn: !holding && amount >= minBalance + OPT_IN_COST,
    usdc: holding ? Number(BigInt(holding.amount)) / MICRO : 0,
    usdcAssetId: String(usdcAssetId),
  };
}

// The AI wallet opts itself in to USDC (a 0-USDC transfer to itself). Needs about 0.2 ALGO in it.
export async function optIn(ai) {
  const { algosdk } = await vendor();
  const { mnemonic, network } = zsOf(ai);
  const b = await balances(ai);
  if (b.optedIn) return { txid: null, already: true };
  if (!b.canOptIn) fail(`The AI wallet needs a little more ALGO first: it has ${b.algo} ALGO, and opting in needs about 0.2.`);
  const payer = algosdk.mnemonicToSecretKey(mnemonic);
  const algod = (await walletManager(network)).algodClient;
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: b.address, receiver: b.address, assetIndex: BigInt(b.usdcAssetId), amount: 0, suggestedParams: sp });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(payer.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 8);
  return { txid };
}

// ---------- use-wallet: fund the AI wallet from Pera, Defly or Lute ----------
let manager = null;
async function walletManager(network = NETWORK) {
  const v = await vendor();
  if (manager && manager.activeNetwork !== network) await manager.setActiveNetwork(network);
  if (!manager) {
    manager = new v.WalletManager({
      wallets: [v.pera(), v.defly(), v.lute({ siteName: 'Toasty Posty' })],
      defaultNetwork: network,
    });
    await manager.resumeSessions().catch(() => {});
  }
  return manager;
}
export async function wallets() {
  const m = await walletManager();
  return {
    list: m.wallets.map((w) => ({ id: w.id, name: w.metadata.name, icon: w.metadata.icon, active: w.isActive, connected: w.isConnected })),
    address: m.activeAddress,
  };
}
export async function connectWallet(id) {
  const m = await walletManager();
  const w = m.getWallet(id) || fail('That wallet isn’t available.');
  await w.connect();
  w.setActive?.();
  return m.activeAddress;
}
export async function disconnectWallet() {
  const m = await walletManager();
  await m.activeWallet?.disconnect();
}

// One atomic group from the connected wallet to the AI wallet: ALGO for fees and the escrow's
// prepaid box pool, the AI wallet's USDC opt-in (signed here) if it has none, then the USDC.
export async function topUp(ai, { usdc, algo }) {
  const v = await vendor();
  const { algosdk } = v;
  const { mnemonic, network } = zsOf(ai);
  const m = await walletManager(network);
  const from = m.activeAddress || fail('Connect a wallet first.');
  const payer = algosdk.mnemonicToSecretKey(mnemonic);
  const to = payer.addr.toString();
  const algod = m.algodClient;
  const usdcAssetId = await usdcAsset(ai);
  const usdcMicro = BigInt(Math.round(Number(usdc || 0) * 1e6));
  const algoMicro = BigInt(Math.round(Number(algo || 0) * 1e6));
  if (usdcMicro <= 0n && algoMicro <= 0n) fail('Enter an amount of USDC or ALGO to send.');

  const info = await algod.accountInformation(to).do();
  const optedIn = (info.assets || []).some((a) => BigInt(a.assetId) === usdcAssetId);
  const sp = await algod.getTransactionParams().do();
  const txns = [], mine = [];
  if (algoMicro > 0n || !optedIn) {
    // A new account needs 0.1 ALGO to exist plus 0.1 to hold USDC; make sure the first top-up covers it.
    const floor = optedIn ? 0n : 210_000n;
    txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, amount: algoMicro > floor ? algoMicro : floor, suggestedParams: sp }));
  }
  if (!optedIn) {
    mine.push(txns.length);
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: to, receiver: to, assetIndex: usdcAssetId, amount: 0, suggestedParams: sp }));
  }
  if (usdcMicro > 0n) txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, assetIndex: usdcAssetId, amount: usdcMicro, suggestedParams: sp }));
  if (txns.length > 1) algosdk.assignGroupID(txns);

  const theirs = txns.map((_, i) => i).filter((i) => !mine.includes(i));
  const signed = await m.signTransactions(txns, theirs);
  const blobs = txns.map((t, i) => (mine.includes(i) ? t.signTxn(payer.sk) : signed[i]));
  if (blobs.some((b) => !b)) fail('The wallet didn’t sign the top-up.');
  const { txid } = await algod.sendRawTransaction(blobs).do();
  await algosdk.waitForConfirmation(algod, txid, 8);
  forget(); // the next request re-reads the balance
  return { txid };
}

function fail(msg) { throw new Error(msg); }
