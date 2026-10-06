/** Opt-in local ZIP storage, isolated from WhatsApp records and preferences. */
import * as storage from "../storage.js?v=1.8.6";
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.8.6";
import { readStored, removeStored, writeStored } from "../shared/safe-storage.js?v=1.8.6";
import { igState } from "./state.js?v=1.8.6";
import { writeInstagramSettings } from "./settings.js?v=1.8.6";
import { importsOfKind } from "../shared/import-records.js?v=1.8.6";
import { showToast } from "./ui.js?v=1.8.6";

const USED_KEY = "chatlume-instagram-persist-used";
const LAST_KEY = "chatlume-instagram-last-import";
const hooks = { openImport: null };
let copyJob = null;
let copyingFile = null;
let pendingThread = null;

export async function initInstagramPersistence({ openImport }) {
    hooks.openImport = openImport;
    igState.storageSupported = storage.isSupported();
    const checkbox = $("ig-setting-persistent-storage");
    if (checkbox) {
        checkbox.checked = igState.settings.persistentStorage;
        checkbox.disabled = !igState.storageSupported;
    }
    $("ig-storage-unsupported")?.toggleAttribute("hidden", igState.storageSupported);

    if (!igState.storageSupported || (!igState.settings.persistentStorage && readStored(USED_KEY) !== "1")) return;
    try {
        igState.storedImports = importsOfKind(await storage.reconcileImports(), "instagram");
    } catch (error) {
        console.warn("Instagram stored imports could not be read:", error);
        showToast("Saved Instagram exports couldn't be read right now", "warn");
        return;
    }
    renderInstagramStoredImports();
    if (!igState.settings.persistentStorage) return;

    const lastId = readStored(LAST_KEY);
    const record = igState.storedImports.find((item) => item.id === lastId);
    if (record) await openInstagramStoredImport(record);
}

export function renderInstagramStoredImports() {
    const list = $("ig-storage-list");
    if (!list) return;
    list.innerHTML = igState.storedImports.length
        ? igState.storedImports.map((record) => {
            const title = record.chatTitle || record.fileName || "Instagram export";
            const meta = `${(record.messageCount || 0).toLocaleString()} messages · ${formatBytes(record.size)}`;
            return `<div class="storage-item">
                <div class="storage-item-info"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div>
                <button type="button" class="chat-item" data-ig-stored-open="${escapeAttribute(record.id)}">Open</button>
                <button type="button" class="stored-delete" data-ig-stored-delete="${escapeAttribute(record.id)}" aria-label="Delete ${escapeAttribute(title)}"><i class="ph ph-trash"></i></button>
            </div>`;
        }).join("")
        : `<p class="storage-note">Saved Instagram exports will appear here.</p>`;
    const manage = $("ig-storage-manage");
    if (manage) manage.hidden = !igState.storedImports.length;
}

export async function persistInstagramImport(file, thread) {
    if (!igState.settings.persistentStorage || !igState.storageSupported || !file) return;
    const threadDetails = {
        thread,
        chatTitle: igState.chatTitle,
        messageCount: igState.messageOnlyCount,
        ownerName: igState.myName
    };
    const duplicate = storage.findDuplicate(igState.storedImports, file);
    if (duplicate) {
        await updateStoredThread(duplicate, thread);
        return;
    }
    if (copyJob) {
        if (copyingFile === file) pendingThread = threadDetails;
        else showToast("Another export is still being saved. Try again after it finishes.", "warn");
        return;
    }

    try {
        await storage.requestPersistence();
        const estimate = await storage.estimateStorage();
        if (estimate && estimate.available < storage.requiredSpace(file.size)) {
            showToast("Not enough device storage to save this export", "warn");
            return;
        }
        const id = storage.generateId();
        setStorageStatus("Saving this export on your device…");
        copyingFile = file;
        copyJob = storage.copyFileToStorage(file, id, {
            onProgress(copied, total) { setStorageStatus(`Saving… ${Math.floor((copied / Math.max(1, total)) * 100)}%`); }
        });
        const storedName = await copyJob.promise;
        const savedDetails = pendingThread || threadDetails;
        const record = {
            id,
            kind: "instagram",
            fileName: file.name,
            storedName,
            size: file.size,
            lastModified: file.lastModified,
            chatTitle: savedDetails.chatTitle || "Instagram export",
            messageCount: savedDetails.messageCount,
            ownerName: savedDetails.ownerName,
            threadFolder: savedDetails.thread?.folder || "",
            createdAt: Date.now(),
            lastOpenedAt: Date.now()
        };
        await storage.putImport(record);
        igState.storedImports = storage.sortByRecency([...igState.storedImports, record]);
        igState.activeImportId = id;
        writeStored(USED_KEY, "1");
        writeStored(LAST_KEY, id);
        renderInstagramStoredImports();
        showToast("Instagram export saved on this device");
    } catch (error) {
        if (error?.name !== "AbortError") {
            console.warn("Instagram export could not be saved:", error);
            showToast("Couldn't save this Instagram export", "warn");
        }
    } finally {
        copyJob = null;
        copyingFile = null;
        pendingThread = null;
        setStorageStatus("");
    }
}

async function updateStoredThread(record, thread) {
    const updated = { ...record, chatTitle: igState.chatTitle, messageCount: igState.messageOnlyCount, threadFolder: thread?.folder || "", ownerName: igState.myName, lastOpenedAt: Date.now() };
    await storage.putImport(updated);
    igState.storedImports = storage.sortByRecency(igState.storedImports.map((item) => item.id === record.id ? updated : item));
    igState.activeImportId = record.id;
    writeStored(LAST_KEY, record.id);
    renderInstagramStoredImports();
}

export async function markInstagramImportOpened(thread) {
    const record = igState.storedImports.find((item) => item.id === igState.activeImportId);
    if (!record) return;
    await updateStoredThread(record, thread);
}

async function openInstagramStoredImport(record) {
    try {
        const file = await storage.getImportFile(record);
        igState.restoreImportId = record.id;
        igState.restoreThreadFolder = record.threadFolder || "";
        await hooks.openImport?.(file, record);
    } catch (error) {
        if (storage.isUnrecoverable(error)) {
            await deleteInstagramImport(record.id);
            showToast("That saved export is no longer available", "warn");
        } else {
            showToast("Couldn't open this saved Instagram export", "error");
        }
    }
}

export async function handleInstagramStorageClick(event) {
    const open = event.target.closest("[data-ig-stored-open]");
    if (open) {
        const record = igState.storedImports.find((item) => item.id === open.dataset.igStoredOpen);
        if (record) await openInstagramStoredImport(record);
        return;
    }
    const remove = event.target.closest("[data-ig-stored-delete]");
    if (remove) await deleteInstagramImport(remove.dataset.igStoredDelete);
}

export async function deleteInstagramImport(id) {
    const record = igState.storedImports.find((item) => item.id === id);
    if (!record) return;
    if (!window.confirm(`Delete the saved export “${record.chatTitle || record.fileName}” from this device?`)) return;
    await storage.deleteImport(record);
    igState.storedImports = igState.storedImports.filter((item) => item.id !== id);
    if (readStored(LAST_KEY) === id) removeStored(LAST_KEY);
    if (igState.activeImportId === id) igState.activeImportId = "";
    if (!igState.storedImports.length) removeStored(USED_KEY);
    renderInstagramStoredImports();
}

export async function deleteAllInstagramImports() {
    if (!igState.storedImports.length) return;
    if (!window.confirm(`Delete all ${igState.storedImports.length} saved Instagram export${igState.storedImports.length === 1 ? "" : "s"} from this device?`)) return;
    try {
        await storage.deleteImportsByKind("instagram");
    } catch (error) {
        console.warn("Saved Instagram exports could not be deleted:", error);
        showToast("Couldn't delete saved Instagram exports", "error");
        return;
    }
    igState.storedImports = [];
    igState.activeImportId = "";
    removeStored(LAST_KEY);
    removeStored(USED_KEY);
    renderInstagramStoredImports();
    showToast("Saved Instagram exports deleted");
}

export function handleInstagramStorageSetting(event) {
    igState.settings = writeInstagramSettings({ ...igState.settings, persistentStorage: event.target.checked });
    if (event.target.checked) {
        writeStored(USED_KEY, "1");
        showToast("New Instagram exports can be saved on this device");
    } else {
        cancelInstagramCopy();
        showToast("Storage is off. Existing saved exports remain until deleted.");
    }
}

export function cancelInstagramCopy() {
    copyJob?.cancel();
}

function setStorageStatus(message) {
    const el = $("ig-storage-status");
    if (el) el.textContent = message;
    const cancel = $("ig-storage-cancel");
    if (cancel) cancel.hidden = !message;
}

function formatBytes(bytes = 0) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
