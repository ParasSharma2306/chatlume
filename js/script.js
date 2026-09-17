/**
 * ============================================================================
 * ChatLume — WhatsApp viewer entry point
 * ============================================================================
 * Boots the viewer and wires DOM events to the modules that do the work:
 *
 *   whatsapp/state.js          shared mutable state + constants
 *   whatsapp/session.js        open / parse / close a chat
 *   whatsapp/parser.js         line-by-line parsing pipeline
 *   whatsapp/media.js          attachments, lazy loading, media viewer
 *   whatsapp/render.js         the virtualised message list
 *   whatsapp/search.js         in-chat search
 *   whatsapp/date-jump.js      "Go to Date"
 *   whatsapp/format.js         time / date display per Settings
 *   whatsapp/settings-*.js     Settings drawer
 *   whatsapp/persistence.js    Persistent Storage (Beta)
 *   whatsapp/wrapped.js        ChatLume Wrapped graphic
 *   whatsapp/ui.js             drawers, sheets, toasts, loading overlay
 *   shared/*                   utilities shared with the Instagram viewer
 *
 * The `?v=` token on every import is the release cache key — see
 * scripts/bump-version.mjs.
 * ============================================================================
 */
import { configure } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { $, isVisible } from "./shared/dom.js?v=1.6.2";
import { showCompatBannerIfNeeded } from "./shared/compat.js?v=1.6.2";
import { popOverlayState } from "./shared/history.js?v=1.6.2";
import { runSplashLoader } from "./shared/splash.js?v=1.6.2";
import { createThemeController } from "./shared/theme.js?v=1.6.2";
import { state } from "./whatsapp/state.js?v=1.6.2";
import { cleanupMediaStore, closeMediaModal, handleMessageListClick } from "./whatsapp/media.js?v=1.6.2";
import { handleViewportScroll, jumpToBottom } from "./whatsapp/render.js?v=1.6.2";
import { handleSearchInput, handleSearchShortcut, navSearch, toggleSearch } from "./whatsapp/search.js?v=1.6.2";
import {
    applyDateSheetSelection,
    cancelDateSheet,
    closeDateSheet,
    handleDateJumpAction
} from "./whatsapp/date-jump.js?v=1.6.2";
import { setupFileIntake } from "./whatsapp/file-picker.js?v=1.6.2";
import { loadSavedSettings, syncSettingsControls } from "./whatsapp/settings-store.js?v=1.6.2";
import { handleSettingChange, resetSettings } from "./whatsapp/settings-ui.js?v=1.6.2";
import { closeActiveChat, initViewer, loadChatFile } from "./whatsapp/session.js?v=1.6.2";
import {
    cancelPersistCopy,
    deleteAllStoredImports,
    handleStoredListClick,
    initPersistentStorage
} from "./whatsapp/persistence.js?v=1.6.2";
import { closeWrapped, closeWrappedFromHistory, downloadWrappedGraphic, openWrapped } from "./whatsapp/wrapped.js?v=1.6.2";
import {
    closeAllDrawers,
    closeDrawer,
    closeMenu,
    handleChatSelect,
    handleDocumentClick,
    handleProfilePictureChange,
    isMobileLayout,
    openDrawer,
    resolveConfirmSheet,
    setSidebarState,
    setUploadPanelVisible,
    toggleMenu,
    toggleSidebar
} from "./whatsapp/ui.js?v=1.6.2";

configure({ useDecompressionStream: typeof DecompressionStream !== "undefined" });

const APP_VERSION = "1.6.2";

const theme = createThemeController({ iconSelector: "#theme-toggle i" });

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    loadSavedSettings();
    bindUI();
    theme.applySaved();
    syncSettingsControls();
    document.querySelectorAll("[data-app-version]").forEach((el) => { el.textContent = `v${APP_VERSION}`; });
    runSplashLoader();
    showCompatBannerIfNeeded();
    if (isMobileLayout()) {
        setSidebarState(true);
    }
    setupPWAInstall();
    initPersistentStorage({ openFile: loadChatFile, closeChat: closeActiveChat });
});

window.addEventListener("resize", () => {
    if (!isMobileLayout()) { setSidebarState(false); }
});

window.addEventListener("beforeunload", (event) => {
    cleanupMediaStore();
    if (state.profileObjectUrl) {
        URL.revokeObjectURL(state.profileObjectUrl);
        state.profileObjectUrl = "";
    }
    // Closing mid-copy leaves a .part file that the next start-up sweeps away,
    // but the user probably wants to know the save didn't finish.
    if (state.persistJob) {
        event.preventDefault();
        event.returnValue = "";
    }
});

/** Back button: close whatever overlay is open (its history entry is already gone). */
window.addEventListener("popstate", () => {
    if (state.activeMediaId) closeMediaModal();
    closeWrappedFromHistory();
    closeDateSheet();
    resolveConfirmSheet(false, { fromHistory: true });
    closeMenu();
    closeAllDrawers();
});

// ── Event wiring ────────────────────────────────────────────────────────────

function bindUI() {
    // SAFE BINDINGS: optional chaining (?.) so nothing breaks on non-app pages.
    $("open-profile")?.addEventListener("click", () => openDrawer("profile"));
    $("open-stats")?.addEventListener("click", () => openDrawer("stats"));
    $("open-settings")?.addEventListener("click", () => openDrawer("settings"));
    $("open-info")?.addEventListener("click", () => openDrawer("info"));
    $("theme-toggle")?.addEventListener("click", theme.toggle);
    $("mobile-menu")?.addEventListener("click", toggleSidebar);
    $("sidebar-backdrop")?.addEventListener("click", toggleSidebar);
    $("chat-list-item")?.addEventListener("click", handleChatSelect);
    $("load-chat")?.addEventListener("click", initViewer);
    // Typing a name and hitting Enter is the obvious next move; without this it
    // did nothing and the Load button had to be hunted down.
    $("display-name")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        initViewer();
    });
    $("open-pfp-upload")?.addEventListener("click", () => $("pfp-upload")?.click());
    $("pfp-upload")?.addEventListener("change", handleProfilePictureChange);

    setupFileIntake();

    // Search
    $("search-toggle")?.addEventListener("click", toggleSearch);
    $("search-close")?.addEventListener("click", toggleSearch);
    $("search-up")?.addEventListener("click", () => navSearch("up"));
    $("search-down")?.addEventListener("click", () => navSearch("down"));
    $("live-search")?.addEventListener("input", handleSearchInput);

    // Header menu
    $("menu-toggle")?.addEventListener("click", toggleMenu);
    $("date-jump-action")?.addEventListener("click", handleDateJumpAction);
    $("jump-bottom-action")?.addEventListener("click", jumpToBottom);
    $("scroll-latest")?.addEventListener("click", jumpToBottom);

    // Sheets
    $("date-sheet-cancel")?.addEventListener("click", cancelDateSheet);
    $("date-sheet-apply")?.addEventListener("click", applyDateSheetSelection);
    $("confirm-sheet-cancel")?.addEventListener("click", () => resolveConfirmSheet(false));
    $("confirm-sheet-apply")?.addEventListener("click", () => resolveConfirmSheet(true));

    // Persistent Storage (Beta)
    $("persist-card-cancel")?.addEventListener("click", () => cancelPersistCopy());
    $("import-another")?.addEventListener("click", () => setUploadPanelVisible(true));
    $("upload-back")?.addEventListener("click", () => setUploadPanelVisible(false));
    $("storage-delete-all")?.addEventListener("click", deleteAllStoredImports);
    document.querySelectorAll("[data-stored-list], #storage-list").forEach((list) => {
        list.addEventListener("click", handleStoredListClick);
    });

    // Drawer back arrows
    document.querySelectorAll("[data-drawer-close]").forEach((button) => {
        button.addEventListener("click", () => {
            closeDrawer(button.dataset.drawerClose);
            popOverlayState();
        });
    });

    // Media viewer
    $("media-modal-close")?.addEventListener("click", () => {
        closeMediaModal();
        popOverlayState();
    });
    // Route through the close button so the pushed history entry is popped too.
    $("media-modal-backdrop")?.addEventListener("click", () => $("media-modal-close")?.click());

    // ChatLume Wrapped
    $("generate-wrapped")?.addEventListener("click", openWrapped);
    $("download-wrapped")?.addEventListener("click", downloadWrappedGraphic);
    $("close-wrapped")?.addEventListener("click", closeWrapped);
    $("wrapped-modal-backdrop")?.addEventListener("click", () => $("close-wrapped")?.click());

    // Settings
    document.querySelectorAll("[data-setting]").forEach((control) => {
        control.addEventListener("change", handleSettingChange);
    });
    $("reset-settings")?.addEventListener("click", resetSettings);

    // Message list
    $("viewport")?.addEventListener("scroll", handleViewportScroll);
    $("message-list")?.addEventListener("click", handleMessageListClick);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleGlobalKeydown);
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function handleGlobalKeydown(event) {
    if (event.key === "Escape") {
        handleEscape();
        return;
    }
    handleSearchShortcut(event);
}

/**
 * Closes the topmost overlay. Each check requires the element to exist and be
 * visible — `!$("wrapped-modal")?.hidden` was true when the element was simply
 * absent, so Escape returned early and never reached the open drawers.
 */
function handleEscape() {
    if (state.activeMediaId) {
        closeMediaModal();
        return;
    }
    if (isVisible($("wrapped-modal"))) {
        $("close-wrapped")?.click();
        return;
    }
    if (isVisible($("date-sheet"))) {
        closeDateSheet();
        return;
    }
    if (isVisible($("confirm-sheet"))) {
        resolveConfirmSheet(false);
        return;
    }
    if (state.isSearchOpen) {
        toggleSearch();
        return;
    }
    closeMenu();
    closeAllDrawers();
}

// ── PWA install ─────────────────────────────────────────────────────────────

let deferredPrompt;

/** Shows the sidebar "Install app" button once the browser offers a prompt. */
function setupPWAInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = $("install-pwa");
        if (installBtn) {
            installBtn.hidden = false;
            installBtn.addEventListener("click", async () => {
                // site.js shows an install card from the same event; whichever
                // the user takes first consumes the prompt, so calling it again
                // rejects. Fail quietly rather than throwing.
                if (!deferredPrompt) {
                    installBtn.hidden = true;
                    return;
                }
                try {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    if (outcome === "accepted") {
                        installBtn.hidden = true;
                    }
                } catch (err) {
                    installBtn.hidden = true;
                } finally {
                    deferredPrompt = null;
                }
            }, { once: true });
        }
    });
}
