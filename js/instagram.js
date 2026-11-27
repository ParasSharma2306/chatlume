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
 *   instagram/gallery.js    Media, links and voice notes gallery
 *   instagram/render.js     the virtualised message list
 *   instagram/search.js     in-thread search
 *   instagram/mojibake.js   repairs Instagram's latin1-mangled UTF-8
 *   instagram/ui.js         toast, loading overlay, sidebar, drawers
 *   shared/*                utilities shared with the WhatsApp viewer
 *
 * All processing is client-side; nothing is uploaded.
 * ============================================================================
 */
import { $ } from "./shared/dom.js?v=1.10.0";
import { COMPAT_LIMIT_MESSAGE, exceedsCompatLimit, showCompatBannerIfNeeded } from "./shared/compat.js?v=1.10.0";
import { assignFileToInput, setupDropTarget, setupGlobalDropZone } from "./shared/drop-zone.js?v=1.10.0";
import { overlayOf, popOverlayState } from "./shared/history.js?v=1.10.0";
import { runSplashLoader } from "./shared/splash.js?v=1.10.0";
import { createThemeController } from "./shared/theme.js?v=1.10.0";
import { igState } from "./instagram/state.js?v=1.10.0";
import { closeMediaModal, handleMessageListClick } from "./instagram/media.js?v=1.10.0";
import { handleViewportScroll, jumpToBottom, renderChatList } from "./instagram/render.js?v=1.10.0";
import { handleSearchInput, handleSearchKeydown, handleSearchShortcut, isSearchOpen, navSearch, runSearch, toggleSearch } from "./instagram/search.js?v=1.10.0";
import { reflectSelectedFile } from "./instagram/file-picker.js?v=1.10.0";
import { applyDateJump, closeDateSheet, openDateSheet } from "./instagram/date-jump.js?v=1.10.0";
import { closeInstagramWrapped, downloadInstagramWrapped, openInstagramWrapped } from "./instagram/wrapped.js?v=1.10.0";
import { cancelInstagramCopy, deleteAllInstagramImports, handleInstagramStorageClick, handleInstagramStorageSetting, initInstagramPersistence } from "./instagram/persistence.js?v=1.10.0";
import { DEFAULT_IG_SETTINGS } from "./instagram/format.js?v=1.10.0";
import { readInstagramSettings, writeInstagramSettings } from "./instagram/settings.js?v=1.10.0";
import { applySenderSelection, closeActiveThread, initViewer, loadThread, setThreadOwner } from "./instagram/session.js?v=1.10.0";
import { showOpenThread, showThreadSelector, syncBackButtons } from "./instagram/threads.js?v=1.10.0";
import { syncAnonymizeControls } from "./instagram/anonymize.js?v=1.10.0";
import { onAnonymizeChange, toggleAnonymize } from "./instagram/anonymize-toggle.js?v=1.10.0";
import { gallery } from "./instagram/gallery.js?v=1.10.0";
import { closeReactionPopover, handleReactionClick, isReactionPopoverOpen } from "./instagram/reactions.js?v=1.10.0";
import {
    closeAllDrawers,
    closeMenu,
    dismissDrawer,
    handleDocumentClick,
    isMobileLayout,
    openDrawer,
    resolveConfirmSheet,
    setSidebarState,
    showToast,
    toggleMenu,
    toggleSidebar
} from "./instagram/ui.js?v=1.10.0";

const IG_APP_VERSION = "1.10.0";

const theme = createThemeController({ iconSelector: "#ig-theme-toggle i" });

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    theme.applySaved();
    igState.settings = readInstagramSettings();
    syncInstagramSettingsControls();
    bindUI();
    syncAnonymizeControls();
    document.querySelectorAll("[data-app-version]").forEach((el) => { el.textContent = `v${IG_APP_VERSION}`; });
    runSplashLoader();
    showCompatBannerIfNeeded();
    if (isMobileLayout()) setSidebarState(true);
    await initInstagramPersistence({ openImport: (file, record) => initViewer({ file, record }), closeThread: closeActiveThread });
});

window.addEventListener("resize", () => {
    if (!isMobileLayout()) setSidebarState(false);
});

// Not "beforeunload": it also fires for mailto: links, killing the open media.
window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    igState.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    igState.zipReader?.close().catch(() => {});
});

/** Back button: close whatever sits above the entry we landed on. */
window.addEventListener("popstate", (event) => {
    const keep = overlayOf(event);
    if (keep !== "igmedia") closeMediaModal();
    closeReactionPopover();
    // Back from the lightbox (or a drawer) over the gallery keeps it open.
    gallery.handlePopState(event);
    closeMenu();
    closeAllDrawers(keep);
    if (keep !== "ig-date-sheet") closeDateSheet({ fromHistory: true });
    if (keep !== "ig-wrapped") closeInstagramWrapped({ fromHistory: true });
    if (keep !== "ig-confirm") resolveConfirmSheet(false, { fromHistory: true });
});

// ── Event wiring ────────────────────────────────────────────────────────────

function bindUI() {
    $("ig-theme-toggle")?.addEventListener("click", theme.toggle);
    $("ig-open-settings")?.addEventListener("click", () => openDrawer("ig-settings"));
    $("ig-close-settings")?.addEventListener("click", () => dismissDrawer("ig-settings"));
    $("ig-mobile-menu")?.addEventListener("click", toggleSidebar);
    $("ig-sidebar-backdrop")?.addEventListener("click", toggleSidebar);

    setupFileIntake();

    $("ig-load-btn")?.addEventListener("click", () => initViewer());
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
    $("ig-live-search")?.addEventListener("keydown", handleSearchKeydown);
    $("ig-search-up")?.addEventListener("click", () => navSearch("up"));
    $("ig-search-down")?.addEventListener("click", () => navSearch("down"));
    $("ig-gallery-action")?.addEventListener("click", () => {
        closeMenu();
        gallery.open();
    });
    // The date sheet jumps the chat, so the gallery steps aside first (and its
    // history entry is gone before the sheet pushes its own).
    $("ig-date-jump-action")?.addEventListener("click", async () => {
        closeMenu();
        await gallery.dismiss({ restoreFocus: false });
        openDateSheet();
    });
    document.addEventListener("chatlume:show-chat", () => gallery.dismiss({ restoreFocus: false }));
    onAnonymizeChange(() => gallery.refresh());
    // The list re-renders (and the pill with it); the names in it change too.
    onAnonymizeChange(() => closeReactionPopover());
    $("ig-anonymize-toggle")?.addEventListener("click", () => toggleAnonymize());
    $("ig-anonymize-banner-off")?.addEventListener("click", () => toggleAnonymize(false));
    $("ig-date-sheet-cancel")?.addEventListener("click", () => closeDateSheet());
    $("ig-date-sheet-apply")?.addEventListener("click", applyDateJump);
    $("ig-date-sheet-input")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        applyDateJump();
    });
    $("ig-confirm-sheet-cancel")?.addEventListener("click", () => resolveConfirmSheet(false));
    $("ig-confirm-sheet-apply")?.addEventListener("click", () => resolveConfirmSheet(true));
    $("ig-confirm-sheet")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) resolveConfirmSheet(false); });
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
        syncBackButtons();
        if (isMobileLayout()) setSidebarState(true);
    }));
    document.querySelectorAll("[data-ig-back]").forEach((button) => button.addEventListener("click", showOpenThread));

    $("ig-sender-filter-btn")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const dropdown = $("ig-sender-filter-dropdown");
        const open = Boolean(dropdown?.hidden);
        if (dropdown) dropdown.hidden = !open;
        $("ig-sender-filter-btn")?.setAttribute("aria-expanded", String(open));
    });
    $("ig-sender-filter-list")?.addEventListener("change", applyInstagramSenderFilter);
    $("ig-sender-filter-close")?.addEventListener("click", () => {
        $("ig-sender-filter-dropdown")?.setAttribute("hidden", "");
        $("ig-sender-filter-btn")?.setAttribute("aria-expanded", "false");
        $("ig-sender-filter-btn")?.focus({ preventScroll: true });
    });
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
    $("ig-setting-identity")?.addEventListener("change", (event) => setThreadOwner(event.target.value));
    $("ig-storage-list")?.addEventListener("click", handleInstagramStorageClick);
    $("ig-stored-list")?.addEventListener("click", handleInstagramStorageClick);
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
    // Reaction pills first: they never sit inside a media button.
    $("ig-message-list")?.addEventListener("click", (event) => {
        if (handleReactionClick(event)) return;
        handleMessageListClick(event);
    });

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
    // Dates and times in the gallery follow the display settings.
    gallery.refresh();
}

function resetInstagramSettings() {
    const wasStoring = igState.settings.persistentStorage;
    igState.settings = writeInstagramSettings({ ...DEFAULT_IG_SETTINGS, persistentStorage: false });
    syncInstagramSettingsControls();
    if (wasStoring) handleInstagramStorageSetting({ target: { checked: false } });
    renderChatList();
    gallery.refresh();
    showToast("Instagram settings reset");
}

function applyInstagramSenderFilter() {
    applySenderSelection([...($("ig-sender-filter-list")?.querySelectorAll("input[type=checkbox]:checked") || [])].map((input) => input.value));
    if (isSearchOpen() && igState.searchQuery) runSearch(igState.searchQuery);
    else jumpToBottom();
    gallery.refresh();
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
    if (gallery.isMenuOpen()) { gallery.closeMenu({ restoreFocus: true }); return; }
    if (isReactionPopoverOpen()) { closeReactionPopover({ restoreFocus: true }); return; }
    if (igState.activeMediaId) { $("ig-media-modal-close")?.click(); return; }
    if ($("ig-confirm-sheet") && !$("ig-confirm-sheet").hidden) { resolveConfirmSheet(false); return; }
    if (!$("ig-date-sheet")?.hidden) { closeDateSheet(); return; }
    if (!$("ig-wrapped-modal")?.hidden) { closeInstagramWrapped(); return; }
    const senderDropdown = $("ig-sender-filter-dropdown");
    if (senderDropdown && !senderDropdown.hidden) {
        senderDropdown.hidden = true;
        $("ig-sender-filter-btn")?.setAttribute("aria-expanded", "false");
        $("ig-sender-filter-btn")?.focus({ preventScroll: true });
        return;
    }
    if (gallery.isOpen()) { gallery.dismiss(); return; }
    if (isSearchOpen()) { toggleSearch(); return; }
    const wasMenuOpen = $("ig-header-menu")?.classList.contains("show");
    closeMenu();
    if (wasMenuOpen) {
        $("ig-menu-toggle")?.focus();
        return;
    }
    if (closeAllDrawers()) popOverlayState();
}

// ── File intake ─────────────────────────────────────────────────────────────

/** Wires the picker, drop target and window-wide drop overlay. */
function setupFileIntake() {
    const fileInput = $("ig-file-input");
    $("ig-drop-target")?.addEventListener("click", () => fileInput?.click());
    // Clearing the value lets the same file be picked twice in a row. The
    // current selection stays, so cancelling the picker doesn't lose it.
    fileInput?.addEventListener("click", (event) => { event.target.value = ""; });
    fileInput?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (exceedsCompatLimit(file)) {
            showToast(COMPAT_LIMIT_MESSAGE, "error");
            event.target.value = "";
            return;
        }
        if (!/\.zip$/i.test(file.name)) {
            showToast("Please choose a .zip Instagram export", "error");
            event.target.value = "";
            return;
        }
        igState.selectedFile = file;
        reflectSelectedFile(file);
    });

    setupDropTarget($("ig-drop-target"));
    setupGlobalDropZone($("ig-drag-overlay"), handleDroppedFile);
}

/** A file dropped anywhere on the page. */
function handleDroppedFile(file) {
    if (igState.isLoading) return;
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
        $("ig-thread-panel")?.classList.add("hidden");
        $("ig-chat-list-panel")?.classList.add("hidden");
        $("ig-upload-panel").classList.remove("hidden");
        syncBackButtons();
        if (isMobileLayout()) setSidebarState(true);
        showToast("File ready — tap Load DMs to open it", "info");
    }
}
