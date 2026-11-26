/** Opt-in local ZIP storage, isolated from WhatsApp records and preferences. */
import * as storage from "../storage.js?v=1.9.0";
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.9.0";
import { readStored, removeStored, writeStored } from "../shared/safe-storage.js?v=1.9.0";
import { igState } from "./state.js?v=1.9.0";
import { writeInstagramSettings } from "./settings.js?v=1.9.0";
import { popOverlayState } from "../shared/history.js?v=1.9.0";
import { importsOfKind } from "../shared/import-records.js?v=1.9.0";
import { askConfirm, closeAllDrawers, showToast } from "./ui.js?v=1.9.0";
import { display, shownTitle } from "./anonymize.js?v=1.9.0";

/**
 * Saved exports are named after people, so Anonymize mode shows the open one
 * by its anonymized title and the rest by position.
 */
function storedTitle(record) {
    if (display.isOn()) {
        if (record.id === igState.activeImportId && igState.messageOnlyCount) return shownTitle();
        return `Saved export ${igState.storedImports.findIndex((item) => item.id === record.id) + 1}`;
    }
    return record.chatTitle || record.fileName || "Instagram export";
}

const USED_KEY = "chatlume-instagram-persist-used";
const LAST_KEY = "chatlume-instagram-last-import";
const hooks = { openImport: null, closeThread: null };
let copyJob = null;
let copyingFile = null;
let pendingThread = null;

export async function initInstagramPersistence({ openImport, closeThread }) {
    hooks.closeThread = closeThread;
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
            const title = storedTitle(record);
            const meta = `${(record.messageCount || 0).toLocaleString()} messages · ${formatBytes(record.size)}`;
            return `<div class="storage-item">
                <div class="storage-item-info"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div>
                <button type="button" class="stored-open" data-ig-stored-open="${escapeAttribute(record.id)}">Open</button>
                <button type="button" class="stored-delete" data-ig-stored-delete="${escapeAttribute(record.id)}" aria-label="Delete ${escapeAttribute(title)}"><i class="ph ph-trash"></i></button>
            </div>`;
        }).join("")
        : `<p class="storage-note">Saved Instagram exports will appear here.</p>`;
    const sidebarList = $("ig-stored-list");
    if (sidebarList) {
        sidebarList.hidden = !igState.storedImports.length;
        sidebarList.innerHTML = `<div class="stored-list-head"><i class="ph-fill ph-hard-drives"></i> Saved on this device</div>` + igState.storedImports.map((record) => {
            const title = storedTitle(record);
            return `<div class="stored-item${record.id === igState.activeImportId ? " active" : ""}">
                <button type="button" class="chat-item" data-ig-stored-open="${escapeAttribute(record.id)}">
                    <div class="chat-item-avatar ig-avatar-gradient" aria-hidden="true">${escapeHtml([...title][0].toUpperCase())}</div>
                    <div class="chat-item-info"><h4>${escapeHtml(title)}</h4><span>${(record.messageCount || 0).toLocaleString()} messages · ${formatBytes(record.size)}</span></div>
                </button>
                <button type="button" class="stored-delete" data-ig-stored-delete="${escapeAttribute(record.id)}" aria-label="Delete ${escapeAttribute(title)}"><i class="ph ph-trash"></i></button>
            </div>`;
        }).join("");
    }
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
    if (copyingFile) {
        if (copyingFile === file) pendingThread = threadDetails;
        else showToast("Another export is still being saved. Try again after it finishes.", "warn");
        return;
    }

    // Reserved before anything asynchronous, so a second conversation picked
    // during the permission prompt can't start a second copy.
    copyingFile = file;
    try {
        await storage.requestPersistence();
        const estimate = await storage.estimateStorage();
        if (estimate && estimate.quota > 0 && estimate.available < storage.requiredSpace(file.size)) {
            showToast("Not enough device storage to save this export", "warn");
            return;
        }
        const id = storage.generateId();
        setStorageStatus("Saving this export on your device…");
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
        try {
            await storage.putImport(record);
        } catch (error) {
            // No record means no import — don't leave the copy behind.
            await storage.removeStoredFile(storedName);
            throw error;
        }
        igState.storedImports = storage.sortByRecency([...igState.storedImports, record]);
        writeStored(USED_KEY, "1");
        // Another export may have been opened during the copy; it must not
        // inherit this record.
        if (igState.currentFile === file) {
            igState.activeImportId = id;
            writeStored(LAST_KEY, id);
        }
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
            await removeImport(record).catch(() => {});
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
        if (!record || igState.isLoading) return;
        if (closeAllDrawers()) popOverlayState();
        await openInstagramStoredImport(record);
        return;
    }
    const remove = event.target.closest("[data-ig-stored-delete]");
    if (remove) await deleteInstagramImport(remove.dataset.igStoredDelete);
}

export async function deleteInstagramImport(id) {
    const record = igState.storedImports.find((item) => item.id === id);
    if (!record) return;
    const isOpen = igState.activeImportId === id;
    const confirmed = await askConfirm({
        title: "Delete saved export?",
        body: `"${storedTitle(record)}" will be removed from this device.${isOpen ? " It's open right now and will be closed." : ""} Your original export file is not affected.`
    });
    if (!confirmed) return;
    try {
        await removeImport(record);
    } catch (error) {
        console.warn("Saved Instagram export could not be deleted:", error);
        showToast("Couldn't delete this saved export", "error");
        return;
    }
    // Its media is read from the copy that was just deleted.
    if (isOpen) hooks.closeThread?.();
    showToast("Saved export deleted");
}

async function removeImport(record) {
    const { id } = record;
    await storage.deleteImport(record);
    igState.storedImports = igState.storedImports.filter((item) => item.id !== id);
    if (readStored(LAST_KEY) === id) removeStored(LAST_KEY);
    if (igState.activeImportId === id) igState.activeImportId = "";
    if (!igState.storedImports.length) removeStored(USED_KEY);
    renderInstagramStoredImports();
}

export async function deleteAllInstagramImports() {
    if (!igState.storedImports.length) return;
    const count = igState.storedImports.length;
    const isOpen = Boolean(igState.activeImportId);
    const confirmed = await askConfirm({
        title: "Delete all saved exports?",
        body: `${count} saved Instagram export${count === 1 ? "" : "s"} will be removed from this device${isOpen ? ", and the open conversation will be closed" : ""}. Your original export files are not affected.`,
        confirmLabel: "Delete all"
    });
    if (!confirmed) return;
    try {
        await storage.deleteImportsByKind("instagram");
    } catch (error) {
        console.warn("Saved Instagram exports could not be deleted:", error);
        showToast("Couldn't delete saved Instagram exports", "error");
        return;
    }
    igState.storedImports = [];
    if (isOpen) hooks.closeThread?.();
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
