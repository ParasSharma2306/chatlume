/**
 * Messenger ZIP session: reads HTML parts locally, normalizes one selected
 * conversation and releases its archive-backed media when replaced.
 */
import { BlobReader, TextWriter, ZipReader } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { $ } from "../shared/dom.js?v=1.9.0-beta1";
import { assignFileToInput, setupDropTarget, setupGlobalDropZone } from "../shared/drop-zone.js?v=1.9.0-beta1";
import { createThemeController } from "../shared/theme.js?v=1.9.0-beta1";
import { createToast } from "../shared/toast.js?v=1.9.0-beta1";
import { exceedsCompatLimit, fileTooLargeMessage } from "../shared/compat.js?v=1.9.0-beta1";
import { clearMediaStore } from "../shared/media-urls.js?v=1.9.0-beta1";
import { extractMessageRecords, findThreads, folderLabel, normalizeMessages, parseHtmlDocument } from "./parser.js?v=1.9.0-beta1";
import { messengerState } from "./state.js?v=1.9.0-beta1";
import { cleanupMedia, handleMediaClick, lazyMedia, mediaModal } from "./media.js?v=1.9.0-beta1";
import { handleMessageScroll, resetToLatest, scrollToLatest } from "./render.js?v=1.9.0-beta1";
import { showThreadSelector } from "./threads.js?v=1.9.0-beta1";

const toast = createToast("messenger-toast");
const theme = createThemeController({ iconSelector: "#messenger-theme-toggle i" });

function setBusy(busy, title = "Loading export", copy = "Reading the ZIP locally…") {
    messengerState.isLoading = busy;
    const overlay = $("messenger-processing-overlay");
    if (overlay) overlay.hidden = !busy;
    if (title) $("messenger-processing-title").textContent = title;
    if (copy) $("messenger-processing-copy").textContent = copy;
}

function selectFile(file) {
    if (!file) return;
    messengerState.selectedFile = file;
    assignFileToInput($("messenger-file-input"), file);
    $("messenger-selected-file").textContent = file.name;
}

async function openExport() {
    if (messengerState.isLoading) return;
    const file = $("messenger-file-input")?.files?.[0] || messengerState.selectedFile;
    if (!file) { toast("Choose a Facebook Messenger export ZIP first", "warn"); return; }
    if (!file.name.toLowerCase().endsWith(".zip")) { toast("Please select a .zip file", "error"); return; }
    if (exceedsCompatLimit(file)) { toast(fileTooLargeMessage(file), "error"); return; }

    const generation = ++messengerState.loadGeneration;
    ++messengerState.threadGeneration;
    cleanupMedia();
    setBusy(true, "Opening ZIP", "The archive is read only in this browser tab.");
    let reader = null;
    try {
        reader = new ZipReader(new BlobReader(file));
        const entries = await reader.getEntries();
        if (generation !== messengerState.loadGeneration) { reader.close().catch(() => {}); return; }
        messengerState.zipReader = reader;
        messengerState.zipEntries = entries;
        const threads = findThreads(entries);
        if (!threads.length) throw new Error("No message_N.html conversation files were found in this ZIP.");
        messengerState.threads = threads;
        if (threads.length === 1) await loadThread(threads[0]);
        else showThreadSelector(threads, loadThread);
    } catch (error) {
        reader?.close().catch(() => {});
        if (generation === messengerState.loadGeneration) {
            console.error(error);
            cleanupMedia();
            toast(error?.message || "Could not read this Messenger export ZIP", "error");
            $("messenger-upload-panel")?.classList.remove("hidden");
        }
    } finally {
        if (generation === messengerState.loadGeneration) setBusy(false);
    }
}

function resetThread() {
    lazyMedia.disconnect();
    mediaModal.close();
    clearMediaStore(messengerState);
    messengerState.messages = [];
    messengerState.filteredMessages = [];
    messengerState.messageOnlyCount = 0;
    messengerState.mediaCount = 0;
}

export async function loadThread(thread) {
    const generation = ++messengerState.threadGeneration;
    const current = () => generation === messengerState.threadGeneration;
    setBusy(true, "Loading conversation", "Parsing message files locally…");
    resetThread();
    try {
        const records = [];
        const files = [...thread.files];
        for (let partIndex = 0; partIndex < files.length; partIndex++) {
            if (!current()) return;
            $("messenger-processing-copy").textContent = `Parsing file ${partIndex + 1} of ${files.length}…`;
            const html = await files[partIndex].getData(new TextWriter("utf-8"));
            if (!current()) return;
            const document = parseHtmlDocument(html);
            const partNumber = Number(files[partIndex].filename.match(/message_(\d+)\.html$/i)?.[1] || partIndex + 1);
            extractMessageRecords(document).forEach((record, sourceIndex) => records.push({
                ...record, sourcePart: partNumber, sourceIndex, htmlPath: files[partIndex].filename
            }));
        }
        const myName = $("messenger-my-name")?.value.trim() || "";
        const normalized = normalizeMessages(records, {
            conversationKey: thread.folder,
            myName,
            entries: messengerState.zipEntries
        });
        messengerState.messages = normalized.messages;
        messengerState.filteredMessages = normalized.messages;
        messengerState.messageOnlyCount = normalized.messageOnlyCount;
        messengerState.mediaCount = normalized.mediaCount;
        messengerState.mediaStore = normalized.mediaStore;
        messengerState.mediaLookup = normalized.mediaLookup;
        messengerState.chatTitle = thread.title || folderLabel(thread.folder);
        messengerState.myName = myName;

        const senders = [...new Set(records.map((record) => record.sender).filter((name) => name && name !== "Unknown"))];
        $("messenger-upload-panel")?.classList.add("hidden");
        $("messenger-thread-panel")?.classList.add("hidden");
        $("messenger-loaded-panel")?.classList.remove("hidden");
        $("messenger-sidebar-title").textContent = messengerState.chatTitle;
        $("messenger-sidebar-sub").textContent = senders.length ? `Observed senders: ${senders.join(", ")}` : "No sender names found";
        $("messenger-header-name").textContent = messengerState.chatTitle;
        $("messenger-header-meta").textContent = `${messengerState.messageOnlyCount.toLocaleString()} messages${messengerState.mediaCount ? ` · ${messengerState.mediaCount} attachments` : ""}`;
        $("messenger-epoch-note").hidden = false;
        $("messenger-empty-state").hidden = messengerState.messageOnlyCount > 0;
        $("messenger-sidebar")?.classList.remove("active");
        $("messenger-sidebar-backdrop")?.classList.remove("active");
        resetToLatest();
        requestAnimationFrame(scrollToLatest);
        toast(`Loaded ${messengerState.messageOnlyCount.toLocaleString()} messages`);
    } catch (error) {
        if (current()) {
            console.error(error);
            toast(error?.message || "Could not parse this conversation", "error");
        }
    } finally {
        if (current()) setBusy(false);
    }
}

export function initMessengerViewer() {
    theme.applySaved();
    $("messenger-theme-toggle")?.addEventListener("click", () => theme.toggle());
    $("messenger-file-input")?.addEventListener("change", (event) => selectFile(event.target.files?.[0]));
    $("messenger-drop-target")?.addEventListener("click", () => $("messenger-file-input")?.click());
    $("messenger-load-button")?.addEventListener("click", openExport);
    setupDropTarget($("messenger-drop-target"), (files) => selectFile(files[0]));
    setupGlobalDropZone($("messenger-drag-overlay"), selectFile);
    $("messenger-message-list")?.addEventListener("click", handleMediaClick);
    $("messenger-viewport")?.addEventListener("scroll", handleMessageScroll, { passive: true });
    $("messenger-scroll-latest")?.addEventListener("click", scrollToLatest);
    $("messenger-open-list")?.addEventListener("click", () => showThreadSelector(messengerState.threads, loadThread));
    $("messenger-media-modal-close")?.addEventListener("click", mediaModal.close);
    $("messenger-media-modal-backdrop")?.addEventListener("click", mediaModal.close);
    $("messenger-header-menu-toggle")?.addEventListener("click", () => $("messenger-header-menu")?.classList.toggle("open"));
    $("messenger-header-menu")?.addEventListener("click", (event) => {
        if (event.target.closest("[data-change-conversation]")) showThreadSelector(messengerState.threads, loadThread);
    });
    $("messenger-mobile-menu")?.addEventListener("click", () => {
        const open = !$("messenger-sidebar")?.classList.contains("active");
        $("messenger-sidebar")?.classList.toggle("active", open);
        $("messenger-sidebar-backdrop")?.classList.toggle("active", open);
    });
    $("messenger-sidebar-backdrop")?.addEventListener("click", () => {
        $("messenger-sidebar")?.classList.remove("active");
        $("messenger-sidebar-backdrop")?.classList.remove("active");
    });
}
