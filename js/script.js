/**
 * ============================================================================
 * ChatLume Core Script
 * ============================================================================
 * This file handles the main WhatsApp viewer logic, including:
 * - File parsing (ZIP and TXT)
 * - Message rendering and DOM manipulation
 * - Chat analytics and wrapped generation
 * - Theme and settings management
 * ============================================================================
 */
import { configure, BlobReader, ZipReader, BlobWriter } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { exportChatAsHTML } from './export.js?v=1.6.1';
import { showSponsorPrompt } from './support.js?v=1.6.1';
import * as storage from './storage.js?v=1.6.1';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings.js?v=1.6.1';
import {
    attachmentLookupKey,
    extractAttachmentTokens as parserExtractAttachmentTokens,
    extractDatePart as parserExtractDatePart,
    extractTimePart as parserExtractTimePart,
    hourOf,
    inferDateOrder as parserInferDateOrder,
    looksLikeTimestampLine,
    normalizeLine,
    parseDateLabel,
    parseHeaderLine,
    parseTimestamp,
    resolveDateOrder,
    stripInvisible
} from './whatsapp-parser.js?v=1.6.1';
configure({ useDecompressionStream: typeof DecompressionStream !== 'undefined' });

const SUPPORTS_STREAMING =
    typeof DecompressionStream !== 'undefined' &&
    typeof WritableStream !== 'undefined' &&
    typeof TextDecoderStream !== 'undefined';
const COMPAT_FILE_SIZE_LIMIT = 1 * 1024 * 1024 * 1024; // 1 GB cap for browsers without streaming APIs

const BATCH_SIZE = 60;
const MAX_RENDERED_ITEMS = 180;
const COLORS = ["#e542a3", "#1f7aec", "#d44638", "#2ecc71", "#f39c12", "#9b59b6", "#3498db", "#1abc9c"];
const STORAGE_KEYS = {
    theme: "chatlume-theme",
    settings: "chatlume-settings",
    lastImport: "chatlume-last-import",
    // Set the first time a chat is kept, so users who never turned the feature
    // on don't pay for a storage lookup at boot.
    persistUsed: "chatlume-persist-used"
};
const SITE_URL = "https://chatlume.app";
const ISSUES_URL = "https://github.com/ParasSharma2306/chatlume/issues/new";
const APP_VERSION = "1.6.1";
const SEARCH_DEBOUNCE_MS = 120;
const state = {
    messages: [],
    filteredMessages: [],
    messageOnlyCount: 0,
    myName: "",
    renderRange: { start: 0, end: 0 },
    colorMap: {},
    senderStats: {},
    emojiStats: {},
    hourlyStats: Array(24).fill(0),
    mediaCount: 0,
    mediaStore: new Map(),
    mediaLookup: new Map(),
    mediaUrls: new Set(),
    mediaMissingCount: 0,
    selectedFile: null,
    settings: { ...DEFAULT_SETTINGS },
    searchResults: [],
    searchPointer: -1,
    searchTimer: null,
    inferredDateOrder: "DMY",
    parseDiagnostics: { unrecognizedHeaders: 0, unrecognizedSample: "" },
    profileObjectUrl: "",
    activeTheme: "dark",
    activeMediaId: "",
    chatTitle: "Chat History",
    toastTimer: null,
    isSearchOpen: false,
    isLoading: false,
    loadGeneration: 0,
    zipReader: null,
    mediaObserver: null,
    // Persistent Storage (Beta)
    storageSupported: false,
    storedImports: [],
    storedImportsLoaded: false,
    activeImportId: "",
    persistJob: null
};

let deferredPrompt;

const $ = (id) => document.getElementById(id);
const q = (selector, root = document) => root.querySelector(selector);

// Safari's private mode and "block all cookies" make every localStorage access
// throw. An unguarded read during boot took out the rest of DOMContentLoaded,
// which left the splash loader on screen forever — the app looked hung.
function readStored(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function writeStored(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        return false;
    }
}

function removeStored(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        // Nothing to forget.
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    loadSavedSettings();
    bindUI();
    applySavedTheme();
    syncSettingsControls();
    document.querySelectorAll("[data-app-version]").forEach((el) => { el.textContent = `v${APP_VERSION}`; });
    runLoader();
    checkBrowserCompatibility();
    if (window.innerWidth <= 800) {
        setSidebarState(true);
    }
    setupPWAInstall();
    initPersistentStorage();
});

window.addEventListener("resize", () => {
    if (window.innerWidth > 800) { setSidebarState(false); }
});

window.addEventListener("beforeunload", (event) => {
    cleanupObjectUrls();
    // Closing mid-copy leaves a .part file that the next start-up sweeps away,
    // but the user probably wants to know the save didn't finish.
    if (state.persistJob) {
        event.preventDefault();
        event.returnValue = "";
    }
});

function bindUI() {
    // SAFE BINDINGS: We use optional chaining (?.) so it doesn't break on non-app pages
    $("open-profile")?.addEventListener("click", () => openDrawer("profile"));
    $("open-stats")?.addEventListener("click", () => openDrawer("stats"));
    $("open-settings")?.addEventListener("click", () => openDrawer("settings"));
    $("open-info")?.addEventListener("click", () => openDrawer("info"));
    $("theme-toggle")?.addEventListener("click", toggleTheme);
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
    
    const fileInput = $("file-input");
    $("drop-target")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("click", (e) => {
        e.target.value = null;
        state.selectedFile = null;
        resetSelectedFileUI();
    }); // Allow re-selecting the same file
    $("file-input")?.addEventListener("change", handleFileInputChange);
    $("pfp-upload")?.addEventListener("change", handleProfilePictureChange);
    $("search-toggle")?.addEventListener("click", toggleSearch);
    $("search-close")?.addEventListener("click", toggleSearch);
    $("search-up")?.addEventListener("click", () => navSearch("up"));
    $("search-down")?.addEventListener("click", () => navSearch("down"));
    $("live-search")?.addEventListener("input", handleSearchInput);
    $("menu-toggle")?.addEventListener("click", toggleMenu);
    $("date-jump-action")?.addEventListener("click", handleDateJumpAction);
    $("jump-bottom-action")?.addEventListener("click", jumpToBottom);
    $("scroll-latest")?.addEventListener("click", jumpToBottom);
    $("date-sheet-cancel")?.addEventListener("click", () => {
        closeDateSheet();
        if (history.state && history.state.overlay) history.back();
    });
    $("date-sheet-apply")?.addEventListener("click", applyDateSheetSelection);
    $("confirm-sheet-cancel")?.addEventListener("click", () => resolveConfirmSheet(false));
    $("confirm-sheet-apply")?.addEventListener("click", () => resolveConfirmSheet(true));
    $("persist-card-cancel")?.addEventListener("click", cancelPersistCopy);
    $("import-another")?.addEventListener("click", () => setUploadPanelVisible(true));
    $("upload-back")?.addEventListener("click", () => setUploadPanelVisible(false));
    $("storage-delete-all")?.addEventListener("click", deleteAllStoredImports);
    document.querySelectorAll("[data-stored-list], #storage-list").forEach((list) => {
        list.addEventListener("click", handleStoredListClick);
    });
    
    // UI BACK ARROWS FOR DRAWERS
    document.querySelectorAll("[data-drawer-close]").forEach((button) => {
        button.addEventListener("click", () => {
            closeDrawer(button.dataset.drawerClose);
            if (history.state && history.state.overlay) history.back();
        });
    });

    $("media-modal-close")?.addEventListener("click", () => {
        closeMediaModal();
        if (history.state && history.state.overlay) history.back();
    });
    
    $("media-modal-backdrop")?.addEventListener("click", () => $("media-modal-close")?.click());

    // WRAPPED FEATURE
    $("generate-wrapped")?.addEventListener("click", () => {
        if (state.messageOnlyCount === 0) {
            showToast("Load a chat first to generate ChatLume Wrapped!", "warn");
            return;
        }
        populateWrappedGraphic();
        $("wrapped-modal").hidden = false;
        requestAnimationFrame(() => $("wrapped-modal").classList.add("open"));
        pushHistoryState("wrapped"); // Tie to hardware back button
    });

    $("download-wrapped")?.addEventListener("click", downloadWrappedGraphic);
    
    $("close-wrapped")?.addEventListener("click", () => {
        const modal = $("wrapped-modal");
        modal.classList.remove("open");
        window.setTimeout(() => modal.hidden = true, 120);
        if (history.state && history.state.overlay) history.back();
    });

    $("wrapped-modal-backdrop")?.addEventListener("click", () => $("close-wrapped")?.click());
    document.querySelectorAll("[data-setting]").forEach((control) => {
        control.addEventListener("change", handleSettingChange);
    });
    $("reset-settings")?.addEventListener("click", resetSettings);

    setupDropTarget();
    setupGlobalDropZone();
    $("viewport")?.addEventListener("scroll", handleViewportScroll);
    $("message-list")?.addEventListener("click", handleMessageListClick);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleGlobalKeydown);
}

function pushHistoryState(overlayId) {
    if (history.state && history.state.overlay === overlayId) return;
    history.pushState({ overlay: overlayId }, "");
}

window.addEventListener("popstate", () => {
    if (state.activeMediaId) closeMediaModal();
    
    const wrappedModal = $("wrapped-modal");
    if (wrappedModal && !wrappedModal.hidden) {
        wrappedModal.classList.remove("open");
        window.setTimeout(() => {
            if (!wrappedModal.classList.contains("open")) {
                wrappedModal.hidden = true;
            }
        }, 120);
    }
    
    closeDateSheet();
    resolveConfirmSheet(false, { fromHistory: true });
    closeMenu();
    document.querySelectorAll(".drawer.open").forEach((drawer) => drawer.classList.remove("open"));
});

function setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
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
                    if (outcome === 'accepted') {
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

// Brand name updates in image generator
async function downloadWrappedGraphic() {
    const element = $("wrapped-graphic");
    if (!element) return;

    const btn = $("download-wrapped");
    const oldText = btn.innerHTML;
    btn.innerHTML = `<i class="ph-fill ph-spinner-gap processing-spinner" style="font-size: 18px; margin-right: 8px;"></i> Generating...`;
    btn.disabled = true;

    try {
        if (typeof html2canvas === "undefined") {
            showToast("Loading image generator...", "info");
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load image generator"));
                document.head.appendChild(script);
            });
        }

        // html2canvas rasterises whatever is decoded at call time — an undecoded
        // logo would come out blank in the downloaded PNG.
        await Promise.all(
            Array.from(element.querySelectorAll("img")).map((img) =>
                img.complete ? Promise.resolve() : img.decode().catch(() => {})
            )
        );

        const canvas = await html2canvas(element, {
            backgroundColor: "#000",
            scale: 2,
            useCORS: true,
            logging: false
        });
        
        const link = document.createElement("a");
        const safeTitle = state.chatTitle.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
        link.download = `ChatLume_Wrapped_${safeTitle}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        showToast("Image downloaded!");
    } catch (err) {
        console.error(err);
        showToast("Failed to download image.", "error");
    } finally {
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}

function runLoader() {
    const loader = $("loader");
    const bar = q(".fill");

    if (bar) {
        window.setTimeout(() => {
            bar.style.width = "100%";
        }, 100);
    }

    if (loader) {
        window.setTimeout(() => {
            loader.style.opacity = "0";
            window.setTimeout(() => {
                loader.style.display = "none";
            }, 500);
        }, 800);
    }
}

function applySavedTheme() {
    const saved = readStored(STORAGE_KEYS.theme);
    if (saved === "light") {
        document.body.classList.add("light-theme");
        state.activeTheme = "light";
    } else {
        document.body.classList.remove("light-theme");
        state.activeTheme = "dark"; // Defaults to dark!
    }
    syncThemeButton();
}

function toggleTheme() {
    document.body.classList.toggle("light-theme");
    state.activeTheme = document.body.classList.contains("light-theme") ? "light" : "dark";
    writeStored(STORAGE_KEYS.theme, state.activeTheme);
    syncThemeButton();
}

function syncThemeButton() {
    const icon = q("#theme-toggle i");
    const themeColor = q('meta[name="theme-color"]');
    if (icon) {
        icon.className = state.activeTheme === "light" ? "ph ph-sun-dim" : "ph ph-moon-stars";
    }
    if (themeColor) {
        themeColor.setAttribute("content", state.activeTheme === "light" ? "#f0f2f5" : "#111b21");
    }
}

function loadSavedSettings() {
    try {
        const saved = JSON.parse(readStored(STORAGE_KEYS.settings) || "{}");
        state.settings = sanitizeSettings(saved);
    } catch (error) {
        console.warn("Unable to load settings:", error);
        state.settings = { ...DEFAULT_SETTINGS };
    }
}

function saveSettings() {
    writeStored(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

function syncSettingsControls() {
    document.querySelectorAll("[data-setting]").forEach((control) => {
        const key = control.dataset.setting;
        if (!(key in state.settings)) return;

        if (control.type === "checkbox") {
            control.checked = Boolean(state.settings[key]);
            return;
        }
        control.value = state.settings[key];
    });
}

function handleSettingChange(event) {
    const control = event.currentTarget;
    const key = control.dataset.setting;
    if (!(key in state.settings)) return;

    state.settings[key] = control.type === "checkbox" ? control.checked : control.value;
    state.settings = sanitizeSettings(state.settings);
    saveSettings();
    syncSettingsControls();
    if (key === "persistentStorage") {
        handlePersistentStorageToggle();
        return;
    }
    rerenderAfterSettingsChange();
}

function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    syncSettingsControls();
    refreshStorageSettingsUI();
    rerenderAfterSettingsChange();
    showToast("Settings reset");
}

function rerenderAfterSettingsChange() {
    if (state.filteredMessages.length) {
        // The calendar setting changes which day/month orders are valid, so
        // the inferred order is recomputed from the (cheap) date labels.
        state.inferredDateOrder = inferDateOrder(state.messages.filter(e => e.type === "date").map(e => e.content));
        renderChatList();
        generateStats();
    }
}

function setupDropTarget() {
    const dropTarget = $("drop-target");
    if (!dropTarget) return;

    ["dragenter", "dragover"].forEach((eventName) => {
        dropTarget.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropTarget.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropTarget.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropTarget.classList.remove("dragover");
        });
    });

    dropTarget.addEventListener("drop", (event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        if (!SUPPORTS_STREAMING && file.size > COMPAT_FILE_SIZE_LIMIT) {
            showToast("File exceeds the 1 GB limit for your browser. Use Chrome 80+, Firefox 79+, or Safari 16.4+ for larger files.", "error");
            return;
        }
        const fileInput = $("file-input");
        state.selectedFile = file;
        try {
            if (fileInput) fileInput.files = files;
        } catch (error) {
            console.warn("Unable to assign dropped files to input:", error);
        }
        reflectSelectedFile(file);
    });
}

// Full-window drag-and-drop overlay. Uses a dragenter/dragleave depth counter
// so the overlay doesn't flicker when the cursor crosses child elements.
function setupGlobalDropZone() {
    const overlay = $("drag-overlay");
    if (!overlay) return;

    let depth = 0;
    const dragHasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    const show = () => overlay.classList.add("active");
    const hide = () => { overlay.classList.remove("active"); overlay.classList.remove("error"); };

    window.addEventListener("dragenter", (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        depth += 1;
        show();
    });

    window.addEventListener("dragover", (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
    });

    window.addEventListener("dragleave", (event) => {
        if (!dragHasFiles(event)) return;
        depth -= 1;
        if (depth <= 0) {
            depth = 0;
            hide();
        }
    });

    window.addEventListener("drop", (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        depth = 0;
        hide();
        const file = event.dataTransfer?.files?.[0];
        if (file) handleDroppedFile(file);
    });
}

function handleDroppedFile(file) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".zip")) {
        showToast("Please drop a WhatsApp .txt or .zip export", "error");
        return;
    }
    if (!SUPPORTS_STREAMING && file.size > COMPAT_FILE_SIZE_LIMIT) {
        showToast("File exceeds the 1 GB limit for your browser. Use Chrome 80+, Firefox 79+, or Safari 16.4+ for larger files.", "error");
        return;
    }

    state.selectedFile = file;
    const fileInput = $("file-input");
    try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (fileInput) fileInput.files = transfer.files;
    } catch (error) {
        console.warn("Unable to assign dropped file to input:", error);
    }
    reflectSelectedFile(file);

    // If a chat is already open, the upload panel is hidden — let the user know
    // how to reach the file they just dropped.
    if ($("upload-panel")?.classList.contains("hidden")) {
        setUploadPanelVisible(true);
        if (window.innerWidth <= 800) setSidebarState(true);
        showToast("File ready — tap Load Chat to open it", "info");
    }
}

function checkBrowserCompatibility() {
    if (SUPPORTS_STREAMING) return;
    const nav = document.querySelector("nav.app-nav");
    const banner = document.createElement("div");
    banner.id = "compat-banner";
    banner.setAttribute("role", "alert");
    banner.style.cssText = "background:#7c5c00;color:#fef3c7;padding:8px 16px;font-size:13px;text-align:center;position:sticky;top:0;z-index:999;line-height:1.5";
    banner.textContent = "⚠️ Your browser has limited support. Files over 1 GB may not load. Please use Chrome 80+, Firefox 79+, or Safari 16.4+.";
    if (nav?.parentNode) {
        nav.parentNode.insertBefore(banner, nav.nextSibling);
    } else {
        document.body.prepend(banner);
    }
}

function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!SUPPORTS_STREAMING && file.size > COMPAT_FILE_SIZE_LIMIT) {
        showToast("File exceeds the 1 GB limit for your browser. Use Chrome 80+, Firefox 79+, or Safari 16.4+ for larger files.", "error");
        event.target.value = "";
        return;
    }
    state.selectedFile = file;
    reflectSelectedFile(file);
}

function reflectSelectedFile(file) {
    const dropTarget = $("drop-target");
    if (!dropTarget) return;

    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);

    dropTarget.classList.add("ready");
    if (icon) {
        icon.className = "ph-fill ph-check-circle";
        icon.style.color = "#00a884";
    }
    if (label) {
        label.innerHTML = `<strong>${escapeHtml(file.name)}</strong><br><span style="font-size:12px;opacity:0.7">Ready to load</span>`;
    }
}

function resetSelectedFileUI() {
    const dropTarget = $("drop-target");
    if (!dropTarget) return;

    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);

    dropTarget.classList.remove("ready");
    if (icon) {
        icon.className = "ph ph-file-arrow-up";
        icon.style.color = "";
    }
    if (label) {
        label.innerHTML = 'Drop <strong>.txt</strong> or <strong>.zip</strong>';
    }
}

async function initViewer() {
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
async function loadChatFile(file, { displayName, fileLabel = file.name, persist = false, importId = "" } = {}) {
    if (state.isLoading) return;

    state.myName = displayName;
    state.activeImportId = "";

    const isZip = file.name.toLowerCase().endsWith(".zip");
    const initText = isZip ? "Opening ZIP and scanning entries..." : "Reading text file...";
    
    setLoadingState(true, `Loading ${fileLabel}`, initText);
    
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 60));

    cleanupMediaStore();
    resetChatState();
    restoreEmptyState();

    if (window.innerWidth <= 800) {
        setSidebarState(false);
    }

    const gen = ++state.loadGeneration;

    if (!SUPPORTS_STREAMING && file.size > COMPAT_FILE_SIZE_LIMIT) {
        setLoadingState(false);
        showToast(`File is too large for your browser (${(file.size / 1073741824).toFixed(1)} GB). Use Chrome 80+, Firefox 79+, or Safari 16.4+ for files over 1 GB.`, "error");
        return;
    }

    try {
        let { rawText, chatEntry, attachments } = await loadChatExport(file);

        updateLoadingCopy(
            attachments.length
                ? `Matched ${attachments.length.toLocaleString()} attachments. Extracting chat...`
                : "Extracting chat..."
        );

        await new Promise(resolve => setTimeout(resolve, 30));

        buildMediaStore(attachments);
        if (chatEntry) {
            await parseChatDataFromEntry(chatEntry, gen);
        } else {
            await parseChatData(rawText);
            rawText = null; // release large string after parsing
        }

        if (state.messageOnlyCount === 0) {
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
                actions: `<a class="empty-cta" href="how-to-export.html"><i class="ph ph-question"></i> How to export WhatsApp chats</a>`
            });
            showToast("No messages could be parsed from this export", "error");
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
            actions: `<a class="empty-cta" href="how-to-export.html"><i class="ph ph-question"></i> How to export WhatsApp chats</a>`
        });
        if (!shown) {
            showToast(`Error: ${error.message}`, "error");
        }
    } finally {
        setLoadingState(false);
    }
}

async function loadChatExport(file) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
        return { rawText: await readFileAsText(file), chatEntry: null, attachments: [] };
    }

    const reader = new ZipReader(new BlobReader(file));
    state.zipReader = reader;
    const allEntries = await reader.getEntries();

    const entries = allEntries.filter(e => !e.directory && !e.filename.startsWith("__MACOSX/"));
    const chatEntry = entries
        .filter(e => e.filename.toLowerCase().endsWith(".txt"))
        .sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];

    if (!chatEntry) {
        throw new Error("No .txt file found in ZIP");
    }

    const attachments = entries
        .filter(e => e !== chatEntry)
        .map(e => ({
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


function resetChatState() {
    state.messages = [];
    state.filteredMessages = [];
    state.messageOnlyCount = 0;
    state.colorMap = {};
    state.senderStats = {};
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
    disconnectMediaObserver();
    updateSearchCounter();
    setSearchEmptyState(false);
    if ($("message-list")) $("message-list").innerHTML = "";
    if ($("emoji-grid")) $("emoji-grid").innerHTML = "";
}

function cleanupMediaStore() {
    state.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    state.mediaUrls.clear();
    state.mediaStore.clear();
    state.mediaLookup.clear();
    if (state.zipReader) {
        state.zipReader.close().catch(() => {});
        state.zipReader = null;
    }
    disconnectMediaObserver();
    closeMediaModal();
}

async function ensureMediaUrl(media) {
    if (!media) {
        throw new Error("Media not found");
    }
    if (media.url) {
        return media.url;
    }
    if (media.loadingPromise) {
        return media.loadingPromise;
    }
    if (!media.entry) {
        throw new Error("Media source is unavailable");
    }

    media.loadingPromise = media.entry
        .getData(new BlobWriter(media.mime || "application/octet-stream"))
        .then((blob) => {
            media.size = media.size || blob.size;
            const objectUrl = URL.createObjectURL(blob);
            media.url = objectUrl;
            state.mediaUrls.add(objectUrl);
            return objectUrl;
        })
        .finally(() => {
            media.loadingPromise = null;
        });

    return media.loadingPromise;
}

async function downloadMedia(mediaId) {
    const media = state.mediaStore.get(mediaId);
    if (!media) return;

    try {
        const url = await ensureMediaUrl(media);
        const link = document.createElement("a");
        link.href = url;
        link.download = media.name;
        link.click();
        window.setTimeout(() => releaseMediaUrlIfUnused(media), 1000);
    } catch (error) {
        console.error(error);
        showToast("Unable to download media", "error");
    }
}

function releaseMediaUrl(media) {
    if (!media?.url) return;
    URL.revokeObjectURL(media.url);
    state.mediaUrls.delete(media.url);
    media.url = "";
    media.hasLoaded = false;
}

function releaseMediaUrlIfUnused(media) {
    if (!media || media.id === state.activeMediaId || isMediaInRenderRange(media.id)) return;
    releaseMediaUrl(media);
}

function isMediaInRenderRange(mediaId) {
    for (let index = state.renderRange.start; index < state.renderRange.end; index += 1) {
        const item = state.filteredMessages[index];
        if (item?.type === "msg" && item.mediaItems.some((mediaItem) => mediaItem.id === mediaId)) {
            return true;
        }
    }
    return false;
}

function releaseOffscreenMediaUrls() {
    const visibleMediaIds = new Set();
    for (let index = state.renderRange.start; index < state.renderRange.end; index += 1) {
        const item = state.filteredMessages[index];
        if (item?.type !== "msg") continue;
        item.mediaItems.forEach((mediaItem) => {
            if (mediaItem.status === "available") {
                visibleMediaIds.add(mediaItem.id);
            }
        });
    }

    state.mediaStore.forEach((media) => {
        if (media.id !== state.activeMediaId && !visibleMediaIds.has(media.id)) {
            releaseMediaUrl(media);
        }
    });
}

function cleanupObjectUrls() {
    cleanupMediaStore();
    if (state.profileObjectUrl) {
        URL.revokeObjectURL(state.profileObjectUrl);
        state.profileObjectUrl = "";
    }
}

function buildMediaStore(attachments) {
    attachments.forEach((attachment, index) => {
        const fileName = attachment.name;
        const mediaType = detectMediaType(fileName);
        const id = `media-${index}-${normalizeLookupKey(fileName)}`;

        const media = {
            id,
            name: fileName,
            path: attachment.path,
            kind: mediaType.kind,
            mime: mediaType.mime,
            ext: mediaType.ext,
            size: attachment.size || 0,
            entry: attachment.entry || null,
            url: "",
            loadingPromise: null,
            hasLoaded: false
        };

        state.mediaStore.set(id, media);

        const keys = new Set([
            normalizeLookupKey(fileName),
            normalizeLookupKey(attachment.path),
            normalizeLookupKey(stripAttachmentPrefix(fileName))
        ]);

        keys.forEach((key) => {
            if (key && !state.mediaLookup.has(key)) {
                state.mediaLookup.set(key, media);
            }
        });
    });
}

// Analytics Extractor Functions
function extractHour(rawTime) {
    return hourOf(parseTimestamp(rawTime)?.time);
}

function trackEmojis(text) {
    const emojis = text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
    if (emojis) {
        emojis.forEach(e => {
            state.emojiStats[e] = (state.emojiStats[e] || 0) + 1;
        });
    }
}

function createMessageEntry(index, rawTime, sender, rawContent, timestamp = null) {
    const message = {
        type: "msg",
        id: `msg-${index}`,
        rawTime,
        time: timestamp ? timestamp.time.raw : extractTimePart(rawTime),
        sender,
        isMe: isMeSender(sender),
        text: "",
        mediaItems: []
    };

    const parsed = parseMessageContent(rawContent);
    message.text = parsed.text;
    message.mediaItems = parsed.mediaItems;

    // Track analytics
    state.senderStats[sender] = (state.senderStats[sender] || 0) + 1;
    const hour = timestamp ? hourOf(timestamp.time) : extractHour(rawTime);
    state.hourlyStats[hour] += 1;
    trackEmojis(rawContent);

    state.messageOnlyCount += 1;
    state.mediaCount += parsed.mediaItems.length;
    state.mediaMissingCount += parsed.mediaItems.filter((item) => item.status === "missing").length;

    return message;
}

function extractAttachmentTokens(text) {
    return parserExtractAttachmentTokens(text);
}

function looksLikeStandaloneAttachment(text) {
    const value = (text || "").trim();
    if (!value || /\s{2,}/.test(value)) return false;
    if (/^(https?:\/\/)/i.test(value)) return false;
    return /^[^\n]+\.(jpg|jpeg|png|webp|gif|mp4|mov|avi|m4v|mp3|m4a|opus|ogg|oga|aac|wav|pdf|docx?|xlsx?|pptx?|vcf|zip|webm|heic|heif)$/i.test(value);
}

function resolveAttachment(fileName) {
    const media = findMediaByName(fileName);
    if (!media) {
        return createMissingMediaItem(fileName);
    }

    return {
        id: media.id,
        status: "available",
        name: media.name,
        kind: media.kind,
        mime: media.mime,
        size: media.size,
        url: media.url
    };
}

function createMissingMediaItem(fileName) {
    return {
        id: `missing-${normalizeLookupKey(fileName)}-${Math.random().toString(36).slice(2, 8)}`,
        status: "missing",
        name: fileName,
        kind: "missing",
        mime: "",
        size: 0,
        url: ""
    };
}

function findMediaByName(fileName) {
    const candidates = [
        normalizeLookupKey(fileName),
        normalizeLookupKey(stripAttachmentPrefix(fileName)),
        normalizeLookupKey(baseName(fileName))
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (state.mediaLookup.has(candidate)) {
            return state.mediaLookup.get(candidate);
        }
    }

    return null;
}

function generateStats() {
    $("stat-total").innerText = state.messageOnlyCount.toLocaleString();
    $("stat-media").innerText = state.mediaCount.toLocaleString();

    const list = $("stats-list");
    if (list && !state.messageOnlyCount) {
        list.innerHTML = `
            <div class="drawer-empty">
                <i class="ph-duotone ph-chart-bar" aria-hidden="true"></i>
                <p>Load a chat and this fills up with who talks most, when, and how often.</p>
            </div>`;
    } else if (list) {
        const sorted = Object.entries(state.senderStats).sort((a, b) => b[1] - a[1]);
        list.innerHTML = sorted.map(([name, count]) => {
            const pct = state.messageOnlyCount ? ((count / state.messageOnlyCount) * 100).toFixed(1) : "0.0";
            return `
                <div class="stat-row">
                    <div class="stat-header">
                        <span class="stat-name">${escapeHtml(name)}</span>
                        <span class="stat-pct">${pct}% (${count})</span>
                    </div>
                    <div class="progress-bg">
                        <div class="progress-val" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        }).join("");
    }

    const grid = $("emoji-grid");
    if (grid) {
        const sortedEmojis = Object.entries(state.emojiStats).sort((a, b) => b[1] - a[1]);
        const top12 = sortedEmojis.slice(0, 12);
        
        if (top12.length === 0) {
            grid.innerHTML = `
                <div class="drawer-empty" style="grid-column:1/-1">
                    <i class="ph-duotone ph-smiley-blank" aria-hidden="true"></i>
                    <p>${state.messageOnlyCount ? "No emojis in this chat — a rare breed." : "Emoji highlights appear once a chat is loaded."}</p>
                </div>`;
        } else {
            grid.innerHTML = top12.map(([emoji, count]) => `
                <div class="emoji-item">
                    <span class="emoji-char">${emoji}</span>
                    <span class="emoji-count">${count.toLocaleString()}</span>
                </div>
            `).join("");
        }
    }
}

// Visual Wrapper Logic
function populateWrappedGraphic() {
    const graphic = $("wrapped-graphic");
    if (!graphic) return;

    const total = state.messageOnlyCount;
    const chatTitle = state.chatTitle || "Chat History";

    // Peak Time
    let peakHour = 0, maxMsgs = 0;
    state.hourlyStats.forEach((count, hr) => { if (count > maxMsgs) { maxMsgs = count; peakHour = hr; } });
    const ampm = peakHour >= 12 ? 'PM' : 'AM';
    const peakHour12 = state.settings.timeFormat === "24"
        ? `${String(peakHour).padStart(2, "0")}:00`
        : ((peakHour % 12) || 12) + " " + ampm;

    // Media
    const totalMedia = state.mediaCount;

    // Total Words
    let totalWords = 0;
    state.filteredMessages.forEach(m => {
        if (m.type === "msg" && m.text) {
            totalWords += m.text.split(/\s+/).filter(Boolean).length;
        }
    });

    // Date Range
    const dates = state.filteredMessages.filter(m => m.type === "date");
    const firstDate = dates.length > 0 ? formatDateLabel(dates[0].rawDate || dates[0].content) : "Unknown Date";
    const lastDate = dates.length > 0 ? formatDateLabel(dates[dates.length - 1].rawDate || dates[dates.length - 1].content) : "Unknown Date";
    const dateRange = firstDate !== "Unknown Date" && firstDate !== lastDate ? `${firstDate} - ${lastDate}` : firstDate;

    // Emojis — top 6 in a 3-column grid
    const sortedEmojis = Object.entries(state.emojiStats).sort((a, b) => b[1] - a[1]).slice(0, 6);
    let emojisHtml = sortedEmojis.length === 0
        ? "<span style='color:#555; font-size:13px;'>No emojis found</span>"
        : sortedEmojis.map(e => `<div class="wg-emoji-cell"><span class="wg-emoji-char">${e[0]}</span><span class="wg-emoji-count">${e[1].toLocaleString()}</span></div>`).join("");

    // Top Senders Split
    const sortedSenders = Object.entries(state.senderStats).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let barHtml = "";
    let labelsHtml = "";
    
    sortedSenders.forEach(([name, count]) => {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
        const color = getColor(name);
        barHtml += `<div class="wg-split-segment" style="width: ${pct}%; background-color: ${color};"></div>`;
        labelsHtml += `<div class="wg-split-label"><span class="wg-split-dot" style="color: ${color}">●</span> <span class="wg-name">${escapeHtml(name)}</span> <span class="wg-pct">${pct}%</span></div>`;
    });
    
    graphic.innerHTML = `
        <div class="wg-header">
            <div class="wg-brand-tag">ChatLume Wrapped</div>
            <h2>${escapeHtml(chatTitle)}</h2>
            <p>${escapeHtml(dateRange)}</p>
        </div>

        <div class="wg-divider"></div>

        <div class="wg-stats-grid">
            <div class="wg-stat-card">
                <span>Messages</span>
                <h3>${total.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Words</span>
                <h3>${totalWords.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Media</span>
                <h3>${totalMedia.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Peak Hour</span>
                <h3>${peakHour12}</h3>
            </div>
        </div>

        <div class="wg-section">
            <div class="wg-label">Most Used</div>
            <div class="wg-emoji-grid">${emojisHtml}</div>
        </div>

        <div class="wg-section">
            <div class="wg-label">Top Contributors</div>
            <div class="wg-split">
                <div class="wg-split-bar">${barHtml}</div>
                <div class="wg-split-labels">${labelsHtml}</div>
            </div>
        </div>

        <div class="wg-brand-footer">
            <div class="wg-logo"><img src="../assets/logo-64.png" alt=""> ChatLume</div>
            <div class="wg-url">${SITE_URL.replace(/^https?:\/\//, "")}</div>
        </div>
    `;
}

function renderChatList() {
    const list = $("message-list");
    if (!list) return;

    clampRenderRange();
    disconnectMediaObserver();
    releaseOffscreenMediaUrls();

    let lastSender = null;
    let html = "";

    for (let index = state.renderRange.start; index < state.renderRange.end; index += 1) {
        const item = state.filteredMessages[index];
        if (!item) continue;

        if (item.type === "date") {
            html += `<div class="system-msg sticky-date" id="${item.id}">${escapeHtml(formatDateLabel(item.rawDate || item.content))}</div>`;
            lastSender = null;
            continue;
        }

        if (item.type === "system") {
            html += `<div class="system-msg" id="${item.id}">${linkifyAndHighlight(item.content)}</div>`;
            lastSender = null;
            continue;
        }

        const isFirst = item.sender !== lastSender;
        const tailClass = isFirst ? (item.isMe ? "tail-out" : "tail-in") : "";
        const rowClass = `msg-row ${item.isMe ? "sent" : "received"} ${isFirst ? "tail" : ""} ${tailClass}`.trim();
        const senderHtml = state.settings.showSenderNames && !item.isMe && isFirst
            ? `<div class="sender" style="color:${getColor(item.sender)}">${escapeHtml(item.sender)}</div>`
            : "";

        let textHtml = "";
        if (item.text) {
            const isCall = /^(Missed voice call|Missed video call|Voice call|Video call|null)$/i.test(item.text);
            
            if (isCall) {
                const isVideo = item.text.toLowerCase().includes("video");
                const isMissed = item.text.toLowerCase().includes("missed") || item.text === "null";
                const callIcon = isVideo ? "ph-video-camera" : "ph-phone";
                const callColor = isMissed ? "var(--danger)" : "var(--primary)";
                const callText = item.text === "null" ? "Missed call" : item.text;
                
                textHtml = `
                    <div class="msg-text has-meta" style="display: flex; align-items: center; gap: 6px; font-weight: 500;">
                        <i class="ph-fill ${callIcon}" style="font-size: 18px; color: ${callColor}"></i> 
                        ${escapeHtml(callText)}
                    </div>`;
            } else {
                textHtml = `<div class="msg-text ${item.mediaItems.length ? "" : "has-meta"}">${renderMessageText(item.text)}</div>`;
            }
        }
        const mediaHtml = item.mediaItems.length ? renderMediaStack(item.mediaItems) : "";
        const readTick = item.isMe && state.settings.showReadTicks ? '<i class="ph-bold ph-checks" style="color:#53bdeb"></i>' : "";

        html += `
            <article class="${rowClass}" id="${item.id}">
                <div class="bubble">
                    ${senderHtml}
                    ${textHtml}
                    ${mediaHtml}
                    <div class="meta">
                        <span>${escapeHtml(formatMessageTime(item.rawTime || item.time))}</span>
                        ${readTick}
                    </div>
                </div>
            </article>
        `;

        lastSender = item.sender;
    }

    list.innerHTML = html;
    syncFocusedSearchResult();
    hydrateLazyMedia();
    syncScrollLatest();
}

// Builds a normalised, theme-agnostic list of all parsed messages for the HTML
// export. Reads from state.filteredMessages (the source of the rendered DOM) so
// the export includes every message, not just the virtual-scroll window — and
// never re-parses the raw file.
function collectExportMessages() {
    return state.filteredMessages.map((item) => {
        if (item.type === "date") {
            return { type: "date", label: formatDateLabel(item.rawDate || item.content) };
        }
        if (item.type === "system") {
            return { type: "system", text: item.content };
        }
        return {
            type: "msg",
            sender: item.sender,
            time: formatMessageTime(item.rawTime || item.time),
            isMe: item.isMe,
            color: getColor(item.sender),
            text: item.text,
            media: (item.mediaItems || []).map((media) => ({ kind: media.kind, name: media.name }))
        };
    });
}

function clampRenderRange() {
    const total = state.filteredMessages.length;
    let start = Math.max(0, Math.min(state.renderRange.start, total));
    let end = Math.max(start, Math.min(state.renderRange.end, total));

    if (end - start > MAX_RENDERED_ITEMS) {
        start = Math.max(0, end - MAX_RENDERED_ITEMS);
    }

    state.renderRange = { start, end };
}

function getScrollAnchor(viewport) {
    const viewportRect = viewport.getBoundingClientRect();
    const candidates = viewport.querySelectorAll(".message-list > .msg-row, .message-list > .system-msg");

    for (const element of candidates) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom >= viewportRect.top) {
            return {
                id: element.id,
                offset: rect.top - viewportRect.top
            };
        }
    }

    return null;
}

function restoreScrollAnchor(viewport, anchor) {
    if (!anchor?.id) return false;
    const element = $(anchor.id);
    if (!element) return false;

    const viewportRect = viewport.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    viewport.scrollTop += rect.top - viewportRect.top - anchor.offset;
    return true;
}

function renderMediaStack(mediaItems) {
    return `
        <div class="msg-media-stack">
            ${mediaItems.map(renderMediaItem).join("")}
        </div>
    `;
}

function renderMediaItem(item) {
    if (item.status === "missing") {
        return `
            <div class="media-missing">
                <div class="media-missing-head">
                    <i class="ph-fill ph-warning-circle"></i>
                    <div>
                        <strong>${escapeHtml(item.name || "Missing attachment")}</strong>
                        <span>Attachment referenced in chat but not present in the export.</span>
                    </div>
                </div>
            </div>
        `;
    }

    const media = state.mediaStore.get(item.id);
    const url = media?.url || "";
    const isLoaded = Boolean(media?.hasLoaded && url);
    const srcAttr = isLoaded ? `src="${escapeAttribute(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;

    if (item.kind === "image") {
        return `
            <button class="media-button media-image" type="button" data-open-media="${item.id}">
                <img ${srcAttr} data-media-id="${item.id}" alt="${escapeAttribute(item.name)}" loading="lazy" decoding="async">
            </button>
        `;
    }

    if (item.kind === "sticker") {
        return `
            <button class="media-button media-sticker" type="button" data-open-media="${item.id}">
                <img ${srcAttr} data-media-id="${item.id}" alt="${escapeAttribute(item.name)}" loading="lazy" decoding="async">
            </button>
        `;
    }

    if (item.kind === "video") {
        const videoSrc = isLoaded ? `src="${escapeAttribute(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;
        const placeholder = isLoaded ? "" : `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-play-circle"></i></div>`;
        return `
            <div class="media-video">
                ${placeholder}
                <video controls preload="none" ${videoSrc} data-media-id="${item.id}"></video>
            </div>
        `;
    }

    if (item.kind === "audio") {
        const bars = [30,50,70,45,80,60,35,90,55,75,40,85,65,50,70,45,80,35,65,90,50,40,75,60,85,45,70,55,80,40];
        const waveHtml = bars.map(h => `<span style="height:${h}%"></span>`).join("");
        return `
            <div class="media-audio">
                <div class="voice-note-row">
                    <i class="ph-fill ph-microphone voice-mic-icon"></i>
                    <div class="voice-waveform">${waveHtml}</div>
                    <span class="voice-duration" data-media-id="${item.id}">–:––</span>
                </div>
                <audio controls preload="metadata" data-lazy-media="${item.id}" data-media-id="${item.id}"></audio>
            </div>
        `;
    }

    return `
        <div class="media-doc">
            <div class="media-doc-head">
                <i class="ph-fill ph-file"></i>
                <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>${labelForMediaKind(item.kind)}${item.size ? ` • ${formatBytes(item.size)}` : ""}</span>
                </div>
            </div>
            <div class="media-doc-actions">
                <button type="button" class="media-doc-link" data-open-media="${item.id}">Preview</button>
                <button type="button" class="media-doc-link" data-download-media="${item.id}">Download</button>
            </div>
        </div>
    `;
}

function handleViewportScroll(event) {
    const viewport = event.currentTarget;
    syncScrollLatest(viewport);

    if (viewport.scrollTop <= 0 && state.renderRange.start > 0) {
        const anchor = getScrollAnchor(viewport);
        state.renderRange.start = Math.max(0, state.renderRange.start - BATCH_SIZE);
        state.renderRange.end = Math.min(state.filteredMessages.length, state.renderRange.start + MAX_RENDERED_ITEMS);
        renderChatList();
        if (!restoreScrollAnchor(viewport, anchor)) {
            viewport.scrollTop = 1;
        }
        return;
    }

    if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 20 && state.renderRange.end < state.filteredMessages.length) {
        const anchor = getScrollAnchor(viewport);
        state.renderRange.end = Math.min(state.filteredMessages.length, state.renderRange.end + BATCH_SIZE);
        state.renderRange.start = Math.max(0, state.renderRange.end - MAX_RENDERED_ITEMS);
        renderChatList();
        if (!restoreScrollAnchor(viewport, anchor)) {
            viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - 1);
        }
    }
}

function toggleSearch() {
    const toolbar = $("search-toolbar");
    const input = $("live-search");
    if (!toolbar || !input) return;

    state.isSearchOpen = !toolbar.classList.contains("active");
    toolbar.classList.toggle("active", state.isSearchOpen);

    if (state.isSearchOpen) {
        input.focus();
        return;
    }

    input.value = "";
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    handleSearch("");
    setSearchEmptyState(false);
    resetRenderToBottom();
}

function handleSearchInput(event) {
    const query = event.target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => handleSearch(query), SEARCH_DEBOUNCE_MS);
}

function handleSearch(query) {
    state.searchTimer = null;
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
        state.searchResults = [];
        state.searchPointer = -1;
        updateSearchCounter();
        setSearchEmptyState(false);
        renderChatList();
        return;
    }

    state.searchResults = state.messages
        .filter((entry) => entry.type === "msg" && getSearchableText(entry).includes(normalized))
        .map((entry) => entry.id);

    if (!state.searchResults.length) {
        state.searchPointer = -1;
        updateSearchCounter("No matches");
        setSearchEmptyState(true, query.trim());
        renderChatList();
        return;
    }

    state.searchPointer = 0;
    updateSearchCounter();
    setSearchEmptyState(false);
    jumpToMessage(state.searchResults[state.searchPointer]);
}

/** Shows the full-panel "nothing matched" state over the message list. */
function setSearchEmptyState(visible, query = "") {
    const panel = $("search-empty");
    if (!panel) return;

    if (visible) {
        const queryEl = $("search-empty-query");
        if (queryEl) queryEl.innerText = `"${query}"`;
    }
    panel.hidden = !visible;
}

function navSearch(direction) {
    if (!state.searchResults.length) return;

    state.searchPointer += direction === "up" ? -1 : 1;
    if (state.searchPointer < 0) {
        state.searchPointer = state.searchResults.length - 1;
    }
    if (state.searchPointer >= state.searchResults.length) {
        state.searchPointer = 0;
    }

    updateSearchCounter();
    jumpToMessage(state.searchResults[state.searchPointer]);
}

function updateSearchCounter(fallback = "") {
    const counter = $("search-counter");
    if (!counter) return;

    if (fallback) {
        counter.innerText = fallback;
        return;
    }

    counter.innerText = state.searchResults.length
        ? `${state.searchPointer + 1}/${state.searchResults.length}`
        : "";
}

function jumpToMessage(messageId) {
    const index = state.filteredMessages.findIndex((entry) => entry.id === messageId);
    if (index === -1) return;

    state.renderRange.start = Math.max(0, index - 40);
    state.renderRange.end = Math.min(state.filteredMessages.length, state.renderRange.start + MAX_RENDERED_ITEMS);
    renderChatList();

    window.setTimeout(() => {
        const element = $(messageId);
        if (!element) return;
        element.scrollIntoView({ block: "center", behavior: "auto" });
        syncFocusedSearchResult();
    }, 40);
}

function syncFocusedSearchResult() {
    if (state.searchPointer < 0 || !state.searchResults.length) return;
    const current = $(state.searchResults[state.searchPointer]);
    current?.querySelector(".hl")?.classList.add("focus");
}

function highlightOutsideTags(html, query) {
    const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
    return html.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, text) => {
        if (tag) return tag;
        return text.replace(regex, '<span class="hl">$1</span>');
    });
}

function renderMessageText(text) {
    if (state.settings.richText) {
        return linkifyAndHighlight(text);
    }

    const query = $("live-search")?.value.trim();
    let escaped = escapeHtml(text || "");
    if (query) {
        escaped = highlightOutsideTags(escaped, query);
    }
    return escaped;
}

const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

function linkifyAndHighlight(text) {
    const query = $("live-search")?.value.trim();
    let html = buildRichText(escapeHtml(text || ""));

    if (query) {
        html = highlightOutsideTags(html, query);
    }

    return html;
}

/**
 * Linkifies URLs and applies WhatsApp's *bold* _italic_ ~strike~ markers.
 * The two passes are interleaved rather than chained: running the formatting
 * pass over an already-linkified string rewrote the inside of the links, so
 * .../Foo_bar_baz lost its underscores to an <em> — in the href as well as in
 * the visible text, leaving a dead link.
 */
function buildRichText(escaped) {
    let out = "";
    let cursor = 0;
    let match;

    URL_PATTERN.lastIndex = 0;
    while ((match = URL_PATTERN.exec(escaped)) !== null) {
        out += applyTextFormatting(escaped.slice(cursor, match.index));
        out += `<a href="${match[0]}" target="_blank" rel="noopener noreferrer">${match[0]}</a>`;
        cursor = match.index + match[0].length;
    }

    return out + applyTextFormatting(escaped.slice(cursor));
}

function applyTextFormatting(segment) {
    return segment
        .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
        .replace(/_([^_\n]+)_/g, "<em>$1</em>")
        .replace(/~([^~\n]+)~/g, "<s>$1</s>");
}

function formatMessageTime(rawTime) {
    const timestamp = parseTimestamp(rawTime || "");
    if (!timestamp) {
        return applyBrackets(extractTimePart(rawTime || ""), state.settings.timeBrackets);
    }
    const parsed = timestamp.time;
    const original = parsed.raw;
    if (state.settings.timeFormat === "auto") {
        // Drop the seconds field only; the export's own digits, separator and
        // day-period marker are kept exactly as written.
        const autoTime = (parsed.second !== "" && !state.settings.showSeconds)
            ? original.replace(/^(\P{Nd}*\p{Nd}{1,2}[:.]\p{Nd}{2})[:.]\p{Nd}{2}/u, "$1")
            : original;
        return applyBrackets(autoTime.trim(), state.settings.timeBrackets);
    }

    const showSeconds = state.settings.showSeconds && parsed.second !== "";
    let hour = hourOf(parsed);
    let suffix = "";

    if (state.settings.timeFormat === "12") {
        suffix = hour >= 12 ? " PM" : " AM";
        hour = (hour % 12) || 12;
    }

    const hourText = state.settings.timeFormat === "24" ? String(hour).padStart(2, "0") : String(hour);
    const secondText = showSeconds ? `:${String(parsed.second).padStart(2, "0")}` : "";
    return applyBrackets(`${hourText}:${String(parsed.minute).padStart(2, "0")}${secondText}${suffix}`, state.settings.timeBrackets);
}

function formatDateLabel(label) {
    const raw = label || "";
    const parsed = parseExportDateLabel(raw);
    if (!parsed) {
        return applyBrackets(raw, state.settings.dateBrackets);
    }

    if (state.settings.dateFormat === "original") {
        return applyBrackets(formatOriginalDateSeparator(raw), state.settings.dateBrackets);
    }

    if (state.settings.dateFormat === "long") {
        return applyBrackets(
            parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
            state.settings.dateBrackets
        );
    }

    const day = String(parsed.getDate()).padStart(2, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const year = String(parsed.getFullYear());
    const separator = state.settings.dateSeparator;
    const parts = {
        dmy: [day, month, year],
        mdy: [month, day, year],
        ymd: [year, month, day]
    }[state.settings.dateFormat] || [day, month, year];

    return applyBrackets(parts.join(separator), state.settings.dateBrackets);
}

function formatOriginalDateSeparator(label) {
    const parts = String(label || "").split(/[./-]/);
    if (parts.length !== 3) return label;
    return parts.join(state.settings.dateSeparator);
}

function applyBrackets(value, bracketStyle) {
    if (bracketStyle === "square") return `[${value}]`;
    if (bracketStyle === "round") return `(${value})`;
    return value;
}

async function handleMessageListClick(event) {
    const downloadTrigger = event.target.closest("[data-download-media]");
    if (downloadTrigger) {
        await downloadMedia(downloadTrigger.dataset.downloadMedia);
        return;
    }

    const mediaTrigger = event.target.closest("[data-open-media]");
    if (mediaTrigger) {
        await openMediaModal(mediaTrigger.dataset.openMedia);
    }
}

async function openMediaModal(mediaId) {
    const media = state.mediaStore.get(mediaId);
    const modal = $("media-modal");
    const body = $("media-modal-body");
    const subtitle = $("media-modal-subtitle");
    const downloadLink = $("media-download-link");

    if (!modal || !body || !subtitle || !downloadLink || !media) return;

    state.activeMediaId = mediaId;
    subtitle.innerText = `${labelForMediaKind(media.kind)} • ${media.name}`;
    body.innerHTML = `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-spinner-gap processing-spinner"></i></div>`;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("open"));
    pushHistoryState("media");

    let url = "";
    try {
        url = await ensureMediaUrl(media);
    } catch (error) {
        console.error(error);
        body.innerHTML = `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>Unable to load media</strong><span>${escapeHtml(media.name)}</span></div></div></div>`;
        return;
    }
    if (state.activeMediaId !== mediaId) return;

    downloadLink.href = url;
    downloadLink.download = media.name;

    if (media.kind === "image" || media.kind === "sticker") {
        body.innerHTML = `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(media.name)}" decoding="async">`;
    } else if (media.kind === "video") {
        body.innerHTML = `<video controls autoplay src="${escapeAttribute(url)}"></video>`;
    } else if (media.kind === "audio") {
        body.innerHTML = `<audio controls autoplay src="${escapeAttribute(url)}"></audio>`;
    } else {
        body.innerHTML = `
            <div class="media-doc">
                <div class="media-doc-head">
                    <i class="ph-fill ph-file"></i>
                    <div>
                        <strong>${escapeHtml(media.name)}</strong>
                        <span>${labelForMediaKind(media.kind)}${media.size ? ` • ${formatBytes(media.size)}` : ""}</span>
                    </div>
                </div>
                <a class="media-doc-link" href="${escapeAttribute(url)}" download="${escapeAttribute(media.name)}">Download file</a>
            </div>
        `;
    }
}

function closeMediaModal() {
    const modal = $("media-modal");
    const body = $("media-modal-body");
    if (!modal || modal.hidden) return;

    const closingMediaId = state.activeMediaId;
    modal.classList.remove("open");
    window.setTimeout(() => {
        if (!modal.classList.contains("open")) {
            modal.hidden = true;
            if (body) {
                body.innerHTML = "";
            }
            if (closingMediaId) {
                releaseMediaUrlIfUnused(state.mediaStore.get(closingMediaId));
            }
        }
    }, 120);
    state.activeMediaId = "";
}

function openDrawer(id) {
    $(`${id}-drawer`)?.classList.add("open");
    pushHistoryState(`drawer-${id}`);
    if (id === "stats") animateStatsIn();
}

const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts the stat tiles up and grows the per-sender bars from zero. */
function animateStatsIn() {
    const reduce = prefersReducedMotion();

    [["stat-total", state.messageOnlyCount], ["stat-media", state.mediaCount]].forEach(([id, target]) => {
        const el = $(id);
        if (!el) return;
        if (reduce || !target) {
            el.innerText = Number(target || 0).toLocaleString();
            return;
        }
        countUp(el, target, 750);
    });

    document.querySelectorAll("#stats-list .progress-val").forEach((bar) => {
        const width = bar.style.width;
        if (reduce) return;
        bar.style.width = "0%";
        requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = width; }));
    });
}

function countUp(el, target, duration) {
    const start = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // easeOutCubic — fast start, gentle landing.
        const eased = 1 - Math.pow(1 - t, 3);
        el.innerText = Math.round(target * eased).toLocaleString();
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function closeDrawer(id) {
    $(`${id}-drawer`)?.classList.remove("open");
}

function toggleSidebar() {
    const sidebar = $("sidebar");
    if (!sidebar) return;
    setSidebarState(!sidebar.classList.contains("active"));
}

function setSidebarState(isOpen) {
    $("sidebar")?.classList.toggle("active", isOpen);
    $("sidebar-backdrop")?.classList.toggle("active", isOpen);
}

function handleChatSelect() {
    if (window.innerWidth <= 800) {
        setSidebarState(false);
    }
}

function toggleMenu() {
    $("header-menu")?.classList.toggle("show");
}

function closeMenu() {
    $("header-menu")?.classList.remove("show");
}

function handleDocumentClick(event) {
    const menu = $("header-menu");
    const menuToggle = $("menu-toggle");
    if (menu?.classList.contains("show") && !menu.contains(event.target) && !menuToggle?.contains(event.target)) {
        closeMenu();
    }
}

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
    document.querySelectorAll(".drawer.open").forEach((drawer) => drawer.classList.remove("open"));
}

function isVisible(element) {
    return Boolean(element) && !element.hidden;
}

/** Ctrl/Cmd+F and "/" jump straight to the in-chat search. */
function handleSearchShortcut(event) {
    if (!state.filteredMessages.length) return;
    if (isTypingTarget(event.target)) return;

    const isFindCombo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
    if (!isFindCombo && event.key !== "/") return;
    if (event.altKey) return;

    event.preventDefault();
    if (!state.isSearchOpen) {
        toggleSearch();
    } else {
        $("live-search")?.focus();
    }
}

function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function handleDateJumpAction(event) {
    event.preventDefault();
    closeMenu();

    if (!state.messages.length) {
        showToast("Load a chat first", "warn");
        return;
    }

    openDateSheet();
}

function openDateSheet() {
    const sheet = $("date-sheet");
    const input = $("date-sheet-input");
    if (!sheet || !input) return;

    input.value = "";
    sheet.hidden = false;
    requestAnimationFrame(() => {
        sheet.classList.add("open");
        input.focus({ preventScroll: true });
    });
    pushHistoryState("date-sheet");
}

function closeDateSheet() {
    const sheet = $("date-sheet");
    if (!sheet) return;

    sheet.classList.remove("open");
    window.setTimeout(() => {
        if (!sheet.classList.contains("open")) {
            sheet.hidden = true;
        }
    }, 160);
}

function applyDateSheetSelection() {
    const selectedDate = $("date-sheet-input")?.value || "";
    if (!selectedDate) {
        showToast("Select a date", "warn");
        return;
    }

    closeDateSheet();
    if (history.state && history.state.overlay) history.back();
    handleDateSelection(selectedDate);
}

function handleDateSelection(dateValue) {
    if (!dateValue || !state.messages.length) return;

    const targetDate = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(targetDate.getTime())) {
        showToast("Invalid date format", "error");
        return;
    }

    targetDate.setHours(0, 0, 0, 0);
    const targetMs = targetDate.getTime();
    let exactIndex = -1;
    let bestBeforeIndex = -1;
    let bestBeforeMs = -Infinity;
    let bestAfterIndex = -1;
    let bestAfterMs = Infinity;

    state.filteredMessages.forEach((entry, index) => {
        if (entry.type !== "date") return;
        const parsed = parseExportDateLabel(entry.content);
        if (!parsed) return;

        const time = parsed.getTime();
        if (time === targetMs && exactIndex === -1) {
            exactIndex = index;
        }
        if (time <= targetMs && time > bestBeforeMs) {
            bestBeforeMs = time;
            bestBeforeIndex = index;
        }
        if (time >= targetMs && time < bestAfterMs) {
            bestAfterMs = time;
            bestAfterIndex = index;
        }
    });

    const bestIndex = exactIndex !== -1 ? exactIndex : bestBeforeIndex;
    if (bestIndex === -1) {
        showToast(bestAfterIndex !== -1 ? "No messages on or before that date" : "No valid date markers found", "warn");
        return;
    }

    state.renderRange.start = Math.max(0, bestIndex);
    state.renderRange.end = Math.min(state.filteredMessages.length, bestIndex + MAX_RENDERED_ITEMS);
    renderChatList();

    window.setTimeout(() => {
        const targetEntry = state.filteredMessages[findFirstMessageIndexForDate(bestIndex) ?? bestIndex];
        $(targetEntry?.id)?.scrollIntoView({ block: "start", behavior: "auto" });
        const label = formatDateLabel(state.filteredMessages[bestIndex]?.rawDate || state.filteredMessages[bestIndex]?.content);
        showToast(exactIndex !== -1 ? `Jumped to ${label}` : `Closest previous date: ${label}`);
    }, 50);
}

function findFirstMessageIndexForDate(dateMarkerIndex) {
    for (let i = dateMarkerIndex + 1; i < state.filteredMessages.length; i += 1) {
        const entry = state.filteredMessages[i];
        if (entry.type === "date") return dateMarkerIndex;
        if (entry.type === "msg") return i;
    }
    return dateMarkerIndex;
}

function scrollToBottom() {
    const viewport = $("viewport");
    if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
        syncScrollLatest(viewport);
    }
}

const SCROLL_LATEST_THRESHOLD = 320;

/**
 * Shows the floating jump-to-latest pill once the conversation is scrolled
 * away from the newest message. The virtual window matters as much as the
 * pixel offset: sitting at the bottom of a mid-chat window is still far from
 * the latest message, so an unrendered tail also counts as "scrolled up".
 */
function syncScrollLatest(viewport) {
    const button = $("scroll-latest");
    if (!button) return;

    const view = viewport || $("viewport");
    if (!view || !state.filteredMessages.length) {
        button.hidden = true;
        button.classList.remove("show");
        return;
    }

    const distance = view.scrollHeight - view.scrollTop - view.clientHeight;
    const hasUnrenderedTail = state.renderRange.end < state.filteredMessages.length;
    const shouldShow = hasUnrenderedTail || distance > SCROLL_LATEST_THRESHOLD;

    if (shouldShow) {
        button.hidden = false;
        // Unhide first so the fade actually has a frame to run in.
        requestAnimationFrame(() => button.classList.add("show"));
        return;
    }

    button.classList.remove("show");
    window.setTimeout(() => {
        if (!button.classList.contains("show")) button.hidden = true;
    }, 200);
}

function jumpToBottom() {
    closeMenu();
    resetRenderToBottom();
    requestAnimationFrame(scrollToBottom);
}

function resetRenderToBottom() {
    state.renderRange = {
        start: Math.max(0, state.filteredMessages.length - MAX_RENDERED_ITEMS),
        end: state.filteredMessages.length
    };
    renderChatList();
}

function setLoadingState(isLoading, title = "Loading chat", copy = "Parsing your export locally. This can take a moment for large ZIP files.") {
    state.isLoading = isLoading;

    const overlay = $("processing-overlay");
    const titleEl = $("processing-title");
    const copyEl = $("processing-copy");
    const loadButton = $("load-chat");
    const dropTarget = $("drop-target");
    const nameInput = $("display-name");
    const fileInput = $("file-input");

    if (titleEl) {
        titleEl.innerText = title;
    }
    if (copyEl) {
        copyEl.innerText = copy;
    }

    loadButton?.toggleAttribute("disabled", isLoading);
    dropTarget?.toggleAttribute("disabled", isLoading);
    nameInput?.toggleAttribute("disabled", isLoading);
    fileInput?.toggleAttribute("disabled", isLoading);

    // While parsing, stand a shimmering placeholder where the chat entry lands.
    const skeleton = $("chat-list-skeleton");
    if (skeleton) {
        const showSkeleton = isLoading && $("chat-list-panel")?.classList.contains("hidden");
        skeleton.classList.toggle("hidden", !showSkeleton);
    }

    if (!overlay) return;

    if (isLoading) {
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add("open"));
        return;
    }

    overlay.classList.remove("open");
    window.setTimeout(() => {
        if (!overlay.classList.contains("open")) {
            overlay.hidden = true;
        }
    }, 260);
}

/**
 * One-shot fade for the conversation the first time it paints. The message list
 * is virtualised and re-renders on every scroll, so per-message animation would
 * re-fire constantly — this animates the container instead and then gets out of
 * the way.
 */
function playChatRevealOnce() {
    const viewport = $("viewport");
    const header = q(".chat-header .header-profile");
    if (!viewport) return;

    viewport.classList.remove("chat-revealed");
    header?.classList.remove("chat-revealed");
    requestAnimationFrame(() => {
        viewport.classList.add("chat-revealed");
        header?.classList.add("chat-revealed");
    });
}

let pristineEmptyStateHtml = null;

/** Remembers the markup shipped in the HTML so a state swap can be undone. */
function rememberEmptyState() {
    const emptyEl = $("empty-state");
    if (emptyEl && pristineEmptyStateHtml === null) {
        pristineEmptyStateHtml = emptyEl.innerHTML;
    }
    return emptyEl;
}

function restoreEmptyState() {
    const emptyEl = rememberEmptyState();
    if (emptyEl && pristineEmptyStateHtml !== null) {
        emptyEl.innerHTML = pristineEmptyStateHtml;
    }
}

/**
 * Replaces the viewport placeholder with a titled state.
 * `actions` is trusted markup built here, never user input.
 */
function showEmptyState({ icon, iconColor, title, body, actions = "" }) {
    const emptyEl = rememberEmptyState();
    if (!emptyEl) return false;

    emptyEl.innerHTML = `
        <div class="illustration"><i class="${icon}"${iconColor ? ` style="color:${iconColor}"` : ""}></i></div>
        <h2>${escapeHtml(title)}</h2>
        <p style="max-width:340px">${escapeHtml(body)}</p>
        ${actions}`;
    emptyEl.classList.remove("hidden");
    return true;
}

function updateLoadingCopy(copy) {
    const copyEl = $("processing-copy");
    if (copyEl) {
        copyEl.innerText = copy;
    }
}

function showToast(message, tone = "success") {
    const toast = $("toast");
    if (!toast) return;

    toast.innerText = message;
    toast.classList.remove("is-error", "is-warn", "is-info");
    if (tone !== "success") {
        toast.classList.add(`is-${tone}`);
    }
    toast.classList.add("show");
    window.clearTimeout(state.toastTimer);
    // Errors carry more text than a confirmation, so give them longer to read.
    state.toastTimer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, tone === "error" ? 4200 : 2200);
}



function handleProfilePictureChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (state.profileObjectUrl) {
        URL.revokeObjectURL(state.profileObjectUrl);
    }

    state.profileObjectUrl = URL.createObjectURL(file);
    if ($("my-pfp-img")) $("my-pfp-img").src = state.profileObjectUrl;
    if ($("drawer-pfp-img")) $("drawer-pfp-img").src = state.profileObjectUrl;
    if (q(".header-pfp")) q(".header-pfp").src = state.profileObjectUrl;
}

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

    // Inject export button into header menu (once)
    const menu = $("header-menu");
    if (menu && !$("export-chat-btn")) {
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
                exportChatAsHTML({
                    theme: "whatsapp",
                    title: state.chatTitle || "WhatsApp Chat",
                    messageCount: state.messageOnlyCount,
                    messages: collectExportMessages()
                });
                showToast("Chat exported as HTML");
            } catch (err) {
                console.error('[ChatLume] Export failed:', err);
                showToast("Export failed", "error");
            }
        });
        menu.appendChild(btn);
    }
}


// ── Persistent Storage (Beta) ────────────────────────────────────────────────
// Off by default. When on, a freshly opened export is copied to the device
// (see js/storage.js) and offered again on the next visit. Turning it off
// stops new copies but never deletes existing ones — that is always an
// explicit, confirmed action.

function isPersistentStorageEnabled() {
    return state.storageSupported && Boolean(state.settings.persistentStorage);
}

async function initPersistentStorage() {
    state.storageSupported = storage.isSupported();
    refreshStorageSettingsUI();
    if (!state.storageSupported) return;

    // Nobody who never kept a chat should pay for a storage lookup at boot.
    const everUsed = readStored(STORAGE_KEYS.persistUsed) === "1";
    if (!state.settings.persistentStorage && !everUsed) return;

    await loadStoredImports();

    if (!state.settings.persistentStorage) return;
    const lastId = readStored(STORAGE_KEYS.lastImport);
    const record = lastId ? state.storedImports.find((item) => item.id === lastId) : null;
    if (!record) return;

    await openStoredImport(record);
    // A stored chat that can't produce messages shouldn't greet the user with
    // the same error on every launch. The import itself stays until they
    // delete it — only the automatic reopen is dropped.
    if (state.activeImportId !== record.id || state.messageOnlyCount === 0) {
        removeStored(STORAGE_KEYS.lastImport);
    }
}

async function loadStoredImports() {
    let records = null;
    try {
        // Other viewers may keep their own kinds here one day; this sidebar only
        // knows how to open WhatsApp exports.
        records = (await storage.reconcileImports()).filter((record) => record.kind === "whatsapp");
    } catch (error) {
        // Storage misbehaved — show nothing this session, but forget nothing:
        // the records and files are still there for the next launch.
        console.warn("Persistent storage could not be read:", error);
        showToast("Stored chats couldn't be read right now. They're still on this device.", "warn");
    }
    state.storedImports = records || [];
    state.storedImportsLoaded = true;
    if (records && !records.length) {
        removeStored(STORAGE_KEYS.persistUsed);
        removeStored(STORAGE_KEYS.lastImport);
    }
    renderStoredImports();
    refreshStorageSettingsUI();
}

function handlePersistentStorageToggle() {
    if (!state.storageSupported) {
        state.settings.persistentStorage = false;
        saveSettings();
        syncSettingsControls();
        refreshStorageSettingsUI();
        showToast("Your browser doesn't support persistent storage", "warn");
        return;
    }
    refreshStorageSettingsUI();
    if (state.settings.persistentStorage) {
        if (!state.storedImportsLoaded) loadStoredImports();
        showToast("New imports will be kept on this device", "info");
        return;
    }
    if (state.persistJob) {
        // The user just said "don't keep chats" — that includes the one being
        // written right now. The cancel path removes the partial file and
        // reports back.
        cancelPersistCopy("toggle");
        return;
    }
    showToast(
        state.storedImports.length
            ? "Turned off. Stored chats stay on this device until you delete them."
            : "Persistent storage turned off",
        "info"
    );
}

function refreshStorageSettingsUI() {
    const checkbox = $("setting-persistent-storage");
    const unsupported = $("storage-unsupported");
    const manage = $("storage-manage");
    if (checkbox) checkbox.disabled = !state.storageSupported;
    if (unsupported) unsupported.hidden = state.storageSupported;
    if (!manage) return;

    const records = state.storedImports;
    manage.hidden = !state.storageSupported || records.length === 0;
    if (manage.hidden) return;

    const total = records.reduce((sum, record) => sum + (record.size || 0), 0);
    const summary = $("storage-summary");
    if (summary) {
        summary.textContent = `${records.length} stored chat${records.length === 1 ? "" : "s"} · ${formatBytes(total) || "0 B"} on this device`;
    }
    const offNote = $("storage-off-note");
    if (offNote) offNote.hidden = Boolean(state.settings.persistentStorage);

    const list = $("storage-list");
    if (list) {
        list.innerHTML = records.map((record) => {
            const title = storedImportTitle(record);
            return `
                <div class="storage-item${record.id === state.activeImportId ? " active" : ""}">
                    <div class="storage-item-info">
                        <strong>${escapeHtml(title)}</strong>
                        <span>${escapeHtml(storedImportMeta(record))}</span>
                    </div>
                    <button type="button" class="stored-delete" data-stored-delete="${escapeAttribute(record.id)}" title="Delete from this device" aria-label="Delete ${escapeAttribute(title)}"><i class="ph ph-trash"></i></button>
                </div>`;
        }).join("");
    }
}

function renderStoredImports() {
    const records = state.storedImports;
    document.querySelectorAll("[data-stored-list]").forEach((list) => {
        list.hidden = records.length === 0;
        if (!records.length) {
            list.innerHTML = "";
            return;
        }
        list.innerHTML = `<div class="stored-list-head"><i class="ph-fill ph-hard-drives"></i> Saved on this device</div>` +
            records.map((record) => {
                const title = storedImportTitle(record);
                return `
                    <div class="stored-item${record.id === state.activeImportId ? " active" : ""}">
                        <button type="button" class="chat-item" data-stored-open="${escapeAttribute(record.id)}">
                            <div class="chat-item-avatar" aria-hidden="true">${escapeHtml(title.charAt(0).toUpperCase())}</div>
                            <div class="chat-item-info">
                                <h4>${escapeHtml(title)}</h4>
                                <span>${escapeHtml(storedImportMeta(record))}</span>
                            </div>
                        </button>
                        <button type="button" class="stored-delete" data-stored-delete="${escapeAttribute(record.id)}" title="Delete from this device" aria-label="Delete ${escapeAttribute(title)}"><i class="ph ph-trash"></i></button>
                    </div>`;
            }).join("");
    });
}

function storedImportTitle(record) {
    return record.chatTitle || record.fileName || "Chat";
}

function storedImportMeta(record) {
    const parts = [];
    if (record.messageCount) parts.push(`${record.messageCount.toLocaleString()} messages`);
    parts.push(formatBytes(record.size) || "0 B");
    parts.push(/\.zip$/i.test(record.storedName || "") ? "ZIP" : "TXT");
    return parts.join(" · ");
}

function handleStoredListClick(event) {
    const openButton = event.target.closest("[data-stored-open]");
    if (openButton) {
        const record = state.storedImports.find((item) => item.id === openButton.dataset.storedOpen);
        if (record) openStoredImport(record);
        return;
    }
    const deleteButton = event.target.closest("[data-stored-delete]");
    if (deleteButton) {
        deleteStoredImport(deleteButton.dataset.storedDelete);
    }
}

async function openStoredImport(record) {
    if (state.isLoading) return;
    if (record.id && record.id === state.activeImportId) {
        if (window.innerWidth <= 800) setSidebarState(false);
        return;
    }

    let file;
    try {
        file = await storage.getImportFile(record);
    } catch (error) {
        if (storage.isUnrecoverable(error)) {
            // Missing or truncated: the record points at nothing usable, so
            // drop it rather than offering a chat that can't open.
            await storage.deleteImport(record).catch(() => {});
            dropStoredImport(record.id);
            showToast(`"${storedImportTitle(record)}" was missing or damaged and has been removed from this device`, "error");
        } else {
            // Anything else is the storage layer having a moment. The data is
            // intact; don't touch it.
            console.warn("Stored chat could not be opened:", error);
            showToast(`Couldn't open "${storedImportTitle(record)}" right now (${error.message || error.name}). It's still saved on this device.`, "error");
        }
        return;
    }

    const nameInput = $("display-name");
    if (nameInput && !nameInput.value.trim()) nameInput.value = record.displayName || "";

    await loadChatFile(file, {
        displayName: record.displayName || "",
        fileLabel: record.fileName,
        importId: record.id
    });
}

function markStoredImportOpened(id) {
    state.activeImportId = id;
    writeStored(STORAGE_KEYS.lastImport, id);

    const record = state.storedImports.find((item) => item.id === id);
    if (record) {
        record.lastOpenedAt = Date.now();
        record.chatTitle = state.chatTitle;
        record.messageCount = state.messageOnlyCount;
        record.mediaCount = state.mediaCount;
        record.displayName = state.myName;
        storage.putImport(record).catch(() => {});
        state.storedImports = storage.sortByRecency(state.storedImports);
    }
    renderStoredImports();
    refreshStorageSettingsUI();
}

function dropStoredImport(id) {
    state.storedImports = state.storedImports.filter((item) => item.id !== id);
    if (state.activeImportId === id) state.activeImportId = "";
    if (readStored(STORAGE_KEYS.lastImport) === id) removeStored(STORAGE_KEYS.lastImport);
    if (!state.storedImports.length) removeStored(STORAGE_KEYS.persistUsed);
    renderStoredImports();
    refreshStorageSettingsUI();
}

/**
 * Copies the export that just opened to the device. Runs after the chat is on
 * screen, so a multi-gigabyte copy never delays reading it. `gen` is the load
 * generation the copy belongs to: if another chat opens meanwhile the copy still
 * completes, it just doesn't become the active import.
 */
async function persistCurrentImport(file, gen) {
    if (!state.storageSupported) return;
    if (state.persistJob) {
        showToast("Another chat is still being saved — import this one again once it finishes", "warn");
        return;
    }

    // Reserve the slot before anything asynchronous: the permission prompt
    // below can sit open for as long as the user likes, and a second import in
    // that window must not start a second copy.
    const reservation = {
        cancelled: false,
        reason: "",
        cancel(reason = "user") { this.cancelled = true; this.reason = reason; }
    };
    state.persistJob = reservation;

    // Describe the chat now, while `state` still belongs to this file — by the
    // time the awaits below settle the user may have opened another one.
    const snapshot = {
        chatTitle: state.chatTitle,
        messageCount: state.messageOnlyCount,
        mediaCount: state.mediaCount,
        displayName: state.myName
    };

    try {
        if (!state.storedImportsLoaded) await loadStoredImports();

        const duplicate = storage.findDuplicate(state.storedImports, file);
        if (duplicate) {
            if (state.loadGeneration === gen) markStoredImportOpened(duplicate.id);
            showToast("This export is already saved on this device", "info");
            return;
        }

        // Persistence first: until it is granted Firefox reports a small
        // best-effort quota that would wrongly reject large exports.
        await storage.requestPersistence();

        const needed = storage.requiredSpace(file.size);
        const estimate = await storage.estimateStorage();
        if (estimate && estimate.quota > 0 && estimate.available < needed) {
            showToast(`Not enough storage to keep this chat. It needs ${formatBytes(needed)} but only ${formatBytes(estimate.available) || "0 B"} is available.`, "error");
            return;
        }

        if (reservation.cancelled) {
            showToast(persistCancelMessage(reservation.reason), "info");
            return;
        }

        const id = storage.generateId();
        const job = storage.copyFileToStorage(file, id, { onProgress: updatePersistProgress });
        job.reason = "";
        state.persistJob = job;
        showPersistCard(file.size);

        let storedName;
        try {
            storedName = await job.promise;
        } catch (error) {
            hidePersistCard();
            if (error.name === "AbortError") {
                showToast(persistCancelMessage(job.reason), "info");
            } else if (error.name === "QuotaExceededError") {
                showToast("The browser ran out of storage before the chat could be saved", "error");
            } else if (error.name === "NotSupportedError" || error.name === "TypeError") {
                showToast("Your browser doesn't support saving chats to the device", "error");
            } else if (error.name === "UnknownError" || error.name === "InvalidStateError") {
                // Safari reports exactly this in Private Browsing, where the
                // file system exists but refuses to open.
                showToast("Persistent storage isn't available in this browsing mode (for example Private Browsing). The chat is open, but it wasn't kept.", "error");
            } else {
                showToast(`Couldn't save this chat: ${error.message}`, "error");
            }
            return;
        }

        const now = Date.now();
        const record = {
            id,
            kind: "whatsapp",
            schemaVersion: 1,
            fileName: file.name,
            size: file.size,
            lastModified: file.lastModified,
            storedName,
            ...snapshot,
            importedAt: now,
            lastOpenedAt: now
        };

        try {
            await storage.putImport(record);
        } catch (error) {
            // No record means no import — don't leave the copy behind.
            await storage.removeStoredFile(storedName);
            hidePersistCard();
            showToast(`Couldn't save this chat: ${error.message}`, "error");
            return;
        }

        writeStored(STORAGE_KEYS.persistUsed, "1");
        state.storedImports = storage.sortByRecency([...state.storedImports, record]);
        hidePersistCard();
        if (state.loadGeneration === gen) {
            markStoredImportOpened(id);
        } else {
            renderStoredImports();
            refreshStorageSettingsUI();
        }
        showToast(`Saved "${storedImportTitle(record)}" on this device`);
    } catch (error) {
        // Nothing above should throw, but a surprise must not become an
        // unhandled rejection with a stuck progress card.
        console.warn("Persisting the import failed:", error);
        hidePersistCard();
        showToast(`Couldn't save this chat: ${error.message || error}`, "error");
    } finally {
        state.persistJob = null;
    }
}

function persistCancelMessage(reason) {
    return reason === "toggle"
        ? "Persistent storage turned off — the save in progress was cancelled and the chat wasn't kept"
        : "Save cancelled — this chat wasn't kept";
}

function cancelPersistCopy(reason = "user") {
    if (!state.persistJob) return;
    if ("reason" in state.persistJob) state.persistJob.reason = reason;
    state.persistJob.cancel(reason);
    const progress = $("persist-card-progress");
    if (progress) progress.textContent = "Cancelling…";
    const cancel = $("persist-card-cancel");
    if (cancel) cancel.disabled = true;
}

function showPersistCard(total) {
    const card = $("persist-card");
    if (!card) return;
    const cancel = $("persist-card-cancel");
    if (cancel) cancel.disabled = false;
    updatePersistProgress(0, total);
    card.hidden = false;
    // A small file can finish copying before this frame runs; don't reveal a
    // card for a job that has already been cleared.
    requestAnimationFrame(() => {
        if (state.persistJob) card.classList.add("show");
    });
}

function updatePersistProgress(copied, total) {
    const progress = $("persist-card-progress");
    const bar = $("persist-card-bar");
    if (progress) progress.textContent = `${formatBytes(copied) || "0 B"} / ${formatBytes(total) || "0 B"}`;
    if (bar) bar.style.width = `${total ? Math.min(100, (copied / total) * 100) : 0}%`;
}

function hidePersistCard() {
    const card = $("persist-card");
    if (!card) return;
    card.classList.remove("show");
    window.setTimeout(() => {
        if (!card.classList.contains("show")) card.hidden = true;
    }, 300);
}

async function deleteStoredImport(id) {
    const record = state.storedImports.find((item) => item.id === id);
    if (!record) return;

    const title = storedImportTitle(record);
    const openNote = state.activeImportId === id ? " It's open right now and will be closed." : "";
    const confirmed = await askConfirm({
        title: "Delete stored chat?",
        body: `"${title}" (${formatBytes(record.size) || "0 B"}) will be removed from this device.${openNote} Your original export file is not affected.`,
        confirmLabel: "Delete"
    });
    if (!confirmed) return;

    try {
        await storage.deleteImport(record);
    } catch (error) {
        showToast(`Couldn't delete this chat: ${error.message}`, "error");
        return;
    }
    const wasOpen = state.activeImportId === id;
    dropStoredImport(id);
    if (wasOpen) closeActiveChat();
    showToast(`Deleted "${title}" from this device`);
}

/**
 * Puts the viewer back to its just-opened state. Used when the stored copy
 * behind the open chat is deleted — its media can no longer be read, so
 * keeping the conversation on screen would only half work.
 */
function closeActiveChat() {
    state.loadGeneration += 1;
    if (state.isSearchOpen) toggleSearch();
    closeMediaModal();
    cleanupMediaStore();
    resetChatState();
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

async function deleteAllStoredImports() {
    if (!state.storedImports.length) return;
    const count = state.storedImports.length;
    const total = state.storedImports.reduce((sum, record) => sum + (record.size || 0), 0);
    const confirmed = await askConfirm({
        title: "Delete all stored chats?",
        body: `${count} stored chat${count === 1 ? "" : "s"} (${formatBytes(total) || "0 B"}) will be removed from this device${state.activeImportId ? ", and the open chat will be closed" : ""}. Your original export files are not affected.`,
        confirmLabel: "Delete all"
    });
    if (!confirmed) return;

    try {
        await storage.deleteAllImports();
    } catch (error) {
        showToast(`Couldn't delete stored chats: ${error.message}`, "error");
        await loadStoredImports();
        return;
    }
    const wasOpen = Boolean(state.activeImportId);
    state.storedImports = [];
    state.activeImportId = "";
    removeStored(STORAGE_KEYS.lastImport);
    removeStored(STORAGE_KEYS.persistUsed);
    renderStoredImports();
    refreshStorageSettingsUI();
    if (wasOpen) closeActiveChat();
    showToast("All stored chats deleted from this device");
}

// Confirmation sheet. Native confirm() blocks the page and looks nothing like
// the app, so this reuses the date-sheet styling instead.
let confirmSheetResolver = null;

function askConfirm({ title, body, confirmLabel = "Delete" }) {
    const sheet = $("confirm-sheet");
    if (!sheet) return Promise.resolve(false);

    resolveConfirmSheet(false);
    const titleEl = $("confirm-sheet-title");
    const bodyEl = $("confirm-sheet-body");
    const applyEl = $("confirm-sheet-apply");
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (applyEl) applyEl.textContent = confirmLabel;

    sheet.hidden = false;
    requestAnimationFrame(() => {
        sheet.classList.add("open");
        $("confirm-sheet-cancel")?.focus({ preventScroll: true });
    });
    pushHistoryState("confirm");

    return new Promise((resolve) => {
        confirmSheetResolver = resolve;
    });
}

function resolveConfirmSheet(result, { fromHistory = false } = {}) {
    const sheet = $("confirm-sheet");
    if (!sheet || sheet.hidden || !sheet.classList.contains("open")) return;

    sheet.classList.remove("open");
    window.setTimeout(() => {
        if (!sheet.classList.contains("open")) sheet.hidden = true;
    }, 160);

    const resolve = confirmSheetResolver;
    confirmSheetResolver = null;
    resolve?.(result);

    if (!fromHistory && history.state && history.state.overlay === "confirm") history.back();
}

/** Swaps the sidebar between the import form and the open-chat list. */
function setUploadPanelVisible(show) {
    const hasChat = state.messageOnlyCount > 0;
    $("upload-panel")?.classList.toggle("hidden", !show);
    $("chat-list-panel")?.classList.toggle("hidden", show || !hasChat);
    const back = $("upload-back");
    if (back) back.hidden = !(show && hasChat);
}

function getSearchableText(entry) {
    // Defensive: one message without mediaItems would otherwise throw and take
    // down search for the whole chat.
    const mediaNames = (entry.mediaItems || []).map((item) => item.name).join(" ");
    return `${entry.sender || ""} ${entry.text || ""} ${mediaNames}`.toLowerCase();
}

function hydrateLazyMedia() {
    const root = $("viewport");
    if (!root) return;

    if (!("IntersectionObserver" in window)) {
        root.querySelectorAll("[data-lazy-media]").forEach(loadLazyMediaElement);
        return;
    }

    if (!state.mediaObserver) {
        state.mediaObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                loadLazyMediaElement(entry.target);
                observer.unobserve(entry.target);
            });
        }, {
            root,
            rootMargin: "800px 0px"
        });
    }

    root.querySelectorAll("[data-lazy-media]").forEach((element) => {
        state.mediaObserver.observe(element);
    });
}

async function loadLazyMediaElement(element) {
    const mediaId = element.dataset.lazyMedia || element.dataset.mediaId;
    const media = state.mediaStore.get(mediaId);
    if (!media) return;

    element.removeAttribute("data-lazy-media");

    const markLoaded = () => {
        element.classList.add("loaded");
        media.hasLoaded = true;
    };

    let source = "";
    try {
        source = await ensureMediaUrl(media);
    } catch (error) {
        console.error(error);
        return;
    }
    if (!element.isConnected || !element.dataset.mediaId && !element.closest("[data-open-media]")) {
        releaseMediaUrlIfUnused(media);
        return;
    }

    if (element.tagName === "VIDEO") {
        element.src = source;
        element.load();
        element.addEventListener("loadeddata", () => {
            element.previousElementSibling?.remove();
            markLoaded();
        }, { once: true });
    } else if (element.tagName === "AUDIO") {
        element.src = source;
        element.load();
        element.addEventListener("loadedmetadata", () => {
            markLoaded();
            const dur = element.duration;
            if (dur && isFinite(dur)) {
                const mediaId = element.dataset.mediaId;
                const durationEl = document.querySelector(`.voice-duration[data-media-id="${mediaId}"]`);
                if (durationEl) {
                    const m = Math.floor(dur / 60);
                    const s = String(Math.floor(dur % 60)).padStart(2, "0");
                    durationEl.textContent = `${m}:${s}`;
                }
            }
        }, { once: true });
    } else {
        element.onload = markLoaded;
        element.src = source;
        
        if (element.complete) {
            markLoaded();
        }
    }
}

function disconnectMediaObserver() {
    if (state.mediaObserver) {
        state.mediaObserver.disconnect();
        state.mediaObserver = null;
    }
}

function formatBytes(bytes) {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function labelForMediaKind(kind) {
    const labels = {
        image: "Image",
        sticker: "Sticker",
        video: "Video",
        audio: "Audio",
        document: "Document",
        archive: "Archive",
        contact: "Contact"
    };
    return labels[kind] || "File";
}

function createWAChatLineProcessor() {
    let lastDate = "";
    let lastMessage = null;
    let lineIndex = 0;
    // Lines that started like a timestamp but were not recognised. Only read
    // when nothing parsed, to tell "not an export" from "unknown date format".
    let unrecognizedHeaders = 0;
    let unrecognizedSample = "";

    function pushDateMarker(dateStr) {
        if (dateStr && dateStr !== lastDate) {
            state.messages.push({ type: "date", content: dateStr, rawDate: dateStr, id: `date-${lineIndex}` });
            lastDate = dateStr;
        }
    }

    function processLine(originalLine) {
        // Header recognition lives in js/whatsapp-parser.js. The sender split
        // is unchanged: a message needs a colon and a sender of at most four
        // words, otherwise the line is a system event.
        const header = parseHeaderLine(originalLine);

        if (header?.kind === "message") {
            const { rawTime, sender, content: rawContent, timestamp } = header;
            pushDateMarker(timestamp.dateLabel);
            const message = createMessageEntry(lineIndex, rawTime, sender, rawContent, timestamp);
            state.messages.push(message);
            lastMessage = message;
            lineIndex++;
            return;
        }

        if (header?.kind === "system") {
            const { rawTime, content, timestamp } = header;
            pushDateMarker(timestamp.dateLabel);
            if (content) {
                state.messages.push({ type: "system", id: `sys-${lineIndex}`, rawTime, time: timestamp.time.raw, content });
                lastMessage = null;
            }
            lineIndex++;
            return;
        }

        const line = normalizeLine(originalLine);
        if (lastMessage && lastMessage.type === "msg") {
            appendContinuation(lastMessage, line);
        } else if (!state.messageOnlyCount && looksLikeTimestampLine(line)) {
            unrecognizedHeaders += 1;
            if (!unrecognizedSample) unrecognizedSample = line.trim().slice(0, 80);
        }
        lineIndex++;
    }

    function finalize() {
        state.filteredMessages = state.messages;
        state.parseDiagnostics = { unrecognizedHeaders, unrecognizedSample };
        state.inferredDateOrder = inferDateOrder(state.messages.filter(e => e.type === "date").map(e => e.content));
        state.renderRange = { start: Math.max(0, state.filteredMessages.length - MAX_RENDERED_ITEMS), end: state.filteredMessages.length };
        generateStats();
    }

    return { processLine, finalize, getLineIndex: () => lineIndex };
}

async function parseChatData(text) {
    const { processLine, finalize, getLineIndex } = createWAChatLineProcessor();
    let start = 0;
    let nextYieldAt = 2000;
    const newlineRegex = /\r?\n/g;

    while (true) {
        const match = newlineRegex.exec(text);
        const end = match ? match.index : text.length;
        processLine(text.slice(start, end));
        const lineIndex = getLineIndex();

        if (lineIndex >= nextYieldAt) {
            const pct = text.length ? Math.round((end / text.length) * 100) : 100;
            updateLoadingCopy(`Parsing messages... ${pct}% (${lineIndex.toLocaleString()} lines)`);
            nextYieldAt = lineIndex + 2000;
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        if (!match) break;
        start = newlineRegex.lastIndex;
    }

    finalize();
}

// MEMORY NOTE: With BlobReader + streaming WritableStream, peak RAM usage for a 5GB ZIP
// is approximately equal to: decompression buffer (~a few MB) + current chunk in JS (~few KB)
// + accumulated message objects (varies by chat size). The ZIP itself is never buffered.
// Practical limit is RAM available for message objects, not file size.
async function parseChatDataFromEntry(entry, gen) {
    const { processLine, finalize, getLineIndex } = createWAChatLineProcessor();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";
    let bytesLoaded = 0;
    const totalBytes = entry.uncompressedSize || 1;
    let nextYieldAt = 2000;
    let parseSucceeded = false;

    try {
        await entry.getData(new WritableStream({
            write(chunk) {
                if (state.loadGeneration !== gen) {
                    throw new DOMException("Load superseded by a newer file selection", "AbortError");
                }
                bytesLoaded += chunk.length;
                lineBuffer += decoder.decode(chunk, { stream: true });
                const parts = lineBuffer.split("\n");
                lineBuffer = parts.pop();
                for (const rawLine of parts) {
                    processLine(rawLine);
                }
                const lineIndex = getLineIndex();
                if (lineIndex >= nextYieldAt) {
                    const pct = Math.round((bytesLoaded / totalBytes) * 100);
                    updateLoadingCopy(`Parsing messages... ${pct}% (${lineIndex.toLocaleString()} lines)`);
                    nextYieldAt = lineIndex + 2000;
                    return new Promise(resolve => setTimeout(resolve, 0));
                }
            },
            close() {
                const tail = lineBuffer + decoder.decode();
                if (tail) processLine(tail);
            }
        }));

        finalize();
        parseSucceeded = true;
    } catch (err) {
        console.error('[CL] parseChatDataFromEntry error:', err.name, err.message, err.stack);
        throw err;
    } finally {
        if (!parseSucceeded && state.zipReader) {
            state.zipReader.close().catch(() => {});
            state.zipReader = null;
        }
    }
}

function appendContinuation(message, line) {
    const parsed = parseMessageContent(line, true);
    message.text = message.text !== "" ? `${message.text}\n${parsed.text}` : parsed.text;

    trackEmojis(line);

    if (parsed.mediaItems.length) {
        message.mediaItems.push(...parsed.mediaItems);
        state.mediaCount += parsed.mediaItems.length;
        state.mediaMissingCount += parsed.mediaItems.filter(item => item.status === "missing").length;
    }
}

function parseMessageContent(content, isContinuation = false) {
    let text = content || "";
    if (!isContinuation) {
        text = text.trim();
    }

    const mediaItems = [];

    if (/^<media omitted>$/i.test(text.trim()) || /^<medien ausgeschlossen>$/i.test(text.trim()) ||
        /^(image|video|audio|sticker|document|contact card|gif) omitted$/i.test(text.trim())) {
        mediaItems.push(createMissingMediaItem("Media omitted"));
        return { text: "", mediaItems };
    }

    const attachments = extractAttachmentTokens(text);
    attachments.forEach((attachment) => {
        const mediaItem = resolveAttachment(attachment.fileName);
        mediaItems.push(mediaItem);
        text = text.replace(attachment.raw, "");
    });

    if (!mediaItems.length && looksLikeStandaloneAttachment(text.trim())) {
        mediaItems.push(resolveAttachment(text.trim()));
        text = "";
    }

    return { text: cleanupMessageText(text, isContinuation), mediaItems };
}

function cleanupMessageText(text, isContinuation = false) {
    const clean = stripInvisible(text);
    return isContinuation ? clean : clean.trim();
}

// Applied to both the ZIP entry names and the names referenced in the chat,
// so the two sides always meet on equal terms (see attachmentLookupKey).
function normalizeLookupKey(value) {
    return attachmentLookupKey(value);
}

function stripAttachmentPrefix(value) {
    return String(value || "")
        .replace(/^attached[_\s-]*/i, "")
        .replace(/^file[_\s-]*/i, "")
        .trim();
}

function baseName(filePath) {
    return String(filePath || "").split("/").pop() || "";
}

const AUDIO_EXTENSIONS = new Set(["opus", "ogg", "oga", "mp3", "m4a", "aac", "wav", "flac", "wma", "amr"]);

function detectMediaType(fileName, mimeType = "") {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    // Explicit audio guard: known voice-note extensions are always audio,
    // regardless of MIME (e.g. m4a → audio/mp4 must never be treated as video).
    if (AUDIO_EXTENSIONS.has(ext)) {
        return { kind: "audio", mime: inferMimeType(ext) || `audio/${ext}`, ext };
    }

    const mime = mimeType || inferMimeType(ext);

    if (mime.startsWith("image/")) {
        return { kind: /^sticker|webp$/i.test(ext) || /^stk-/i.test(fileName) ? "sticker" : "image", mime, ext };
    }
    if (mime.startsWith("video/")) {
        return { kind: "video", mime, ext };
    }
    if (mime.startsWith("audio/")) {
        return { kind: "audio", mime, ext };
    }
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"].includes(ext)) {
        return { kind: "document", mime, ext };
    }
    if (["zip", "rar", "7z"].includes(ext)) {
        return { kind: "archive", mime, ext };
    }
    if (["vcf"].includes(ext)) {
        return { kind: "contact", mime, ext };
    }
    return { kind: "document", mime, ext };
}

function inferMimeType(ext) {
    const map = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heif",
        mp4: "video/mp4",
        mov: "video/quicktime",
        avi: "video/x-msvideo",
        m4v: "video/x-m4v",
        webm: "video/webm",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        opus: "audio/ogg",
        ogg: "audio/ogg",
        oga: "audio/ogg",
        wav: "audio/wav",
        aac: "audio/aac",
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ppt: "application/vnd.ms-powerpoint",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        txt: "text/plain",
        vcf: "text/vcard",
        zip: "application/zip"
    };
    return map[ext] || "application/octet-stream";
}

function extractDatePart(rawTime) {
    return parserExtractDatePart(rawTime);
}

function extractTimePart(rawTime) {
    return parserExtractTimePart(rawTime);
}

function isMeSender(sender) {
    return sender.toLowerCase() === state.myName.toLowerCase() || sender === "You";
}

function getColor(name) {
    if (!state.colorMap[name]) {
        let hash = 0;
        for (let index = 0; index < name.length; index += 1) {
            hash = name.charCodeAt(index) + ((hash << 5) - hash);
        }
        state.colorMap[name] = COLORS[Math.abs(hash) % COLORS.length];
    }
    return state.colorMap[name];
}

/**
 * The Date a date label stands for, read with the user's Export Date Order and
 * Calendar settings; "auto" falls back to the order inferred from the export
 * and to era markers / year ranges (see parseDateLabel). Returns null when the
 * label is not a valid date, in which case callers keep the original text.
 */
function parseExportDateLabel(label) {
    return parseDateLabel(label, {
        order: resolveDateOrder(state.settings.dateOrder, state.inferredDateOrder),
        calendar: state.settings.calendar
    });
}

function inferDateOrder(dateLabels) {
    return parserInferDateOrder(dateLabels, {
        calendar: state.settings.calendar,
        tieBreak: getTieBreakDateOrder()
    });
}

function getTieBreakDateOrder() {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
    return locale.toLowerCase().startsWith("en-us") ? "MDY" : "DMY";
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
