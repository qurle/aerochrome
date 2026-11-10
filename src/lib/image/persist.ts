// Keeps the user's photo across reloads of the same tab, like the Tweak values:
// the file itself goes to IndexedDB (sessionStorage only holds a few MB of
// strings), keyed by an id that lives in sessionStorage. Closing the tab drops
// the id; photos no tab can claim any more are deleted on a later visit.

const DB_NAME = 'aerochrome';
const STORE = 'photos';
const TAB_KEY = 'aerochrome:tab';
/** Set once this tab has stored a photo, so startup can restore it right away. */
const SAVED_KEY = 'aerochrome:photo';
/** Entries of other tabs older than this are treated as abandoned. */
const STALE_MS = 2 * 24 * 60 * 60 * 1000;

interface Entry { file: File; saved: number }

function tabId() {
  let id = sessionStorage.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, id);
  }
  return id;
}

let db: Promise<IDBDatabase> | null = null;
function open() {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { db = null; throw e; });
  return db;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const store = (await open()).transaction(STORE, mode).objectStore(STORE);
  return new Promise<T | undefined>((resolve, reject) => {
    const req = fn(store);
    if (!req) { store.transaction.oncomplete = () => resolve(undefined); store.transaction.onerror = () => reject(store.transaction.error); return; }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Remember the photo for this tab. Failures (private mode, quota) are ignored. */
export async function savePhoto(file: File) {
  try {
    await run('readwrite', (s) => s.put({ file, saved: Date.now() } satisfies Entry, tabId()));
    sessionStorage.setItem(SAVED_KEY, '1');
  } catch { /* no storage: reloads start over */ }
}

const PLACEHOLDER_KEY = 'aerochrome:placeholder';
/** A tiny dithered frame of the photo as last seen, shown while a reload restores it. */
export interface Placeholder { src: string; aspect: number }

export function savePlaceholder(p: Placeholder) {
  try { sessionStorage.setItem(PLACEHOLDER_KEY, JSON.stringify(p)); } catch { /* full or unavailable */ }
}

export function loadPlaceholder(): Placeholder | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PLACEHOLDER_KEY) ?? 'null');
    return p && typeof p.src === 'string' && p.aspect > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Whether this tab stored a photo before (a reload should restore it first thing). */
export function hasSavedPhoto() {
  try { return sessionStorage.getItem(SAVED_KEY) === '1'; } catch { return false; }
}

/** This tab's photo, if it had one; also clears out abandoned photos of closed tabs. */
export async function loadPhoto(): Promise<File | null> {
  try {
    const id = tabId();
    const entry = await run<Entry>('readonly', (s) => s.get(id));
    void prune(id);
    return entry?.file ?? null;
  } catch {
    return null;
  }
}

async function prune(keep: string) {
  try {
    const keys = (await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? [];
    const now = Date.now();
    for (const k of keys) {
      if (k === keep) continue;
      const e = await run<Entry>('readonly', (s) => s.get(k));
      if (!e || now - e.saved > STALE_MS) await run('readwrite', (s) => { s.delete(k); });
    }
  } catch { /* best effort */ }
}
