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
import { exportChatAsHTML } from "../export.js?v=1.10.0";
import { showSponsorPrompt } from "../support.js?v=1.10.0";
import { $, nextFrame, wait } from "../shared/dom.js?v=1.10.0";
import { exceedsCompatLimit, fileTooLargeMessage } from "../shared/compat.js?v=1.10.0";
import { inferOwner, renderIdentitySelect } from "../shared/identity.js?v=1.10.0";
import { initialsFor } from "../shared/text.js?v=1.10.0";
import { loadZip } from "../shared/zip.js?v=1.10.0";
import { baseName } from "../shared/media-types.js?v=1.10.0";
import { clearSelectedFile } from "./file-picker.js?v=1.10.0";
import { ISSUES_URL, state } from "./state.js?v=1.10.0";
import { display, shownTitle, syncAnonymizeControls } from "./anonymize.js?v=1.10.0";
import { buildMediaStore, cleanupMediaStore, closeMediaModal, lazyMedia } from "./media.js?v=1.10.0";
import { gallery } from "./gallery.js?v=1.10.0";
import { isMeSender, parseChatData, parseChatDataFromEntry } from "./parser.js?v=1.10.0";
import { getChatSenders, populateSenderFilter, resetSenderFilterUI } from "./filter.js?v=1.10.0";
import {
    isPersistentStorageEnabled,
    markStoredImportOpened,
    persistCurrentImport,
    renderStoredImports
} from "./persistence.js?v=1.10.0";
import { collectExportMessages, renderChatList, scrollToBottom } from "./render.js?v=1.10.0";
import { setSearchEmptyState, toggleSearch, updateSearchCounter } from "./search.js?v=1.10.0";
import { generateStats } from "./stats.js?v=1.10.0";
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
} from "./ui.js?v=1.10.0";

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
    // Checked first: a file that can't open shouldn't cost the open chat.
    if (exceedsCompatLimit(file)) {
        showToast(fileTooLargeMessage(file), "error");
        return;
    }

    // A search left open would highlight and count against the old chat.
    if (state.isSearchOpen) toggleSearch();
    state.myName = displayName || "";
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
            resetChatChrome();
            showNothingParsedState();
            return;
        }

        state.chatTitle = chatTitleFromFile(fileLabel);
        // Typed a name nobody in the chat has, or none at all: work it out from
        // a one-to-one chat, else say where to choose.
        const owner = state.messages.some((item) => item.isMe) || state.myName
            ? ""
            : inferOwner(getChatSenders(), state.chatTitle);
        if (owner) applyOwner(owner);

        updateUIState();
        clearSelectedFile();
        renderChatList();
        scrollToBottom();
        const loaded = `Loaded ${state.messageOnlyCount.toLocaleString()} messages`;
        if (state.messages.some((item) => item.isMe)) showToast(loaded);
        else showToast(`${loaded}. Choose which participant is you in Settings.`, "info");
        showSponsorPrompt();

        if (importId) {
            markStoredImportOpened(importId);
        } else if (persist) {
            persistCurrentImport(file, gen);
        }
    } catch (error) {
        console.error(error);
        // A parse that failed half-way must not leave the old title on screen
        // or a partial chat behind it.
        cleanupMediaStore();
        resetChatState();
        resetChatChrome();
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

    const { BlobReader, ZipReader } = await loadZip();
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
    state.flashMessageId = "";
    gallery.reset();
    lazyMedia.disconnect();
    updateSearchCounter();
    setSearchEmptyState(false);
    if ($("message-list")) $("message-list").innerHTML = "";
    if ($("emoji-grid")) $("emoji-grid").innerHTML = "";
}

/** "WhatsApp Chat with Jane.txt" (Android) / "WhatsApp Chat - Jane.zip" (iOS) → "Jane". */
function chatTitleFromFile(filename) {
    return filename
        .replace(/\.\w+$/, "")
        .replace(/^_chat$/i, "")
        .replace(/^WhatsApp Chat (?:with|-) /i, "")
        .trim() || "Chat History";
}

/** Marks `name`'s messages as the reader's own, without reparsing. */
function applyOwner(name) {
    state.myName = name;
    state.messages.forEach((item) => {
        if (item.type === "msg") item.isMe = isMeSender(item.sender);
    });
}

/** "You in this chat" in Settings. `name` is the select's value (an alias in Anonymize mode). */
export function setChatOwner(value) {
    if (!state.messageOnlyCount) return;
    const name = value ? display.realName(value) : "";
    applyOwner(name);
    populateSenderFilter();
    refreshProfileName();
    renderChatList();
    if (state.activeImportId) markStoredImportOpened(state.activeImportId);
    showToast(name ? `Showing ${display.name(name)}'s messages as yours` : "No participant is marked as you");
}

/** In Anonymize mode the profile just says "You": it is the reader's own view. */
function refreshProfileName() {
    if ($("profile-display-name")) $("profile-display-name").innerText = display.isOn() ? "You" : (state.myName || "You");
}

/** Puts the loaded chat's name and counts into the sidebar and header. */
function updateUIState() {
    setUploadPanelVisible(false);
    $("empty-state")?.classList.add("hidden");
    playChatRevealOnce();
    // A freshly picked file replaces whichever stored chat was highlighted.
    renderStoredImports();

    document.querySelectorAll("[data-export-btn]").forEach((button) => { button.hidden = false; });
    const withMedia = state.mediaCount ? ` • ${state.mediaCount.toLocaleString()} media` : "";
    if ($("header-meta")) $("header-meta").innerText = `${state.messageOnlyCount.toLocaleString()} messages${withMedia}`;
    if ($("sidebar-sub")) $("sidebar-sub").innerText = state.mediaMissingCount
        ? `${state.mediaMissingCount} missing attachment${state.mediaMissingCount === 1 ? "" : "s"}`
        : `${state.messageOnlyCount.toLocaleString()} messages`;

    ensureExportButton();
    refreshChatChrome();
    populateSenderFilter();
}

/**
 * Every name-bearing piece of chrome — title, avatar initials, identity
 * select, profile — rewritten from `state` through `display`. Called on load
 * and whenever Anonymize is switched.
 */
export function refreshChatChrome() {
    syncAnonymizeControls();
    if (!state.messageOnlyCount) return;
    const title = shownTitle();
    const avatar = document.querySelector("#chat-list-item .chat-item-avatar");
    if (avatar) avatar.textContent = initialsFor(title);
    if ($("sidebar-title")) $("sidebar-title").innerText = title;
    if ($("header-name")) $("header-name").innerText = title;
    renderIdentitySelect($("identity-row"), $("setting-identity"), getChatSenders(), state.myName, display.name);
    refreshProfileName();
}

/** Adds the two HTML export choices to the header menu. */
function ensureExportButton() {
    const menu = $("header-menu");
    if (!menu || $("export-chat-btn")) return;

    const addButton = (id, label, icon, includeAttachments) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item";
        btn.id = id;
        btn.setAttribute("data-export-btn", "");
        btn.innerHTML = `<i class="ph ${icon}"></i> ${label}`;
        btn.addEventListener("click", async () => {
            closeMenu();
            btn.disabled = true;
            try {
                const exportedMessages = collectExportMessages();
                const exportedCount = exportedMessages.filter((m) => m.type === "msg").length;
                const isFiltered = Boolean(state.selectedSenders && state.selectedSenders.length > 0);
                const filterSuffix = isFiltered
                    ? ` (${state.selectedSenders.length === 1 ? display.name(state.selectedSenders[0]) : `${state.selectedSenders.length} participants`})`
                    : "";
                if (includeAttachments) showToast("Preparing chat and attachments…");
                const result = await exportChatAsHTML({
                    theme: "whatsapp",
                    colorScheme: document.body.classList.contains("light-theme") ? "light" : "dark",
                    includeAttachments,
                    mediaStore: state.mediaStore,
                    title: `${state.chatTitle ? shownTitle() : "WhatsApp Chat"}${filterSuffix}`,
                    messageCount: exportedCount,
                    messages: exportedMessages
                });
                const skipped = result.failedCount ? ` (${result.failedCount} couldn't be read)` : "";
                showToast(includeAttachments
                    ? `Chat exported with ${result.attachmentCount} attachment${result.attachmentCount === 1 ? "" : "s"}${skipped}`
                    : "Chat exported as HTML", skipped ? "warn" : "success");
            } catch (err) {
                console.error("[ChatLume] Export failed:", err);
                showToast("Export failed", "error");
            } finally {
                btn.disabled = false;
            }
        });
        menu.appendChild(btn);
    };

    addButton("export-chat-btn", "Export without attachments (.html)", "ph-file-text", false);
    addButton("export-chat-media-btn", "Export with attachments (.zip)", "ph-file-zip", true);
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
    restoreEmptyState();
    resetChatChrome();
}

/** Header, sidebar and menu as they are with no chat open. */
function resetChatChrome() {
    state.chatTitle = "Chat History";
    resetSenderFilterUI();
    renderIdentitySelect($("identity-row"), $("setting-identity"), [], "");
    $("empty-state")?.classList.remove("hidden");
    if ($("header-name")) $("header-name").innerText = "Welcome";
    if ($("header-meta")) $("header-meta").innerText = "ChatLume";
    if ($("sidebar-title")) $("sidebar-title").innerText = "Chat History";
    if ($("sidebar-sub")) $("sidebar-sub").innerText = "Active now";
    // updateUIState() shows these again on the next load.
    document.querySelectorAll("[data-export-btn]").forEach((button) => { button.hidden = true; });
    syncAnonymizeControls();
    generateStats();
    setUploadPanelVisible(true);
}
