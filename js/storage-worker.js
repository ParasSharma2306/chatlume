/**
 * ChatLume persistent-storage copy worker.
 *
 * Copies an export file into the Origin Private File System in fixed-size
 * chunks so a multi-gigabyte ZIP never has to sit in memory. It runs off the
 * main thread and uses a synchronous access handle, which is the one OPFS write
 * path available across every browser ChatLume supports (createWritable() only
 * reached Safari in 2025).
 *
 * Protocol (main thread → worker):
 *   { type: "copy", file, dirName, tempName, finalName, chunkSize }
 *   { type: "cancel" }
 * Protocol (worker → main thread):
 *   { type: "progress", copied, total }
 *   { type: "done", storedName }
 *   { type: "cancelled" }
 *   { type: "error", name, message }
 *
 * The file is written under `tempName` (a `.part` file) and renamed to
 * `finalName` once its size has been verified. Browsers that can't rename
 * (no FileSystemFileHandle.move(), or one that throws — WebKit exposes the
 * method but rejects it for OPFS files) write straight to `finalName`; in both
 * cases the IndexedDB record written afterwards by the caller is the real
 * commit marker, and any file without one is swept away on the next start-up.
 */

let cancelled = false;

self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "cancel") {
        cancelled = true;
        return;
    }
    if (message.type === "copy") {
        cancelled = false;
        copy(message).catch((error) => {
            self.postMessage({ type: "error", name: error?.name || "Error", message: error?.message || "Copy failed" });
        });
    }
};

/**
 * Whether files in `dir` can actually be renamed. Checked with a throwaway
 * file rather than by feature-sniffing, because a present-but-broken move()
 * would only be discovered after gigabytes had been written.
 */
async function canRenameIn(dir) {
    if (typeof FileSystemFileHandle === "undefined" || typeof FileSystemFileHandle.prototype.move !== "function") {
        return false;
    }
    const probe = `.rename-probe-${Math.random().toString(36).slice(2)}`;
    try {
        const handle = await dir.getFileHandle(probe, { create: true });
        await handle.move(`${probe}.moved`);
        await dir.removeEntry(`${probe}.moved`).catch(() => {});
        return true;
    } catch (error) {
        await dir.removeEntry(probe).catch(() => {});
        return false;
    }
}

async function copy({ file, dirName, tempName, finalName, chunkSize }) {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(dirName, { create: true });
    const canRename = await canRenameIn(dir);
    const writeName = canRename ? tempName : finalName;

    const handle = await dir.getFileHandle(writeName, { create: true });
    let access = null;

    // Early Safari builds return Promises from the access-handle methods that
    // are synchronous everywhere else; awaiting covers both.
    const discard = async () => {
        if (access) {
            try { await access.close(); } catch (error) { /* already closed */ }
            access = null;
        }
        try { await dir.removeEntry(writeName); } catch (error) { /* nothing to remove */ }
    };

    try {
        access = await handle.createSyncAccessHandle();
        await access.truncate(0);

        const total = file.size;
        let offset = 0;
        while (offset < total) {
            if (cancelled) {
                await discard();
                self.postMessage({ type: "cancelled" });
                return;
            }
            const end = Math.min(offset + chunkSize, total);
            // slice() only references the range; arrayBuffer() reads just that chunk.
            const buffer = await file.slice(offset, end).arrayBuffer();
            const written = await access.write(new Uint8Array(buffer), { at: offset });
            if (written !== buffer.byteLength) {
                throw new Error("The browser wrote fewer bytes than expected");
            }
            offset = end;
            self.postMessage({ type: "progress", copied: offset, total });
        }

        await access.flush();
        const storedSize = await access.getSize();
        await access.close();
        access = null;

        if (storedSize !== total) {
            throw new Error("The saved copy does not match the original size");
        }

        if (canRename) {
            await handle.move(finalName);
        }

        self.postMessage({ type: "done", storedName: finalName });
    } catch (error) {
        await discard();
        throw error;
    }
}
