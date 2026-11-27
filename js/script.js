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
 *   whatsapp/gallery.js        Media, links and voice notes gallery
 *   whatsapp/format.js         time / date display per Settings
 *   whatsapp/settings-*.js     Settings drawer
 *   whatsapp/persistence.js    Persistent Storage
 *   whatsapp/wrapped.js        ChatLume Wrapped graphic
 *   whatsapp/ui.js             drawers, sheets, toasts, loading overlay
 *   shared/*                   utilities shared with the Instagram viewer
 *
 * The `?v=` token on every import is the release cache key — see
 * scripts/bump-version.mjs.
 * ============================================================================
 */
import { $, isVisible } from "./shared/dom.js?v=1.10.1";
import { showCompatBannerIfNeeded } from "./shared/compat.js?v=1.10.1";
import { overlayOf, popOverlayState } from "./shared/history.js?v=1.10.1";
import { runSplashLoader } from "./shared/splash.js?v=1.10.1";
import { createThemeController } from "./shared/theme.js?v=1.10.1";
import { state } from "./whatsapp/state.js?v=1.10.1";
import { cleanupMediaStore, closeMediaModal, handleMessageListClick } from "./whatsapp/media.js?v=1.10.1";
import { handleViewportScroll, jumpToBottom } from "./whatsapp/render.js?v=1.10.1";
import { handleSearch, handleSearchInput, handleSearchKeydown, handleSearchShortcut, navSearch, toggleSearch } from "./whatsapp/search.js?v=1.10.1";
import { filterSidebarChats } from "./whatsapp/sidebar-search.js?v=1.10.1";
import {
    applySenderFilter,
    clearSenderFilter,
    filterSenderList,
    closeSenderFilterDropdown,
    isSenderFilterDropdownOpen,
    toggleSender,
    toggleSenderFilterDropdown
} from "./whatsapp/filter.js?v=1.10.1";
import {
    applyDateSheetSelection,
    cancelDateSheet,
    closeDateSheet,
    handleDateJumpAction
} from "./whatsapp/date-jump.js?v=1.10.1";
import { setupFileIntake } from "./whatsapp/file-picker.js?v=1.10.1";
import { loadSavedSettings, syncSettingsControls } from "./whatsapp/settings-store.js?v=1.10.1";
import { handleSettingChange, resetSettings } from "./whatsapp/settings-ui.js?v=1.10.1";
import { closeActiveChat, initViewer, loadChatFile, setChatOwner } from "./whatsapp/session.js?v=1.10.1";
import {
    cancelPersistCopy,
    deleteAllStoredImports,
    handleStoredListClick,
    initPersistentStorage
} from "./whatsapp/persistence.js?v=1.10.1";
import { closeWrapped, closeWrappedFromHistory, downloadWrappedGraphic, openWrapped } from "./whatsapp/wrapped.js?v=1.10.1";
import { syncAnonymizeControls } from "./whatsapp/anonymize.js?v=1.10.1";
import { onAnonymizeChange, toggleAnonymize } from "./whatsapp/anonymize-toggle.js?v=1.10.1";
import { gallery } from "./whatsapp/gallery.js?v=1.10.1";
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
    showToast,
    toggleMenu,
    toggleSidebar
} from "./whatsapp/ui.js?v=1.10.1";

const APP_VERSION = "1.10.1";

const theme = createThemeController({ iconSelector: "#theme-toggle i" });

// Keep the mobile participant sheet sized to the visible viewport when the
// on-screen keyboard opens. CSS viewport units remain the fallback.
const visualViewport = window.visualViewport;
if (visualViewport) {
    const syncParticipantSheetViewport = () => {
        document.documentElement.style.setProperty(
            "--participant-sheet-viewport-height",
            `${Math.round(visualViewport.height)}px`
        );
    };
    syncParticipantSheetViewport();
    visualViewport.addEventListener("resize", syncParticipantSheetViewport);
}

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    loadSavedSettings();
    bindUI();
    syncAnonymizeControls();
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

// Not "beforeunload": that also fires for mailto: links and for a leave the user
// then cancels, which left the open chat with every attachment dead.
window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    cleanupMediaStore();
    if (state.profileObjectUrl) {
        URL.revokeObjectURL(state.profileObjectUrl);
        state.profileObjectUrl = "";
    }
});

window.addEventListener("beforeunload", (event) => {
    // Closing mid-copy leaves a .part file that the next start-up sweeps away,
    // but the user probably wants to know the save didn't finish.
    if (state.persistJob) {
        event.preventDefault();
        event.returnValue = "";
    }
});

/** Back button: close whatever sits above the entry we landed on. */
window.addEventListener("popstate", (event) => {
    const keep = overlayOf(event);
    if (state.activeMediaId && keep !== "media") closeMediaModal();
    // Back from the lightbox (or a drawer) over the gallery keeps it open.
    gallery.handlePopState(event);
    if (keep !== "wrapped") closeWrappedFromHistory();
    if (keep !== "date-sheet") closeDateSheet();
    if (keep !== "confirm") resolveConfirmSheet(false, { fromHistory: true });
    closeMenu();
    closeSenderFilterDropdown();
    closeAllDrawers(keep);
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
    $("sidebar-chat-search")?.addEventListener("input", (event) => filterSidebarChats(event.target.value));
    $("search-toggle")?.addEventListener("click", toggleSearch);
    $("search-close")?.addEventListener("click", toggleSearch);
    $("search-up")?.addEventListener("click", () => navSearch("up"));
    $("search-down")?.addEventListener("click", () => navSearch("down"));
    $("live-search")?.addEventListener("input", handleSearchInput);
    $("live-search")?.addEventListener("keydown", handleSearchKeydown);

    // Sender filter
    const filterOptions = {
        onRender: () => {
            jumpToBottom();
            gallery.refresh();
        },
        onSearch: (query) => {
            handleSearch(query);
            gallery.refresh();
        },
        onToast: showToast
    };
    $("sender-filter-btn")?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleSenderFilterDropdown();
    });
    $("sender-filter-btn")?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" || isSenderFilterDropdownOpen()) return;
        event.preventDefault();
        toggleSenderFilterDropdown(true);
    });
    $("sender-filter-close")?.addEventListener("click", () => {
        closeSenderFilterDropdown();
        $("sender-filter-btn")?.focus({ preventScroll: true });
    });
    $("sender-filter-reset-btn")?.addEventListener("click", (event) => {
        event.stopPropagation();
        clearSenderFilter(filterOptions);
        const searchInput = $("sender-filter-search");
        if (searchInput) {
            searchInput.value = "";
            filterSenderList("");
        }
    });
    $("sender-filter-list")?.addEventListener("change", (event) => {
        const checkbox = event.target;
        if (!checkbox || checkbox.type !== "checkbox") return;
        toggleSender(checkbox.value, checkbox.checked, filterOptions);
    });
    $("sender-filter-search")?.addEventListener("input", (event) => {
        filterSenderList(event.target.value);
    });
    $("sender-filter-search-clear")?.addEventListener("click", () => {
        const input = $("sender-filter-search");
        if (!input) return;
        input.value = "";
        filterSenderList("");
        input.focus({ preventScroll: true });
    });

    // Header menu
    $("menu-toggle")?.addEventListener("click", toggleMenu);
    $("menu-toggle")?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" || $("header-menu")?.classList.contains("show")) return;
        event.preventDefault();
        toggleMenu(true);
        $("header-menu")?.querySelector(".menu-item")?.focus();
    });
    $("header-menu")?.addEventListener("keydown", (event) => {
        const items = [...event.currentTarget.querySelectorAll(".menu-item:not(:disabled)")];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
            $("menu-toggle")?.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(index + step + items.length) % items.length].focus();
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            items[event.key === "Home" ? 0 : items.length - 1].focus();
        }
    });
    $("gallery-action")?.addEventListener("click", () => {
        closeMenu();
        gallery.open();
    });
    // The date sheet jumps the chat, so the gallery steps aside first (and its
    // history entry is gone before the sheet pushes its own).
    $("date-jump-action")?.addEventListener("click", async (event) => {
        event.preventDefault();
        closeMenu();
        await gallery.dismiss({ restoreFocus: false });
        handleDateJumpAction(event);
    });
    document.addEventListener("chatlume:show-chat", () => gallery.dismiss({ restoreFocus: false }));
    onAnonymizeChange(() => gallery.refresh());
    $("anonymize-toggle")?.addEventListener("click", () => toggleAnonymize());
    $("anonymize-banner-off")?.addEventListener("click", () => toggleAnonymize(false));
    $("scroll-latest")?.addEventListener("click", jumpToBottom);

    // Sheets
    $("date-sheet-cancel")?.addEventListener("click", cancelDateSheet);
    $("date-sheet-apply")?.addEventListener("click", applyDateSheetSelection);
    $("date-sheet-input")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        applyDateSheetSelection();
    });
    $("date-sheet")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) cancelDateSheet(); });
    $("confirm-sheet")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) resolveConfirmSheet(false); });
    $("confirm-sheet-cancel")?.addEventListener("click", () => resolveConfirmSheet(false));
    $("confirm-sheet-apply")?.addEventListener("click", () => resolveConfirmSheet(true));

    // Persistent Storage
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
        control.addEventListener("change", (event) => {
            handleSettingChange(event);
            // Dates and times in the gallery follow the display settings.
            gallery.refresh();
        });
    });
    $("setting-identity")?.addEventListener("change", (event) => setChatOwner(event.target.value));
    $("reset-settings")?.addEventListener("click", () => {
        resetSettings();
        gallery.refresh();
    });

    // Message list
    $("viewport")?.addEventListener("scroll", handleViewportScroll);
    $("message-list")?.addEventListener("click", handleMessageListClick);
    document.addEventListener("click", (event) => {
        handleDocumentClick(event);
        if (isSenderFilterDropdownOpen()) {
            const container = $("sender-filter-container");
            if (container && !container.contains(event.target)) {
                closeSenderFilterDropdown();
            }
        }
    });
    document.addEventListener("focusin", (event) => {
        const container = $("sender-filter-container");
        if (isSenderFilterDropdownOpen() && container && !container.contains(event.target)) {
            closeSenderFilterDropdown();
        }
    });
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
    if (gallery.isMenuOpen()) {
        gallery.closeMenu({ restoreFocus: true });
        return;
    }
    if (isSenderFilterDropdownOpen()) {
        closeSenderFilterDropdown();
        $("sender-filter-btn")?.focus();
        return;
    }
    if (state.activeMediaId) {
        $("media-modal-close")?.click();
        return;
    }
    if (isVisible($("wrapped-modal"))) {
        $("close-wrapped")?.click();
        return;
    }
    if (isVisible($("date-sheet"))) {
        cancelDateSheet();
        return;
    }
    if (isVisible($("confirm-sheet"))) {
        resolveConfirmSheet(false);
        return;
    }
    if (gallery.isOpen()) {
        gallery.dismiss();
        return;
    }
    if (state.isSearchOpen) {
        toggleSearch();
        return;
    }
    const wasMenuOpen = $("header-menu")?.classList.contains("show");
    closeMenu();
    if (wasMenuOpen) {
        $("menu-toggle")?.focus();
        return;
    }
    if (closeAllDrawers()) popOverlayState();
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
