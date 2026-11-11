// Step-by-step guides for getting API keys on each platform.
// Platform dashboards change often; if a button moved, the idea is the same. PRs welcome.
const PORT = location.port || '4848';
const LOCAL = `http://127.0.0.1:${PORT}`;

export const GUIDES = {
  bluesky: {
    title: 'Bluesky App Password',
    time: '2 min',
    pickles: 1,
    cost: 'Free',
    ingredients: ['A Bluesky account', 'Your full handle (e.g. you.bsky.social or your custom domain)'],
    steps: [
      'Open <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener">bsky.app → Settings → Privacy and security → App passwords</a>.',
      'Click <b>Add App Password</b>, name it <code>Toasty Posty</code>. Leave “Allow access to your direct messages” <b>off</b>.',
      'Copy the password that looks like <code>xxxx-xxxx-xxxx-xxxx</code>. You only see it once.',
      'Paste your handle and that App Password here. Leave PDS URL blank unless you self-host a PDS.',
    ],
    notes: ['Never use your real Bluesky password here. App Passwords can be revoked any time from the same screen.', 'Images must be under 1MB; Toasty Posty shrinks big photos automatically when you upload them.'],
  },

  x: {
    title: 'X (Twitter) API keys',
    time: '10 min',
    pickles: 3,
    cost: 'Free tier posts a small monthly quota; reading feeds needs paid credits',
    ingredients: ['An X account', 'A developer account at developer.x.com', 'One Project + App'],
    steps: [
      'Go to <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noopener">developer.x.com</a> and sign up for developer access (the free option is enough to post).',
      'In the dashboard, open your default <b>Project → App</b> (or create one).',
      'Under <b>User authentication settings</b> click <b>Set up</b>. Set <b>App permissions</b> to <b>Read and write</b>, type <b>Web App, Automated App or Bot</b>. For Callback URI use <code>' + LOCAL + '/callback</code> and any website URL you own. Save.',
      'Open the <b>Keys and tokens</b> tab. Under <b>Consumer Keys</b>, click <b>Regenerate</b> and copy the <b>API Key</b> and <b>API Key Secret</b>.',
      'Under <b>Authentication Tokens → Access Token and Secret</b>, click <b>Generate</b>. It must say <b>“Created with Read and Write permissions.”</b> If it says Read only, redo step 3, then regenerate these.',
      'Paste all four values here.',
    ],
    notes: ['X changes its API pricing often. Posting works on the free/entry options; timelines and search on the Feeds page usually need paid access.', 'Images only for now (up to 4). Video uploads are on the to-do list.'],
  },

  reddit: {
    title: 'Reddit script app',
    time: '5 min (+ approval wait)',
    pickles: 2,
    cost: 'Free for personal use',
    ingredients: ['A Reddit account you want to post from', 'API access approval from Reddit (new apps need it)'],
    steps: [
      'Reddit now asks developers to request API access before new apps work. Read <a href="https://www.reddit.com/wiki/api" target="_blank" rel="noopener">Reddit’s API rules</a> and, if prompted when creating the app, request access for a personal posting tool.',
      'While logged in as the posting account, open <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener">reddit.com/prefs/apps</a> and click <b>create another app…</b>',
      'Name: <code>Toasty Posty</code>. Choose <b>script</b>. Redirect URI: <code>' + LOCAL + '</code> (not used, but required). Click <b>create app</b>.',
      'The <b>Client ID</b> is the short string right under “personal use script”. The <b>secret</b> is labelled <b>secret</b>.',
      'Paste those plus your Reddit username and password. Script apps only work for the account that created them.',
      'Optional: set a default subreddit. Use <code>u_yourname</code> to post to your own profile.',
    ],
    notes: ['Accounts with two-factor auth: the script login needs <code>password:123456</code> (your current 6-digit code), which expires. A dedicated posting account without 2FA is simplest.', 'Each subreddit has its own rules on self-promotion, flair, and account age. The receipt will show Reddit’s exact complaint if a post is rejected.', 'Supports text, link (body is only a URL), and single-image posts.'],
  },

  instagram: {
    title: 'Instagram Graph API token',
    time: '15 min',
    pickles: 4,
    cost: 'Free',
    ingredients: ['An Instagram <b>professional</b> account (Business or Creator)', 'A Meta developer account', 'A public https URL for your media (a free tunnel works)'],
    steps: [
      'In the Instagram app: <b>Settings → Account type and tools → Switch to professional account</b> (Creator or Business). Free and reversible.',
      'Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> → <b>Create app</b>. Pick the use case for managing content on Instagram (Instagram API), type <b>Business</b>.',
      'In the app dashboard open <b>Instagram → API setup with Instagram login</b>.',
      'Under <b>Generate access tokens</b>, click <b>Add account</b> and log into your Instagram. Make sure the permissions include <code>instagram_business_basic</code> and <code>instagram_business_content_publish</code>.',
      'Click <b>Generate token</b> and copy it (starts with <code>IGAA…</code>). It lasts ~60 days; hit <b>Refresh token</b> on the Accounts page every month or so.',
      'Instagram downloads your photos from a URL. On Vercel, connect a <b>Blob</b> store to your project (Storage → Blob) and you’re done. Self-hosted: install <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" rel="noopener">cloudflared</a> and run <code>cloudflared tunnel --url ' + LOCAL + '</code>. Paste the <code>https://….trycloudflare.com</code> URL into <b>Settings → Public URL</b>.',
    ],
    notes: ['Each photo is put at a public address right before posting and removed once Instagram has fetched it. Self-hosted, only those files and the TikTok login page are reachable through your tunnel.', 'While your Meta app is in development mode it can only post for accounts that have a role on the app. That’s fine for your own accounts.', 'Instagram caps API publishing at around 100 posts per 24 hours. Photos must be JPEG; Toasty Posty converts uploads for you. Videos post as Reels.'],
  },

  tiktok: {
    title: 'TikTok Content Posting API',
    time: '20 min (+ review for public posts)',
    pickles: 5,
    cost: 'Free',
    ingredients: ['A TikTok account', 'A TikTok for Developers account', 'An https address for the login redirect (your Vercel site, or a stable tunnel when self-hosted)'],
    steps: [
      'Sign in at <a href="https://developers.tiktok.com/" target="_blank" rel="noopener">developers.tiktok.com</a> → <b>Manage apps → Connect an app</b>. Fill in the name, icon, description, terms and privacy URLs.',
      'Add products: <b>Login Kit</b>, <b>Content Posting API</b> (turn on <b>Direct Post</b>), and <b>Display API</b> (for the Feeds page).',
      'Scopes: <code>user.info.basic</code>, <code>video.publish</code>, <code>video.upload</code>, <code>video.list</code>.',
      'In Login Kit, add the Redirect URI: <code>https://&lt;your-site&gt;.vercel.app/oauth-tiktok</code> if you use the hosted version. Self-hosted, use <code>&lt;your Public URL&gt;/oauth-tiktok</code>; TikTok only accepts https, so the tunnel needs a <b>stable</b> hostname (a named Cloudflare tunnel or an ngrok static domain).',
      'Use the <b>Sandbox</b> to add your own account as a target user, or submit the app for review.',
      'Copy the <b>Client key</b> and <b>Client secret</b> here, save, then click <b>Authorize with TikTok</b> on the account.',
    ],
    notes: ['Until TikTok audits your app, every post is forced to <b>Only me</b> (private). You can flip it public inside TikTok afterwards.', 'Photo posts are pulled from your Public URL and that domain must be verified in the app’s URL properties. Videos are uploaded directly and don’t need it.', 'Already have tokens from another tool? Paste the access + refresh token instead of using Authorize.'],
  },
};

export function guide(pid, h) {
  const g = GUIDES[pid];
  if (!g) return null;
  return h('div.guide',
    h('div.guide-meta',
      h('span.pill.plain', '⏱ ' + g.time),
      h('span.pill.plain', { title: 'Difficulty' }, 'Difficulty ' + '●'.repeat(g.pickles) + '○'.repeat(5 - g.pickles)),
      h('span.pill.plain', g.cost)),
    h('h4', 'You’ll need'),
    h('ul', g.ingredients.map((i) => h('li', { html: i }))),
    h('h4', 'Steps'),
    h('ol', g.steps.map((s) => h('li', h('div', { html: s })))),
    h('h4', 'Good to know'),
    g.notes.map((n) => h('div.tip', { html: n })));
}
