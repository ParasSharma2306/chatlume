/**
 * ============================================================================
 * Instagram session
 * ============================================================================
 * Opens the export ZIP, finds its conversations, and loads the chosen one
 * onto the screen. Both steps are guarded by generation counters so a
 * second pick mid-way can't interleave with the first.
 * ============================================================================
 */
import { BlobReader, TextWriter, ZipReader } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { exportChatAsHTML } from "../export.js?v=1.7.0";
import { showSponsorPrompt } from "../support.js?v=1.7.0";
import { $, q, replayClass } from "../shared/dom.js?v=1.7.0";
import { exceedsCompatLimit, fileTooLargeMessage } from "../shared/compat.js?v=1.7.0";
import { clearMediaStore } from "../shared/media-urls.js?v=1.7.0";
import { fixMojibake } from "./mojibake.js?v=1.7.0";
import { igState } from "./state.js?v=1.7.0";
import { cleanupZip, lazyMedia } from "./media.js?v=1.7.0";
import { buildMediaStore, findThreads, folderLabel, initialsFor, parseMessages, sortMessageFiles } from "./parser.js?v=1.7.0";
import { collectExportMessages, renderChatList, scrollToBottom } from "./render.js?v=1.7.0";
import { showThreadSelector } from "./threads.js?v=1.7.0";
import {
    closeMenu,
    generateStats,
    isMobileLayout,
    setLoading,
    setSidebarState,
    showEmptyThreadState,
    showErrorState,
    showToast,
    yieldToPaint
} from "./ui.js?v=1.7.0";

/** "Load DMs" button: validates the picked file, then scans the ZIP. */
export async function initViewer() {
    if (igState.isLoading) return;
    const file = $("ig-file-input")?.files?.[0] || igState.selectedFile;
    if (!file) { showToast("Please select an Instagram export ZIP", "warn"); return; }
    if (!file.name.toLowerCase().endsWith(".zip")) { showToast("Please select a .zip file", "warn"); return; }

    if (exceedsCompatLimit(file)) {
        showToast(fileTooLargeMessage(file), "error");
        return;
    }

    const gen = ++igState.loadGeneration;
    const isStaleZip = () => igState.loadGeneration !== gen;

    cleanupZip();

    setLoading(true, "Opening ZIP", "Reading your Instagram export...");
    await yieldToPaint();

    try {
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

        if (threads.length === 1) {
            await loadThread(threads[0]);
        } else {
            showThreadSelector(threads, loadThread);
        }
    } catch (err) {
        if (isStaleZip()) return;
        console.error(err);
        showErrorState("Couldn't load this file", err.message || "Make sure it's a valid Instagram JSON export ZIP.");
        setLoading(false);
    }
}

/** Returns every per-thread field of `igState` to its default. */
function resetThreadState() {
    igState.messages = [];
    igState.filteredMessages = [];
    igState.messageOnlyCount = 0;
    igState.colorMap = {};
    igState.senderStats = {};
    igState.emojiStats = {};
    igState.hourlyStats = Array(24).fill(0);
    igState.mediaCount = 0;
    igState.searchResults = [];
    igState.searchPointer = -1;
    igState.activeMediaId = "";
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
    await yieldToPaint();
    if (isStale()) return;

    resetThreadState();

    try {
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
            let data;
            try { data = JSON.parse(text); } catch { continue; }
            if (data.title) threadTitle = fixMojibake(data.title);
            if (data.participants?.length && !participants.length) {
                participants = data.participants.map((p) => fixMojibake(p.name));
            }
            if (data.messages?.length) allRaw.push(...data.messages);
        }

        // Oldest first
        allRaw.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

        const nameInput = $("ig-my-name")?.value.trim();
        // Instagram lists the account owner LAST in `participants`, so falling back
        // to participants[0] labelled the other person's messages as yours and
        // flipped every bubble in the thread.
        igState.myName = nameInput || participants[participants.length - 1] || "";
        igState.chatTitle = threadTitle;

        // Build media store from all non-JSON files in the ZIP
        buildMediaStore(igState.zipEntries);

        const validRaw = allRaw.filter((m) => !m.is_unsent);
        allRaw = null; // release raw message array memory before parsing
        parseMessages(validRaw);
        generateStats();

        if (igState.messageOnlyCount === 0) {
            showEmptyThreadState(igState.threads.length > 1 ? () => showThreadSelector(igState.threads, loadThread) : null);
            showToast("No messages found in this thread", "error");
            setLoading(false);
            return;
        }

        updateUI(threadTitle, participants);
        renderChatList();
        requestAnimationFrame(scrollToBottom);
        showToast(`Loaded ${igState.messageOnlyCount.toLocaleString()} messages`);
        if (isMobileLayout()) setSidebarState(false);
        showSponsorPrompt();
    } catch (err) {
        console.error(err);
        showErrorState("Couldn't parse this file", err.message || "Make sure it's a valid Instagram JSON export ZIP.");
    } finally {
        if (!isStale()) setLoading(false);
    }
}

/** Puts the loaded thread's title and counts into the sidebar and header. */
function updateUI(title, participants) {
    $("ig-upload-panel")?.classList.add("hidden");
    $("ig-thread-panel")?.classList.add("hidden");
    $("ig-chat-list-panel")?.classList.remove("hidden");
    $("ig-empty-state")?.classList.add("hidden");

    // One-shot reveal: the message list is virtualised, so animate the container
    // rather than each message.
    replayClass([$("ig-viewport"), q(".chat-header .header-profile")], "chat-revealed");

    const withMedia = igState.mediaCount ? ` • ${igState.mediaCount.toLocaleString()} media` : "";
    const avatar = q(".chat-item-avatar", $("ig-chat-list-item"));
    if (avatar) avatar.textContent = initialsFor(title);
    if ($("ig-sidebar-title")) $("ig-sidebar-title").innerText = title;
    if ($("ig-header-name")) $("ig-header-name").innerText = title;
    if ($("ig-header-meta")) $("ig-header-meta").innerText = `${igState.messageOnlyCount.toLocaleString()} messages${withMedia}`;
    if ($("ig-sidebar-sub")) $("ig-sidebar-sub").innerText = participants.join(", ") || "Direct Message";

    ensureExportButton();
}

/** Adds "Export HTML" to the header menu the first time a thread opens. */
function ensureExportButton() {
    const menu = $("ig-header-menu");
    if (!menu || $("ig-export-chat-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item";
    btn.id = "ig-export-chat-btn";
    btn.setAttribute("data-export-btn", "");
    btn.title = "Exports text only — media referenced by filename for efficiency";
    btn.innerHTML = '<i class="ph ph-download-simple"></i> Export HTML';
    btn.addEventListener("click", () => {
        closeMenu();
        try {
            exportChatAsHTML({
                theme: "instagram",
                title: igState.chatTitle || "Instagram DMs",
                messageCount: igState.messageOnlyCount,
                messages: collectExportMessages()
            });
            showToast("Chat exported as HTML");
        } catch (err) {
            console.error("[ChatLume] Export failed:", err);
            showToast("Export failed", "error");
        }
    });
    menu.appendChild(btn);
}
