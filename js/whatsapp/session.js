/**
 * ============================================================================
 * Chat session
 * ============================================================================
 * The load pipeline, end to end: take a File (freshly picked or a stored
 * copy), open it (ZIP or plain text), parse it, put the chat on screen and
 * hand it to persistent storage. Also the reverse — closing a chat back to
 * the empty viewer.
 * ============================================================================
 */
import { BlobReader, ZipReader } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { exportChatAsHTML } from "../export.js?v=1.7.1";
import { showSponsorPrompt } from "../support.js?v=1.7.1";
import { $, nextFrame, wait } from "../shared/dom.js?v=1.7.1";
import { exceedsCompatLimit, fileTooLargeMessage } from "../shared/compat.js?v=1.7.1";
import { baseName } from "../shared/media-types.js?v=1.7.1";
import { ISSUES_URL, state } from "./state.js?v=1.7.1";
import { buildMediaStore, cleanupMediaStore, closeMediaModal, lazyMedia } from "./media.js?v=1.7.1";
import { parseChatData, parseChatDataFromEntry } from "./parser.js?v=1.7.1";
import { populateSenderFilter, resetSenderFilterUI } from "./filter.js?v=1.7.1";
import {
    isPersistentStorageEnabled,
    markStoredImportOpened,
    persistCurrentImport,
    renderStoredImports
} from "./persistence.js?v=1.7.1";
import { collectExportMessages, renderChatList, scrollToBottom } from "./render.js?v=1.7.1";
import { setSearchEmptyState, toggleSearch, updateSearchCounter } from "./search.js?v=1.7.1";
import { generateStats } from "./stats.js?v=1.7.1";
import {
    closeMenu,
    isMobileLayout,
    playChatRevealOnce,
    restoreEmptyState,
    setLoadingState,
    setSidebarState,
    setUploadPanelVisible,
    showEmptyState,
    showToast,
    updateLoadingCopy
} from "./ui.js?v=1.7.1";

const HOW_TO_EXPORT_CTA = `<a class="empty-cta" href="how-to-export.html"><i class="ph ph-question"></i> How to export WhatsApp chats</a>`;

/** "Load Chat" button: validates the form, then opens the picked file. */
export async function initViewer() {
    if (state.isLoading) return;

    const fileInput = $("file-input");
    const nameInput = $("display-name");
    const file = fileInput?.files?.[0] || state.selectedFile;
    const displayName = nameInput?.value.trim();

    if (!file) {
        showToast("Please select a file", "warn");
        return;
    }
    if (!displayName) {
        showToast("Enter your display name", "warn");
        return;
    }

    await loadChatFile(file, {
        displayName,
        persist: isPersistentStorageEnabled()
    });
}

/**
 * Opens an export through the normal pipeline. `file` is either the File the
 * user just picked or the on-disk copy handed back by persistent storage — the
 * parser and media layer can't tell the difference.
 *
 * @param {File}   file
 * @param {Object} options
 * @param {string} options.displayName  The user's name in the chat.
 * @param {string} [options.fileLabel]  Original file name, when `file` is a stored copy.
 * @param {boolean} [options.persist]   Copy the export to persistent storage after it opens.
 * @param {string} [options.importId]   Stored import being reopened, if any.
 */
export async function loadChatFile(file, { displayName, fileLabel = file.name, persist = false, importId = "" } = {}) {
    if (state.isLoading) return;

    state.myName = displayName;
    state.activeImportId = "";

    const isZip = file.name.toLowerCase().endsWith(".zip");
    const initText = isZip ? "Opening ZIP and scanning entries..." : "Reading text file...";

    setLoadingState(true, `Loading ${fileLabel}`, initText);

    // Let the overlay paint before the heavy lifting starts.
    await nextFrame();
    await wait(60);

    cleanupMediaStore();
    resetChatState();
    resetSenderFilterUI();
    restoreEmptyState();

    if (isMobileLayout()) {
        setSidebarState(false);
    }

    const gen = ++state.loadGeneration;

    if (exceedsCompatLimit(file)) {
        setLoadingState(false);
        showToast(fileTooLargeMessage(file), "error");
        return;
    }

    try {
        let { rawText, chatEntry, attachments } = await loadChatExport(file);

        updateLoadingCopy(
            attachments.length
                ? `Matched ${attachments.length.toLocaleString()} attachments. Extracting chat...`
                : "Extracting chat..."
        );

        await wait(30);

        buildMediaStore(attachments);
        if (chatEntry) {
            await parseChatDataFromEntry(chatEntry, gen);
        } else {
            await parseChatData(rawText);
            rawText = null; // release large string after parsing
        }

        if (state.messageOnlyCount === 0) {
            showNothingParsedState();
            return;
        }

        updateUIState(fileLabel);
        renderChatList();
        requestAnimationFrame(scrollToBottom);
        showToast(`Loaded ${state.messageOnlyCount.toLocaleString()} messages`);
        showSponsorPrompt();

        if (importId) {
            markStoredImportOpened(importId);
        } else if (persist) {
            persistCurrentImport(file, gen);
        }
    } catch (error) {
        console.error(error);
        const shown = showEmptyState({
            icon: "ph-duotone ph-warning-circle",
            iconColor: "#f5a623",
            title: "Couldn't parse this file",
            body: error.message || "Make sure it's a valid WhatsApp .txt or .zip export.",
            actions: HOW_TO_EXPORT_CTA
        });
        if (!shown) {
            showToast(`Error: ${error.message}`, "error");
        }
    } finally {
        setLoadingState(false);
    }
}

/** The file opened but produced no messages: explain which kind of "no". */
function showNothingParsedState() {
    const { unrecognizedHeaders, unrecognizedSample } = state.parseDiagnostics;
    if (unrecognizedHeaders > 0) {
        // The file is full of timestamp-shaped lines we couldn't read:
        // a date/time format ChatLume doesn't know yet, not a wrong file.
        showEmptyState({
            icon: "ph-duotone ph-calendar-x",
            iconColor: "#f5a623",
            title: "Unrecognised date format",
            body: `This looks like a WhatsApp export, but its timestamps use a format ChatLume can't read yet (${unrecognizedHeaders.toLocaleString()} lines such as "${unrecognizedSample}"). Please report this line so the format can be added.`,
            actions: `<a class="empty-cta" href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer"><i class="ph ph-bug"></i> Report this format</a>`
        });
        showToast("Timestamps in this export use an unsupported format", "error");
        return;
    }
    showEmptyState({
        icon: "ph-duotone ph-file-dashed",
        iconColor: "#f5a623",
        title: "No messages found",
        body: "The file opened, but nothing in it looked like WhatsApp messages. Exports must be plain-text chat exports — not backups or database files.",
        actions: HOW_TO_EXPORT_CTA
    });
    showToast("No messages could be parsed from this export", "error");
}

/**
 * Opens the export. For a ZIP, picks the largest .txt as the chat and lists
 * every other entry as an attachment (nothing is decompressed yet).
 */
async function loadChatExport(file) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
        return { rawText: await readFileAsText(file), chatEntry: null, attachments: [] };
    }

    const reader = new ZipReader(new BlobReader(file));
    state.zipReader = reader;
    const allEntries = await reader.getEntries();

    const entries = allEntries.filter((e) => !e.directory && !e.filename.startsWith("__MACOSX/"));
    const chatEntry = entries
        .filter((e) => e.filename.toLowerCase().endsWith(".txt"))
        .sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];

    if (!chatEntry) {
        throw new Error("No .txt file found in ZIP");
    }

    const attachments = entries
        .filter((e) => e !== chatEntry)
        .map((e) => ({
            name: baseName(e.filename),
            path: e.filename,
            entry: e,
            size: e.uncompressedSize || 0
        }));

    return { rawText: null, chatEntry, attachments };
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(String(event.target?.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
        reader.readAsText(file, "utf-8");
    });
}

/** Returns every per-chat field of `state` to its default. */
export function resetChatState() {
    state.messages = [];
    state.filteredMessages = [];
    state.messageOnlyCount = 0;
    state.selectedSenders = [];
    state.colorMap = {};
    state.senderStats = Object.create(null);
    state.emojiStats = {};
    state.hourlyStats = Array(24).fill(0);
    state.mediaCount = 0;
    state.mediaMissingCount = 0;
    state.searchResults = [];
    state.searchPointer = -1;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    state.inferredDateOrder = "DMY";
    state.parseDiagnostics = { unrecognizedHeaders: 0, unrecognizedSample: "" };
    state.activeMediaId = "";
    lazyMedia.disconnect();
    updateSearchCounter();
    setSearchEmptyState(false);
    if ($("message-list")) $("message-list").innerHTML = "";
    if ($("emoji-grid")) $("emoji-grid").innerHTML = "";
}

/** Puts the loaded chat's name and counts into the sidebar and header. */
function updateUIState(filename) {
    setUploadPanelVisible(false);
    $("empty-state")?.classList.add("hidden");
    playChatRevealOnce();
    // A freshly picked file replaces whichever stored chat was highlighted.
    renderStoredImports();

    state.chatTitle = filename.replace(/(_chat\.txt|WhatsApp Chat with |\.\w+$)/gi, "").trim() || "Chat History";
    const withMedia = state.mediaCount ? ` • ${state.mediaCount.toLocaleString()} media` : "";

    if ($("sidebar-title")) $("sidebar-title").innerText = state.chatTitle;
    if ($("header-name")) $("header-name").innerText = state.chatTitle;
    if ($("header-meta")) $("header-meta").innerText = `${state.messageOnlyCount.toLocaleString()} messages${withMedia}`;
    if ($("sidebar-sub")) $("sidebar-sub").innerText = state.mediaMissingCount
        ? `${state.mediaMissingCount} missing attachment${state.mediaMissingCount === 1 ? "" : "s"}`
        : "Loaded successfully";
    if ($("profile-display-name")) $("profile-display-name").innerText = state.myName || "You";

    ensureExportButton();
    populateSenderFilter();
}

/** Adds "Export HTML" to the header menu the first time a chat opens. */
function ensureExportButton() {
    const menu = $("header-menu");
    if (!menu || $("export-chat-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item";
    btn.id = "export-chat-btn";
    btn.setAttribute("data-export-btn", "");
    btn.title = "Exports text only — media referenced by filename for efficiency";
    btn.innerHTML = '<i class="ph ph-download-simple"></i> Export HTML';
    btn.addEventListener("click", () => {
        closeMenu();
        try {
            const exportedMessages = collectExportMessages();
            const exportedCount = exportedMessages.filter((m) => m.type === "msg").length;
            const isFiltered = Boolean(state.selectedSenders && state.selectedSenders.length > 0);
            const filterSuffix = isFiltered
                ? ` (${state.selectedSenders.length === 1 ? state.selectedSenders[0] : `${state.selectedSenders.length} participants`})`
                : "";
            exportChatAsHTML({
                theme: "whatsapp",
                title: `${state.chatTitle || "WhatsApp Chat"}${filterSuffix}`,
                messageCount: exportedCount,
                messages: exportedMessages
            });
            showToast("Chat exported as HTML");
        } catch (err) {
            console.error("[ChatLume] Export failed:", err);
            showToast("Export failed", "error");
        }
    });
    menu.appendChild(btn);
}

/**
 * Puts the viewer back to its just-opened state. Used when the stored copy
 * behind the open chat is deleted — its media can no longer be read, so
 * keeping the conversation on screen would only half work.
 */
export function closeActiveChat() {
    state.loadGeneration += 1;
    if (state.isSearchOpen) toggleSearch();
    closeMediaModal();
    cleanupMediaStore();
    resetChatState();
    resetSenderFilterUI();
    state.activeImportId = "";
    state.chatTitle = "Chat History";
    restoreEmptyState();
    $("empty-state")?.classList.remove("hidden");
    if ($("header-name")) $("header-name").innerText = "Welcome";
    if ($("header-meta")) $("header-meta").innerText = "ChatLume";
    if ($("sidebar-title")) $("sidebar-title").innerText = "Chat History";
    if ($("sidebar-sub")) $("sidebar-sub").innerText = "Active now";
    // updateUIState() re-creates this on the next load.
    $("export-chat-btn")?.remove();
    generateStats();
    setUploadPanelVisible(true);
}
