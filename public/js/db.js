// Tiny IndexedDB wrapper. Everything Toasty Posty saves lives here, in this browser.
const NAME = 'toasty-posty';
let dbp;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('This browser blocked local storage. Private windows sometimes do.'));
  });
  return dbp;
}

// Resolves once the write is committed to disk.
async function write(store, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    fn(t.objectStore(store));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was aborted (is the disk full?).'));
  });
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const get = async (key) => req((await open()).transaction('kv').objectStore('kv').get(key));
export const set = (key, value) => write('kv', (s) => s.put(value, key));
export const getMedia = async (id) => req((await open()).transaction('media').objectStore('media').get(id));
export const putMedia = (id, blob) => write('media', (s) => s.put(blob, id));
export const delMedia = (id) => write('media', (s) => s.delete(id));
export async function allMedia() {
  const s = (await open()).transaction('media').objectStore('media');
  const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
  return keys.map((k, i) => [k, vals[i]]);
}

// Ask the browser not to clear our storage when space runs low.
export const persist = () => navigator.storage?.persist?.().catch(() => false);
