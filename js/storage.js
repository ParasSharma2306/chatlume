/**
 * ChatLume persistent storage (Beta).
 *
 * Keeps imported exports on the device so they don't have to be picked again
 * after ChatLume is closed. Everything stays inside the browser's origin
 * sandbox — nothing here talks to the network.
 *
 * Layout:
 *   OPFS       imports/<id>.zip|txt   the original export, byte-for-byte,
 *                                     never extracted (media stays inside the
 *                                     ZIP and is range-read on demand exactly
 *                                     like a freshly picked file)
 *   IndexedDB  chatlume-imports       one small metadata record per import
 *   localStorage                      the last-opened pointer (owned by the viewer)
 *
 * The IndexedDB record is the commit marker: an OPFS file without a record is
 * an interrupted copy and gets removed by reconcileImports() on start-up; a
 * record without a file is dropped the same way.
 */

const DB_NAME = "chatlume-imports";
const DB_VERSION = 1;
const STORE_NAME = "imports";
const OPFS_DIR = "imports";
const CHUNK_SIZE = 16 * 1024 * 1024;
/** Headroom kept free after a copy so the browser isn't pushed to its quota edge. */
const QUOTA_MARGIN = 64 * 1024 * 1024;
/**
 * A file without a record is normally an interrupted copy — unless another tab
 * finished writing it moments ago and hasn't committed its record yet. Files
 * modified more recently than this are left alone; older ones are swept.
 */
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

function isNotFound(error) {
    return error?.name === "NotFoundError";
}

function storageError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
}

/**
 * Whether this browser can keep imports. Checked from the main thread, so the
 * worker-only createSyncAccessHandle() can't be probed here — if it turns out to
 * be missing the copy fails and the caller reports it as unsupported.
 */
export function isSupported() {
    return typeof indexedDB !== "undefined"
        && typeof Worker !== "undefined"
        && typeof FileSystemFileHandle !== "undefined"
        && typeof navigator.storage?.getDirectory === "function"
        && window.isSecureContext === true;
}

export function generateId() {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** OPFS file name for an import; keeps the extension so the viewer's ZIP/TXT detection still works. */
export function storedFileName(id, originalName) {
    const ext = /\.zip$/i.test(originalName || "") ? "zip" : "txt";
    return `${id}.${ext}`;
}

// ── IndexedDB ────────────────────────────────────────────────────────────────

let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            // A later version opened in another tab closes this one; drop the
            // cached promise so the next call reopens instead of failing forever.
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        request.onerror = () => reject(request.error || new Error("Unable to open storage"));
        request.onblocked = () => reject(new Error("Storage is blocked by another tab"));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Storage request failed"));
    });
}

async function withStore(mode, run) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error("Storage transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
        Promise.resolve(run(store)).then((value) => { result = value; }).catch(reject);
    });
}

export function listImports() {
    return withStore("readonly", (store) => requestToPromise(store.getAll()))
        .then((records) => (records || []).filter((record) => record && record.id));
}

export function putImport(record) {
    return withStore("readwrite", (store) => requestToPromise(store.put(record))).then(() => record);
}

function removeImportRecord(id) {
    return withStore("readwrite", (store) => requestToPromise(store.delete(id)));
}

// ── OPFS ─────────────────────────────────────────────────────────────────────

async function getImportsDirectory(create = true) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR, { create });
}

/** Removes one stored file; silently succeeds when it (or the directory) is already gone. */
export async function removeStoredFile(name) {
    try {
        const dir = await getImportsDirectory(false);
        await dir.removeEntry(name);
    } catch (error) {
        // Already gone, or the directory was never created.
    }
}

/**
 * Returns the stored export as a File backed by the on-disk copy. Only the
 * ranges the viewer asks for are read, so this is as cheap as picking the
 * original. Throws a NotFoundError when the file is missing and a
 * SizeMismatchError when it no longer matches the record — only those two mean
 * the import is genuinely unusable; anything else is a transient failure and
 * the stored data must be left alone.
 */
export async function getImportFile(record) {
    const dir = await getImportsDirectory(false);
    const handle = await dir.getFileHandle(record.storedName);
    const file = await handle.getFile();
    if (file.size !== record.size) {
        throw storageError("SizeMismatchError", "The stored copy is incomplete");
    }
    return file;
}

/** True for the two errors that mean a stored import is beyond saving. */
export function isUnrecoverable(error) {
    return isNotFound(error) || error?.name === "SizeMismatchError";
}

/**
 * Brings the metadata and the files back in line after an interrupted copy or
 * a partially failed delete:
 *   - files without a record were never committed (or are `.part` leftovers);
 *     the very recent ones may belong to another tab mid-commit and are kept
 *   - records whose file is missing or the wrong size point at nothing usable
 * Anything unexpected — the directory listing failing, a file refusing to be
 * read — aborts rather than guesses: a transient error must never be mistaken
 * for "the data is gone". Returns the surviving imports, most recently opened
 * first.
 */
export async function reconcileImports() {
    const records = await listImports();
    const byStoredName = new Map(records.map((record) => [record.storedName, record]));
    const seen = new Set();

    let dir = null;
    try {
        dir = await getImportsDirectory(false);
    } catch (error) {
        // No directory at all means no files — every record is stale. Any
        // other failure is the storage layer misbehaving; leave everything as is.
        if (!isNotFound(error)) throw error;
    }

    if (dir) {
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== "file") continue;
            const record = byStoredName.get(name);

            let file;
            try {
                file = await handle.getFile();
            } catch (error) {
                // Can't tell what state it's in — keep the file and its record.
                if (record) seen.add(name);
                continue;
            }

            if (!record) {
                if (Date.now() - file.lastModified < ORPHAN_GRACE_MS) continue;
                await removeStoredFile(name);
                continue;
            }
            if (file.size !== record.size) {
                await removeStoredFile(name);
                continue;
            }
            seen.add(name);
        }
    }

    const valid = [];
    for (const record of records) {
        if (seen.has(record.storedName)) {
            valid.push(record);
        } else {
            await removeImportRecord(record.id);
        }
    }

    return sortByRecency(valid);
}

export function sortByRecency(records) {
    return [...records].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}

/**
 * Chunked copy of `file` into OPFS, run in a worker. Resolves with the stored
 * file name. Rejects with an Error whose `name` is "AbortError" when cancelled
 * or "QuotaExceededError" when the browser refuses more space.
 */
export function copyFileToStorage(file, id, { onProgress } = {}) {
    const finalName = storedFileName(id, file.name);
    const tempName = `${finalName}.part`;

    let worker = null;
    let settled = false;
    const promise = new Promise((resolve, reject) => {
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            worker?.terminate();
            fn(value);
        };
        const fail = (name, message) => finish(reject, storageError(name, message));

        // A blocked or missing worker script must surface as a normal failure,
        // not as an exception thrown out of the caller's await chain.
        try {
            worker = new Worker(new URL("./storage-worker.js?v=1.6.1", import.meta.url));
        } catch (error) {
            fail(error?.name || "Error", error?.message || "The storage worker could not be started");
            return;
        }

        worker.onmessage = (event) => {
            const message = event.data || {};
            if (message.type === "progress") {
                onProgress?.(message.copied, message.total);
            } else if (message.type === "done") {
                finish(resolve, message.storedName);
            } else if (message.type === "cancelled") {
                fail("AbortError", "Save cancelled");
            } else if (message.type === "error") {
                fail(message.name || "Error", message.message || "Copy failed");
            }
        };
        worker.onerror = (event) => {
            event.preventDefault?.();
            fail("Error", event.message || "The storage worker failed");
        };

        worker.postMessage({ type: "copy", file, dirName: OPFS_DIR, tempName, finalName, chunkSize: CHUNK_SIZE });
    });

    const cancel = () => {
        if (settled || !worker) return;
        worker.postMessage({ type: "cancel" });
    };

    return { promise, cancel };
}

export async function deleteImport(record) {
    // Record first: once the commit marker is gone nothing can treat the file as
    // a valid import, and a leftover file is swept on the next start-up.
    await removeImportRecord(record.id);
    await removeStoredFile(record.storedName);
}

export async function deleteAllImports() {
    const records = await listImports();
    for (const record of records) {
        await deleteImport(record);
    }
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(OPFS_DIR, { recursive: true });
    } catch (error) {
        // Nothing left to remove.
    }
}

// ── Quota ────────────────────────────────────────────────────────────────────

export async function estimateStorage() {
    if (typeof navigator.storage?.estimate !== "function") return null;
    try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { usage, quota, available: Math.max(0, quota - usage) };
    } catch (error) {
        return null;
    }
}

/** Space needed to keep `size` bytes with some headroom. */
export function requiredSpace(size) {
    return size + QUOTA_MARGIN;
}

/**
 * Asks the browser not to evict this origin under storage pressure. Firefox
 * shows a prompt, so it is skipped once persistence has already been granted.
 * Must run before estimate(): Firefox reports its small best-effort quota until
 * persistence is on.
 */
export async function requestPersistence() {
    if (typeof navigator.storage?.persist !== "function") return false;
    try {
        if (typeof navigator.storage.persisted === "function" && await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch (error) {
        return false;
    }
}

/** Same name, size and modification time is as good as the same file — no need to hash gigabytes. */
export function findDuplicate(records, file) {
    return records.find((record) =>
        record.fileName === file.name
        && record.size === file.size
        && record.lastModified === file.lastModified
    ) || null;
}
