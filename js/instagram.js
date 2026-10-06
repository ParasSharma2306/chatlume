/**
 * ============================================================================
 * ChatLume — Instagram viewer entry point
 * ============================================================================
 * Boots the Instagram DM viewer and wires DOM events to its modules:
 *
 *   instagram/state.js      shared mutable state + constants
 *   instagram/session.js    open the ZIP, load a conversation
 *   instagram/parser.js     thread discovery, media index, message parsing
 *   instagram/threads.js    conversation picker
 *   instagram/media.js      lazy loading, media viewer, downloads
 *   instagram/render.js     the virtualised message list
 *   instagram/search.js     in-thread search
 *   instagram/mojibake.js   repairs Instagram's latin1-mangled UTF-8
 *   instagram/ui.js         toast, loading overlay, sidebar, drawers
 *   shared/*                utilities shared with the WhatsApp viewer
 *
 * All processing is client-side; nothing is uploaded.
 * ============================================================================
 */
import { configure } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { $, q, escapeHtml } from "./shared/dom.js?v=1.8.3";
import { COMPAT_LIMIT_MESSAGE, exceedsCompatLimit, showCompatBannerIfNeeded } from "./shared/compat.js?v=1.8.3";
import { assignFileToInput, setupDropTarget, setupGlobalDropZone } from "./shared/drop-zone.js?v=1.8.3";
import { popOverlayState } from "./shared/history.js?v=1.8.3";
import { runSplashLoader } from "./shared/splash.js?v=1.8.3";
import { createThemeController } from "./shared/theme.js?v=1.8.3";
import { igState } from "./instagram/state.js?v=1.8.3";
import { closeMediaModal, handleMessageListClick } from "./instagram/media.js?v=1.8.3";
import { handleViewportScroll, jumpToBottom, renderChatList, resetRenderToBottom } from "./instagram/render.js?v=1.8.3";
import { handleSearchInput, handleSearchShortcut, isSearchOpen, navSearch, runSearch, toggleSearch } from "./instagram/search.js?v=1.8.3";
import { filterMessagesBySender, getInstagramSenderSummary } from "./instagram/filter.js?v=1.8.3";
import { applyDateJump, closeDateSheet, openDateSheet } from "./instagram/date-jump.js?v=1.8.3";
import { closeInstagramWrapped, downloadInstagramWrapped, openInstagramWrapped } from "./instagram/wrapped.js?v=1.8.3";
import { cancelInstagramCopy, deleteAllInstagramImports, handleInstagramStorageClick, handleInstagramStorageSetting, initInstagramPersistence } from "./instagram/persistence.js?v=1.8.3";
import { DEFAULT_IG_SETTINGS, readInstagramSettings, writeInstagramSettings } from "./instagram/settings.js?v=1.8.3";
import { initViewer, loadThread } from "./instagram/session.js?v=1.8.3";
import { showThreadSelector } from "./instagram/threads.js?v=1.8.3";
import {
    closeAllDrawers,
    closeMenu,
    dismissDrawer,
    handleDocumentClick,
    isMobileLayout,
    openDrawer,
    setSidebarState,
    showToast,
    toggleMenu,
    toggleSidebar
} from "./instagram/ui.js?v=1.8.3";

configure({ useDecompressionStream: typeof DecompressionStream !== "undefined" });

const IG_APP_VERSION = "1.8.3";

const theme = createThemeController({ iconSelector: "#ig-theme-toggle i" });

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    theme.applySaved();
    igState.settings = readInstagramSettings();
    syncInstagramSettingsControls();
    bindUI();
    document.querySelectorAll("[data-app-version]").forEach((el) => { el.textContent = `v${IG_APP_VERSION}`; });
    runSplashLoader();
    showCompatBannerIfNeeded();
    if (isMobileLayout()) setSidebarState(true);
    await initInstagramPersistence({ openImport: (file, record) => initViewer({ file, record }) });
});

window.addEventListener("resize", () => {
    if (!isMobileLayout()) setSidebarState(false);
});

window.addEventListener("beforeunload", () => {
    igState.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    igState.zipReader?.close().catch(() => {});
});

/** Back button: close whatever overlay is open (its history entry is already gone). */
window.addEventListener("popstate", () => {
    closeMediaModal();
    closeMenu();
    closeAllDrawers();
    closeDateSheet({ fromHistory: true });
    closeInstagramWrapped({ fromHistory: true });
});

// ── Event wiring ────────────────────────────────────────────────────────────

function bindUI() {
    $("ig-theme-toggle")?.addEventListener("click", theme.toggle);
    $("ig-open-settings")?.addEventListener("click", () => openDrawer("ig-settings"));
    $("ig-close-settings")?.addEventListener("click", () => dismissDrawer("ig-settings"));
    $("ig-mobile-menu")?.addEventListener("click", toggleSidebar);
    $("ig-sidebar-backdrop")?.addEventListener("click", toggleSidebar);

    setupFileIntake();

    $("ig-load-btn")?.addEventListener("click", initViewer);
    // Typing a name and hitting Enter is the obvious next move.
    $("ig-my-name")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        initViewer();
    });

    // Search
    $("ig-search-toggle")?.addEventListener("click", toggleSearch);
    $("ig-search-close")?.addEventListener("click", toggleSearch);
    $("ig-live-search")?.addEventListener("input", handleSearchInput);
    $("ig-search-up")?.addEventListener("click", () => navSearch("up"));
    $("ig-search-down")?.addEventListener("click", () => navSearch("down"));
    $("ig-date-jump-action")?.addEventListener("click", () => { closeMenu(); openDateSheet(); });
    $("ig-date-sheet-cancel")?.addEventListener("click", () => closeDateSheet());
    $("ig-date-sheet-apply")?.addEventListener("click", applyDateJump);
    $("ig-date-sheet")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeDateSheet(); });
    $("ig-generate-wrapped")?.addEventListener("click", openInstagramWrapped);
    $("ig-wrapped-close")?.addEventListener("click", () => closeInstagramWrapped());
    $("ig-wrapped-backdrop")?.addEventListener("click", () => closeInstagramWrapped());
    $("ig-wrapped-download")?.addEventListener("click", downloadInstagramWrapped);
    $("ig-change-thread")?.addEventListener("click", () => showThreadSelector(igState.threads, loadThread));
    document.querySelectorAll("[data-ig-another-export]").forEach((button) => button.addEventListener("click", () => {
        $("ig-thread-panel")?.classList.add("hidden");
        $("ig-chat-list-panel")?.classList.add("hidden");
        $("ig-upload-panel")?.classList.remove("hidden");
        $("ig-sender-filter-container")?.setAttribute("hidden", "");
        if (isMobileLayout()) setSidebarState(true);
    }));

    $("ig-sender-filter-btn")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const dropdown = $("ig-sender-filter-dropdown");
        const open = Boolean(dropdown?.hidden);
        if (dropdown) dropdown.hidden = !open;
        $("ig-sender-filter-btn")?.setAttribute("aria-expanded", String(open));
    });
    $("ig-sender-filter-list")?.addEventListener("change", applyInstagramSenderFilter);
    $("ig-sender-filter-reset")?.addEventListener("click", () => {
        $("ig-sender-filter-list")?.querySelectorAll("input[type=checkbox]").forEach((input) => { input.checked = false; });
        applyInstagramSenderFilter();
    });
    document.addEventListener("click", (event) => {
        const container = $("ig-sender-filter-container");
        if (container && !container.contains(event.target)) {
            $("ig-sender-filter-dropdown")?.setAttribute("hidden", "");
            $("ig-sender-filter-btn")?.setAttribute("aria-expanded", "false");
        }
    });

    document.querySelectorAll("[data-ig-setting]").forEach((control) => control.addEventListener("change", handleInstagramSettingChange));
    $("ig-storage-list")?.addEventListener("click", handleInstagramStorageClick);
    $("ig-storage-delete-all")?.addEventListener("click", deleteAllInstagramImports);
    $("ig-storage-cancel")?.addEventListener("click", cancelInstagramCopy);
    $("ig-reset-settings")?.addEventListener("click", resetInstagramSettings);

    // Header menu (the thread session adds its export action here).
    $("ig-menu-toggle")?.addEventListener("click", toggleMenu);
    $("ig-menu-toggle")?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" || $("ig-header-menu")?.classList.contains("show")) return;
        event.preventDefault();
        toggleMenu(true);
        $("ig-header-menu")?.querySelector(".menu-item")?.focus();
    });
    $("ig-header-menu")?.addEventListener("keydown", (event) => {
        const items = [...event.currentTarget.querySelectorAll(".menu-item:not(:disabled)")];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
            $("ig-menu-toggle")?.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(index + step + items.length) % items.length].focus();
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            items[event.key === "Home" ? 0 : items.length - 1].focus();
        }
    });
    $("ig-scroll-latest")?.addEventListener("click", jumpToBottom);
    document.addEventListener("click", handleDocumentClick);

    // Media viewer
    $("ig-media-modal-close")?.addEventListener("click", () => {
        closeMediaModal();
        popOverlayState();
    });
    // Route through the close button so the pushed history entry is popped too —
    // closing directly left a dead entry that swallowed the next Back press.
    $("ig-media-modal-backdrop")?.addEventListener("click", () => $("ig-media-modal-close")?.click());

    $("ig-chat-list-item")?.addEventListener("click", () => {
        if (isMobileLayout()) setSidebarState(false);
    });

    // Drawers
    $("ig-open-stats")?.addEventListener("click", () => openDrawer("ig-stats"));
    $("ig-close-stats")?.addEventListener("click", () => dismissDrawer("ig-stats"));

    // Message list
    $("ig-viewport")?.addEventListener("scroll", handleViewportScroll);
    $("ig-message-list")?.addEventListener("click", handleMessageListClick);

    document.addEventListener("keydown", handleGlobalKeydown);
}

function syncInstagramSettingsControls() {
    document.querySelectorAll("[data-ig-setting]").forEach((control) => {
        const value = igState.settings[control.dataset.igSetting];
        if (control.type === "checkbox") control.checked = Boolean(value);
        else control.value = value;
    });
}

function handleInstagramSettingChange(event) {
    const control = event.currentTarget;
    const key = control.dataset.igSetting;
    const value = control.type === "checkbox" ? control.checked : control.value;
    igState.settings = writeInstagramSettings({ ...igState.settings, [key]: value });
    if (key === "persistentStorage") handleInstagramStorageSetting(event);
    renderChatList();
}

function resetInstagramSettings() {
    const wasStoring = igState.settings.persistentStorage;
    igState.settings = writeInstagramSettings({ ...DEFAULT_IG_SETTINGS, persistentStorage: false });
    syncInstagramSettingsControls();
    if (wasStoring) handleInstagramStorageSetting({ target: { checked: false } });
    renderChatList();
    showToast("Instagram settings reset");
}

function applyInstagramSenderFilter() {
    igState.selectedSenders = [...($("ig-sender-filter-list")?.querySelectorAll("input[type=checkbox]:checked") || [])].map((input) => input.value);
    igState.filteredMessages = filterMessagesBySender(igState.messages, igState.selectedSenders);
    const summary = getInstagramSenderSummary(igState.selectedSenders);
    $("ig-sender-filter-btn")?.setAttribute("aria-label", `Filter by sender. ${summary}`);
    if (igState.searchQuery) runSearch(igState.searchQuery);
    else resetRenderToBottom();
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function handleGlobalKeydown(event) {
    if (event.key === "Escape") {
        handleEscape();
        return;
    }
    handleSearchShortcut(event);
}

/** Closes the topmost overlay. */
function handleEscape() {
    if (igState.activeMediaId) { closeMediaModal(); return; }
    if (!$("ig-date-sheet")?.hidden) { closeDateSheet(); return; }
    if (!$("ig-wrapped-modal")?.hidden) { closeInstagramWrapped(); return; }
    const senderDropdown = $("ig-sender-filter-dropdown");
    if (senderDropdown && !senderDropdown.hidden) {
        senderDropdown.hidden = true;
        $("ig-sender-filter-btn")?.setAttribute("aria-expanded", "false");
        $("ig-sender-filter-btn")?.focus({ preventScroll: true });
        return;
    }
    if (isSearchOpen()) { toggleSearch(); return; }
    const wasMenuOpen = $("ig-header-menu")?.classList.contains("show");
    closeMenu();
    if (wasMenuOpen) $("ig-menu-toggle")?.focus();
    closeAllDrawers();
}

// ── File intake ─────────────────────────────────────────────────────────────

/** Wires the picker, drop target and window-wide drop overlay. */
function setupFileIntake() {
    const fileInput = $("ig-file-input");
    $("ig-drop-target")?.addEventListener("click", () => fileInput?.click());
    // Clearing the value lets the same file be picked twice in a row.
    fileInput?.addEventListener("click", (event) => {
        event.target.value = null;
        igState.selectedFile = null;
        resetDropTarget();
    });
    fileInput?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (exceedsCompatLimit(file)) {
            showToast(COMPAT_LIMIT_MESSAGE, "error");
            event.target.value = "";
            return;
        }
        igState.selectedFile = file;
        reflectSelectedFile(file);
    });

    setupDropTarget($("ig-drop-target"), (files) => {
        const file = files[0];
        if (exceedsCompatLimit(file)) {
            showToast(COMPAT_LIMIT_MESSAGE, "error");
            return;
        }
        igState.selectedFile = file;
        reflectSelectedFile(file);
    });

    setupGlobalDropZone($("ig-drag-overlay"), handleDroppedFile);
}

/** A file dropped anywhere on the page. */
function handleDroppedFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".txt")) {
        showToast("Instagram exports are .zip (JSON format) — .txt is WhatsApp only", "error");
        return;
    }
    if (!name.endsWith(".zip")) {
        showToast("Please drop a .zip Instagram export", "error");
        return;
    }
    if (exceedsCompatLimit(file)) {
        showToast(COMPAT_LIMIT_MESSAGE, "error");
        return;
    }
    igState.selectedFile = file;
    assignFileToInput($("ig-file-input"), file);
    reflectSelectedFile(file);
    // If a thread is already open, the upload panel is hidden — point the
    // user back at the Load button.
    if ($("ig-upload-panel")?.classList.contains("hidden")) {
        if (isMobileLayout()) setSidebarState(true);
        showToast("File ready — tap Load DMs to open it", "info");
    }
}

/** Turns the drop target into a "Ready to load" confirmation. */
function reflectSelectedFile(file) {
    const dropTarget = $("ig-drop-target");
    if (!dropTarget) return;
    dropTarget.classList.add("ready");
    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);
    if (icon) { icon.className = "ph-fill ph-check-circle"; icon.style.color = "#C13584"; }
    if (label) label.innerHTML = `<strong>${escapeHtml(file.name)}</strong><br><span style="font-size:12px;opacity:0.7">Ready to load</span>`;
}

function resetDropTarget() {
    const dropTarget = $("ig-drop-target");
    if (!dropTarget) return;
    dropTarget.classList.remove("ready");
    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);
    if (icon) { icon.className = "ph ph-file-zip"; icon.style.color = ""; }
    if (label) label.innerHTML = "Drop <strong>.zip</strong> export";
}
