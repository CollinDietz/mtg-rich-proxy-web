/** Browser IndexedDB cache: resolved requests and downloaded images are keyed independently. */
const DATABASE = 'mtg-rich-proxy-web';
const DB_VERSION = 1;
const DAY = 86_400_000;
const fallback = { selections: new Map(), images: new Map() };
let connectionPromise;

async function database() {
  if (!('indexedDB' in globalThis)) return null;
  if (!connectionPromise) {
    connectionPromise = new Promise(resolve => {
      let open;
      try { open = indexedDB.open(DATABASE, DB_VERSION); }
      catch { resolve(null); return; }
      open.onupgradeneeded = () => {
        for (const store of ['selections', 'images']) {
          if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store);
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    });
  }
  return connectionPromise;
}

async function read(store, key) {
  const db = await database();
  if (!db) return fallback[store].get(key) ?? null;
  return new Promise(resolve => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function write(store, key, value) {
  fallback[store].set(key, value);
  const db = await database();
  if (!db) return;
  await new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    } catch { resolve(); }
  });
}

export async function getSelection(key, printingMode) {
  const value = await read('selections', key);
  // Price and latest-printing choices can change; refresh them periodically.
  const ttl = printingMode === 'expensive' ? DAY : 7 * DAY;
  return value && Date.now() - value.savedAt < ttl ? value : null;
}
export async function putSelection(key, card, note = '') {
  await write('selections', key, { card, note, savedAt: Date.now() });
}
export async function getImage(key) { return read('images', key); }
export async function putImage(key, blob) { await write('images', key, blob); }
export async function clearCache() {
  fallback.images.clear(); fallback.selections.clear();
  const db = await database();
  if (!db) return;
  for (const name of ['images', 'selections']) {
    await new Promise(resolve => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
  }
}
