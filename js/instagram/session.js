/**
 * ============================================================================
 * Instagram session
 * ============================================================================
 * Opens the export ZIP, finds its conversations, and loads the chosen one
 * onto the screen. Both steps are guarded by generation counters so a
 * second pick mid-way can't interleave with the first.
 * ============================================================================
 */
import { exportChatAsHTML } from "../export.js?v=1.10.0";
import { resetDropTarget } from "./file-picker.js?v=1.10.0";
import { showSponsorPrompt } from "../support.js?v=1.10.0";
import { $, q, replayClass, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.10.0";
import { exceedsCompatLimit, fileTooLargeMessage } from "../shared/compat.js?v=1.10.0";
import { clearMediaStore } from "../shared/media-urls.js?v=1.10.0";
import { inferOwner, renderIdentitySelect } from "../shared/identity.js?v=1.10.0";
import { loadZip } from "../shared/zip.js?v=1.10.0";
import { fixMojibake } from "./mojibake.js?v=1.10.0";
import { tailRange } from "../shared/virtual-list.js?v=1.10.0";
import { IG_MAX_RENDERED, igState } from "./state.js?v=1.10.0";
import { cleanupZip, lazyMedia } from "./media.js?v=1.10.0";
import { gallery } from "./gallery.js?v=1.10.0";
import { closeReactionPopover } from "./reactions.js?v=1.10.0";
import { buildMediaStore, findThreads, folderLabel, initialsFor, parseMessageFile, parseMessages, sortMessageFiles, sortMessagesChronologically } from "./parser.js?v=1.10.0";
import { collectExportMessages, renderChatList, scrollToBottom, syncScrollLatest } from "./render.js?v=1.10.0";
import { isSearchOpen, toggleSearch } from "./search.js?v=1.10.0";
import { showThreadSelector, syncBackButtons } from "./threads.js?v=1.10.0";
import { persistInstagramImport, markInstagramImportOpened } from "./persistence.js?v=1.10.0";
import { countBySender, filterMessagesBySender, getInstagramSenderSummary, getInstagramSenders } from "./filter.js?v=1.10.0";
import { initialThreadSelection } from "./threads-model.js?v=1.10.0";
import { display, shownTitle, syncAnonymizeControls } from "./anonymize.js?v=1.10.0";
import {
    closeMenu,
    generateStats,
    isMobileLayout,
    restoreEmptyState,
    setLoading,
    setSidebarState,
    showEmptyThreadState,
    showErrorState,
    showToast,
    yieldToPaint
} from "./ui.js?v=1.10.0";

/** "Load DMs" button: validates the picked file, then scans the ZIP. */
export async function initViewer({ file: fileOverride = null, record = null } = {}) {
    if (igState.isLoading) return;
    const file = fileOverride || $("ig-file-input")?.files?.[0] || igState.selectedFile;
    if (!file) { showToast("Please select an Instagram export ZIP", "warn"); return; }
    if (!file.name.toLowerCase().endsWith(".zip")) { showToast("Please select a .zip file", "warn"); return; }

    if (exceedsCompatLimit(file)) {
        showToast(fileTooLargeMessage(file), "error");
        return;
    }

    const gen = ++igState.loadGeneration;
    const isStaleZip = () => igState.loadGeneration !== gen;

    // The old conversation goes with its ZIP: left on screen, its media was dead
    // and an error for the new file appeared above its messages.
    resetThreadState();
    cleanupZip();
    igState.threads = [];
    resetChatChrome();
    igState.currentFile = file;
    igState.activeImportId = record?.id || "";
    igState.restoreImportId = record?.id || "";
    igState.restoreThreadFolder = record?.threadFolder || "";
    igState.restoreOwner = record?.ownerName || "";
    if (record?.ownerName && $("ig-my-name") && !$("ig-my-name").value.trim()) $("ig-my-name").value = record.ownerName;

    setLoading(true, "Opening ZIP", "Reading your Instagram export...");
    try {
        await yieldToPaint();
        if (isStaleZip()) return;
        const { BlobReader, ZipReader } = await loadZip();
        if (isStaleZip()) return;
        const reader = new ZipReader(new BlobReader(file));
        const entries = await reader.getEntries();
        if (isStaleZip()) {
            reader.close().catch(() => {});
            return;
        }
        igState.zipEntries = entries;
        igState.zipReader = reader;

        setLoading(true, "Scanning threads", "Finding message folders...");
        await yieldToPaint();
        if (isStaleZip()) return;

        const threads = findThreads(entries);
        if (!threads.length) throw new Error("No Instagram message folders found. Make sure you selected JSON format when requesting the export.");

        igState.threads = threads;
        setLoading(false);

        const selectedThread = initialThreadSelection(threads, record?.threadFolder || "");
        if (selectedThread) {
            await loadThread(selectedThread);
            return;
        }
        showThreadSelector(threads, loadThread);
    } catch (err) {
        if (isStaleZip()) return;
        console.error(err);
        cleanupZip();
        showErrorState("Couldn't load this file", err.message || "Make sure it's a valid Instagram JSON export ZIP.");
        setLoading(false);
    }
}

/** Returns every per-thread field of `igState` to its default. */
function resetThreadState() {
    if (isSearchOpen()) toggleSearch();
    igState.messages = [];
    igState.filteredMessages = [];
    igState.participants = [];
    igState.selectedSenders = [];
    igState.messageOnlyCount = 0;
    igState.colorMap = Object.create(null);
    igState.senderStats = Object.create(null);
    igState.emojiStats = {};
    igState.hourlyStats = Array(24).fill(0);
    igState.mediaCount = 0;
    igState.mediaMissingCount = 0;
    igState.searchResults = [];
    igState.searchPointer = -1;
    igState.searchQuery = "";
    clearTimeout(igState.searchTimer);
    igState.searchTimer = null;
    igState.activeMediaId = "";
    igState.flashMessageId = "";
    gallery.reset();
    closeReactionPopover();
    $("ig-sender-filter-list")?.replaceChildren();
    $("ig-sender-filter-container")?.setAttribute("hidden", "");
    igState.renderRange = { start: 0, end: 0 };
    syncScrollLatest();
    clearMediaStore(igState);
    lazyMedia.disconnect();
    if ($("ig-message-list")) $("ig-message-list").innerHTML = "";
}

/**
 * Parses one conversation folder and puts it on screen.
 *
 * Picking a second conversation before the first finished parsing appended
 * both into igState.messages, interleaving two threads in one view. Every
 * await below re-checks the generation token and bails if a newer load has
 * started.
 */
export async function loadThread(thread) {
    const gen = ++igState.threadGeneration;
    const isStale = () => igState.threadGeneration !== gen;

    setLoading(true, "Loading thread", "Parsing messages...");
    try {
        await yieldToPaint();
        if (isStale()) return;
        const { TextWriter } = await loadZip();
        if (isStale()) return;
        resetThreadState();

        const sortedFiles = sortMessageFiles(thread.files);

        let allRaw = [];
        let threadTitle = folderLabel(thread.folder);
        let participants = [];

        for (let i = 0; i < sortedFiles.length; i++) {
            setLoading(true, "Loading thread", `Parsing file ${i + 1} of ${sortedFiles.length}...`);
            await yieldToPaint();
            if (isStale()) return;
            const text = await sortedFiles[i].getData(new TextWriter("utf-8"));
            if (isStale()) return;
            const data = parseMessageFile(text);
            if (!data) continue;
            if (typeof data.title === "string" && data.title) threadTitle = fixMojibake(data.title);
            if (Array.isArray(data.participants) && data.participants.length && !participants.length) {
                participants = data.participants.map((p) => fixMojibake(String(p?.name || ""))).filter(Boolean);
            }
            if (Array.isArray(data.messages) && data.messages.length) allRaw = allRaw.concat(data.messages);
        }

        // Oldest first
        allRaw = sortMessagesChronologically(allRaw);

        const nameInput = $("ig-my-name")?.value.trim();
        // Instagram lists the account owner LAST in `participants`, so falling back
        // to participants[0] labelled the other person's messages as yours and
        // flipped every bubble in the thread.
        // A typed name nobody here has would put every message on the left.
        const known = new Set(participants);
        allRaw.forEach((raw) => known.add(fixMojibake(String(raw.sender_name || ""))));
        const inThread = (name) => name && [...known].find((other) => other.toLowerCase() === name.toLowerCase());
        igState.myName = inThread(igState.restoreOwner) || inThread(nameInput) || inferOwner(participants, threadTitle) || participants[participants.length - 1] || nameInput || "";
        igState.restoreOwner = "";
        igState.chatTitle = threadTitle;
        igState.participants = participants;

        // Build media store from all non-JSON files in the ZIP
        buildMediaStore(igState.zipEntries);

        const validRaw = allRaw.filter((m) => !m.is_unsent);
        allRaw = null; // release raw message array memory before parsing
        parseMessages(validRaw);
        generateStats();

        if (igState.messageOnlyCount === 0) {
            resetChatChrome();
            showEmptyThreadState(igState.threads.length > 1 ? () => showThreadSelector(igState.threads, loadThread) : null);
            showToast("No messages found in this thread", "error");
            setLoading(false);
            return;
        }

        igState.currentThread = thread;
        igState.selectedFile = null;
        if ($("ig-file-input")) $("ig-file-input").value = "";
        resetDropTarget();
        updateUI();
        populateInstagramSenderFilter();
        renderChatList();
        scrollToBottom();
        showToast(`Loaded ${igState.messageOnlyCount.toLocaleString()} messages`);
        if (isMobileLayout()) setSidebarState(false);
        if (igState.activeImportId) {
            try { await markInstagramImportOpened(thread); }
            catch (error) { console.warn("Saved thread metadata could not be updated:", error); }
        } else void persistInstagramImport(igState.currentFile, thread);
        showSponsorPrompt();
    } catch (err) {
        if (!isStale()) {
            console.error(err);
            resetThreadState();
            resetChatChrome();
            if (igState.threads.length > 1) showThreadSelector(igState.threads, loadThread);
            showErrorState("Couldn't parse this file", err.message || "Make sure it's a valid Instagram JSON export ZIP.");
        }
    } finally {
        if (!isStale()) setLoading(false);
    }
}

function populateInstagramSenderFilter() {
    const list = $("ig-sender-filter-list");
    if (!list) return;
    const counts = countBySender(igState.messages);
    const selected = new Set(igState.selectedSenders);
    const mine = igState.myName.toLowerCase();
    // In Anonymize mode the value is the alias too, so no real name is in the
    // DOM; applySenderSelection() maps it back.
    list.innerHTML = getInstagramSenders(igState.messages).map((sender, index) => `
        <label class="sender-filter-item">
            <input type="checkbox" class="sender-filter-checkbox" value="${escapeAttribute(display.name(sender))}" id="ig-sender-${index}"${selected.has(sender) ? " checked" : ""}>
            <span class="sender-filter-name">${escapeHtml(display.name(sender))}${sender.toLowerCase() === mine ? " (You)" : ""}</span>
            <span class="sender-filter-count">${counts.get(sender).toLocaleString()}</span>
        </label>
    `).join("");
    syncFilterSummary();
}

/** Applies a sender selection (checkbox values: aliases in Anonymize mode). */
export function applySenderSelection(senders) {
    igState.selectedSenders = senders.map((value) => display.realName(value));
    igState.filteredMessages = filterMessagesBySender(igState.messages, senders);
    igState.renderRange = tailRange(igState.filteredMessages.length, IG_MAX_RENDERED);
    syncFilterSummary();
}

const visibleMessageCount = () => igState.filteredMessages.reduce((sum, item) => sum + (item.type === "msg" ? 1 : 0), 0);

function syncFilterSummary() {
    const count = igState.selectedSenders.length;
    const summary = getInstagramSenderSummary(igState.selectedSenders.map(display.name));
    $("ig-sender-filter-container")?.classList.toggle("has-filter", count > 0);
    if ($("ig-sender-filter-summary")) $("ig-sender-filter-summary").textContent = summary;
    const badge = $("ig-sender-filter-badge");
    if (badge) { badge.textContent = String(count); badge.hidden = !count; }
    $("ig-sender-filter-btn")?.setAttribute("aria-label", `Filter by sender, ${summary}`);

    const media = igState.mediaCount ? ` • ${igState.mediaCount.toLocaleString()} media` : "";
    const total = igState.messageOnlyCount.toLocaleString();
    if ($("ig-header-meta")) $("ig-header-meta").innerText = `${count ? `${visibleMessageCount().toLocaleString()} of ${total}` : total} messages${media}`;
}

/** "You in this chat" in Settings. `value` is the select's value (an alias in Anonymize mode). */
export function setThreadOwner(value) {
    if (!igState.messageOnlyCount) return;
    const name = value ? display.realName(value) : "";
    igState.myName = name;
    igState.messages.forEach((item) => {
        if (item.type === "msg") item.isMe = Boolean(name) && item.sender.toLowerCase() === name.toLowerCase();
    });
    populateInstagramSenderFilter();
    renderChatList();
    if (igState.activeImportId) void markInstagramImportOpened(igState.currentThread).catch(() => {});
    showToast(name ? `Showing ${display.name(name)}'s messages as yours` : "No participant is marked as you");
}

/** Header, sidebar and menu as they are with no conversation open. */
function resetChatChrome() {
    restoreEmptyState();
    generateStats();
    if ($("ig-header-name")) $("ig-header-name").innerText = "Instagram DMs";
    if ($("ig-header-meta")) $("ig-header-meta").innerText = "ChatLume";
    document.querySelectorAll("[data-export-btn]").forEach((button) => { button.hidden = true; });
    renderIdentitySelect($("ig-identity-row"), $("ig-setting-identity"), [], "");
    syncAnonymizeControls();
    $("ig-chat-list-panel")?.classList.add("hidden");
    if (!igState.threads.length) $("ig-upload-panel")?.classList.remove("hidden");
    syncBackButtons();
}

/** Puts the viewer back to its just-opened state (its stored copy was deleted). */
export function closeActiveThread() {
    igState.loadGeneration += 1;
    igState.threadGeneration += 1;
    resetThreadState();
    cleanupZip();
    igState.threads = [];
    igState.activeImportId = "";
    igState.currentFile = null;
    $("ig-thread-panel")?.classList.add("hidden");
    resetChatChrome();
}

/** Puts the loaded thread's title and counts into the sidebar and header. */
function updateUI() {
    $("ig-upload-panel")?.classList.add("hidden");
    $("ig-thread-panel")?.classList.add("hidden");
    $("ig-chat-list-panel")?.classList.remove("hidden");
    $("ig-empty-state")?.classList.add("hidden");
    $("ig-sender-filter-container")?.removeAttribute("hidden");

    // One-shot reveal: the message list is virtualised, so animate the container
    // rather than each message.
    replayClass([$("ig-viewport"), q(".chat-header .header-profile")], "chat-revealed");

    ensureExportButton();
    document.querySelectorAll("[data-export-btn]").forEach((button) => { button.hidden = false; });
    refreshThreadChrome();
    syncBackButtons();
}

/**
 * Title, avatar initials, participant line and identity select, written
 * through `display`. Called on load and whenever Anonymize is switched.
 */
export function refreshThreadChrome() {
    syncAnonymizeControls();
    if (!igState.messageOnlyCount) return;
    const title = shownTitle();
    const avatar = q(".chat-item-avatar", $("ig-chat-list-item"));
    if (avatar) avatar.textContent = initialsFor(title);
    if ($("ig-sidebar-title")) $("ig-sidebar-title").innerText = title;
    if ($("ig-header-name")) $("ig-header-name").innerText = title;
    if ($("ig-sidebar-sub")) $("ig-sidebar-sub").innerText = igState.mediaMissingCount
        ? `${igState.mediaMissingCount} missing attachment${igState.mediaMissingCount === 1 ? "" : "s"}`
        : igState.participants.map(display.name).join(", ") || "Direct Message";
    renderIdentitySelect($("ig-identity-row"), $("ig-setting-identity"), getInstagramSenders(igState.messages), igState.myName, display.name);
    syncFilterSummary();
}

export { populateInstagramSenderFilter };

/** Adds the two HTML export choices to the header menu. */
function ensureExportButton() {
    const menu = $("ig-header-menu");
    if (!menu || $("ig-export-chat-btn")) return;

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
                if (includeAttachments) showToast("Preparing chat and attachments…");
                const result = await exportChatAsHTML({
                    theme: "instagram",
                    colorScheme: document.body.classList.contains("light-theme") ? "light" : "dark",
                    includeAttachments,
                    mediaStore: igState.mediaStore,
                    title: `${shownTitle()}${igState.selectedSenders.length ? ` (${getInstagramSenderSummary(igState.selectedSenders.map(display.name))})` : ""}`,
                    messageCount: visibleMessageCount(),
                    messages: collectExportMessages()
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

    addButton("ig-export-chat-btn", "Export without attachments (.html)", "ph-file-text", false);
    addButton("ig-export-chat-media-btn", "Export with attachments (.zip)", "ph-file-zip", true);
}
