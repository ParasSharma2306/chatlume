const BATCH_SIZE = 60;
const MAX_RENDERED_ITEMS = 180;
const COLORS = ["#e542a3", "#1f7aec", "#d44638", "#2ecc71", "#f39c12", "#9b59b6", "#3498db", "#1abc9c"];
const STORAGE_KEYS = {
    theme: "chatlume-theme",
    settings: "chatlume-settings"
};
const SITE_URL = "https://chatlume.parassharma.in";
const SEARCH_DEBOUNCE_MS = 120;
const DEFAULT_SETTINGS = {
    timeFormat: "auto",
    showSeconds: false,
    timeBrackets: "none",
    dateFormat: "original",
    dateSeparator: "/",
    dateBrackets: "none",
    showSenderNames: true,
    showReadTicks: true,
    richText: true
};

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
    profileObjectUrl: "",
    activeTheme: "dark",
    activeMediaId: "",
    chatTitle: "Chat History",
    toastTimer: null,
    isSearchOpen: false,
    isLoading: false,
    mediaObserver: null
};

let deferredPrompt;

const $ = (id) => document.getElementById(id);
const q = (selector, root = document) => root.querySelector(selector);

document.addEventListener("DOMContentLoaded", () => {
    loadSavedSettings();
    bindUI();
    applySavedTheme();
    syncSettingsControls();
    runLoader();
    if (window.innerWidth <= 800) {
        setSidebarState(true);
    }
    registerServiceWorker();
    setupPWAInstall();
});

window.addEventListener("resize", () => {
    if (window.innerWidth > 800) { setSidebarState(false); }
});

window.addEventListener("beforeunload", cleanupObjectUrls);

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
    $("copy-upi")?.addEventListener("click", copyUPI);
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
    $("date-sheet-cancel")?.addEventListener("click", () => {
        closeDateSheet();
        if (history.state && history.state.overlay) history.back();
    });
    $("date-sheet-apply")?.addEventListener("click", applyDateSheetSelection);
    
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
            showToast("Load a chat first to generate ChatLume Wrapped!");
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
    closeMenu();
    document.querySelectorAll(".drawer.open").forEach((drawer) => drawer.classList.remove("open"));
});

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            const swPath = window.location.pathname.includes('/public/') ? '../sw.js' : 'sw.js';
            navigator.serviceWorker.register(swPath)
                .then(reg => console.log('SW registered:', reg.scope))
                .catch(err => console.log('SW registration failed:', err));
        });
    }
}

function setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = $("install-pwa");
        if (installBtn) {
            installBtn.hidden = false;
            installBtn.addEventListener("click", async () => {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    installBtn.hidden = true;
                }
                deferredPrompt = null;
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
            showToast("Loading image generator...");
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load image generator"));
                document.head.appendChild(script);
            });
        }

        const canvas = await html2canvas(element, {
            backgroundColor: document.body.classList.contains("light-theme") ? "#f0f2f5" : "#0b141a",
            scale: window.devicePixelRatio > 1 ? 2 : 3,
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
        showToast("Failed to download image.");
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
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
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
    localStorage.setItem(STORAGE_KEYS.theme, state.activeTheme);
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
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}");
        state.settings = sanitizeSettings(saved);
    } catch (error) {
        console.warn("Unable to load settings:", error);
        state.settings = { ...DEFAULT_SETTINGS };
    }
}

function sanitizeSettings(value) {
    const settings = { ...DEFAULT_SETTINGS, ...(value || {}) };
    const allowed = {
        timeFormat: ["auto", "12", "24"],
        timeBrackets: ["none", "square", "round"],
        dateFormat: ["original", "dmy", "mdy", "ymd", "long"],
        dateSeparator: ["/", "-", "."],
        dateBrackets: ["none", "square", "round"]
    };

    Object.entries(allowed).forEach(([key, values]) => {
        if (!values.includes(settings[key])) {
            settings[key] = DEFAULT_SETTINGS[key];
        }
    });

    ["showSeconds", "showSenderNames", "showReadTicks", "richText"].forEach((key) => {
        settings[key] = Boolean(settings[key]);
    });

    return settings;
}

function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
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
    rerenderAfterSettingsChange();
}

function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    syncSettingsControls();
    rerenderAfterSettingsChange();
    showToast("Settings reset");
}

function rerenderAfterSettingsChange() {
    if (state.filteredMessages.length) {
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
        const fileInput = $("file-input");
        state.selectedFile = files[0];
        try {
            if (fileInput) {
                fileInput.files = files;
            }
        } catch (error) {
            console.warn("Unable to assign dropped files to input:", error);
        }
        reflectSelectedFile(files[0]);
    });
}

function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (file) {
        state.selectedFile = file;
        reflectSelectedFile(file);
    }
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
        showToast("Please select a file");
        return;
    }
    if (!displayName) {
        showToast("Enter your display name");
        return;
    }

    state.myName = displayName;
    
    const isZip = file.name.toLowerCase().endsWith(".zip");
    const initText = isZip ? "Unzipping and extracting media into memory... This might take a minute for large files." : "Reading text file...";
    
    setLoadingState(true, `Loading ${file.name}`, initText);
    
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 60));

    cleanupMediaStore();
    resetChatState();

    if (window.innerWidth <= 800) {
        setSidebarState(false);
    }

    try {
        const { rawText, attachments } = await loadChatExport(file);
        
        updateLoadingCopy(
            attachments.length
                ? `Matched ${attachments.length.toLocaleString()} attachments. Parsing messages...`
                : "Parsing messages..."
        );
        
        await new Promise(resolve => setTimeout(resolve, 30));
        
        buildMediaStore(attachments);
        await parseChatData(rawText);

        if (state.messageOnlyCount === 0) {
            showToast("No messages could be parsed. Check export format and display name.");
            return;
        }

        updateUIState(file.name);
        renderChatList();
        requestAnimationFrame(scrollToBottom);
        showToast(`Loaded ${state.messageOnlyCount.toLocaleString()} messages`);
    } catch (error) {
        console.error(error);
        const emptyEl = document.getElementById("empty-state");
        if (emptyEl) {
            emptyEl.innerHTML = `
                <div class="illustration"><i class="ph-duotone ph-warning-circle" style="color:#f5a623"></i></div>
                <h2>Couldn't parse this file</h2>
                <p style="max-width:300px">${String(error.message || "Make sure it's a valid WhatsApp .txt or .zip export.").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
                <a href="/how-to-export" style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:13px;color:var(--primary);text-decoration:none">
                    <i class="ph ph-question"></i> How to export WhatsApp chats
                </a>`;
            emptyEl.classList.remove("hidden");
        } else {
            showToast(`Error: ${error.message}`);
        }
    } finally {
        setLoadingState(false);
    }
}

async function loadChatExport(file) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
        return {
            rawText: await readFileAsText(file),
            attachments: []
        };
    }

    if (typeof JSZip === "undefined") {
        throw new Error("Zip support is not available right now. Please refresh and try again.");
    }

    const zip = await new JSZip().loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX"));
    const chatEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".txt"));

    if (!chatEntry) {
        throw new Error("No .txt file found in ZIP");
    }

    const attachments = entries
        .filter((entry) => entry.name !== chatEntry.name)
        .map((entry) => ({
            name: baseName(entry.name),
            path: entry.name,
            entry,
            size: getZipEntrySize(entry)
        }));

    return {
        rawText: await chatEntry.async("string"),
        attachments
    };
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(String(event.target?.result || ""));
        reader.onerror = () => reject(new Error("Unable to read file"));
        reader.readAsText(file, "utf-8");
    });
}

function getZipEntrySize(entry) {
    return entry?._data?.uncompressedSize || entry?._data?.compressedSize || 0;
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
    state.activeMediaId = "";
    disconnectMediaObserver();
    updateSearchCounter();
    if ($("message-list")) $("message-list").innerHTML = "";
    if ($("emoji-grid")) $("emoji-grid").innerHTML = "";
}

function cleanupMediaStore() {
    state.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    state.mediaUrls.clear();
    state.mediaStore.clear();
    state.mediaLookup.clear();
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

    media.loadingPromise = media.entry.async("blob").then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        media.url = objectUrl;
        media.size = media.size || blob.size;
        state.mediaUrls.add(objectUrl);
        return objectUrl;
    }).finally(() => {
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
        showToast("Unable to download media");
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
    const timeStr = extractTimePart(rawTime);
    const match = timeStr.match(/(\d{1,2}):\d{2}(?::\d{2})?\s?([APap][Mm])?/);
    if (!match) return 0;
    let hour = parseInt(match[1], 10);
    const ampm = match[2] ? match[2].toLowerCase() : null;
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return hour % 24;
}

function trackEmojis(text) {
    const emojis = text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
    if (emojis) {
        emojis.forEach(e => {
            state.emojiStats[e] = (state.emojiStats[e] || 0) + 1;
        });
    }
}

function createMessageEntry(index, rawTime, sender, rawContent) {
    const message = {
        type: "msg",
        id: `msg-${index}`,
        rawTime,
        time: extractTimePart(rawTime),
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
    const hour = extractHour(rawTime);
    state.hourlyStats[hour] += 1;
    trackEmojis(rawContent);

    state.messageOnlyCount += 1;
    state.mediaCount += parsed.mediaItems.length;
    state.mediaMissingCount += parsed.mediaItems.filter((item) => item.status === "missing").length;

    return message;
}

function extractAttachmentTokens(text) {
    const matches = [];
    const patterns = [
        /<attached:\s*([^>]+)>/gi,
        /\u200e?([^()\n]+?\.[a-z0-9]{2,5})\s+\((?:file attached|datei angehängt)\)/gi
    ];

    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matches.push({
                raw: match[0],
                fileName: match[1].trim()
            });
        }
    });

    return matches;
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
    if (list) {
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
        
        if(top12.length === 0) {
            grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; font-size: 13px; color: var(--text-secondary);">No emojis found yet.</p>`;
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

    // Emojis
    const sortedEmojis = Object.entries(state.emojiStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let emojisHtml = sortedEmojis.length === 0
        ? "<span style='color: rgba(255,255,255,0.4); font-size: 13px;'>No emojis found</span>"
        : sortedEmojis.map(e => `<div class="wg-emoji-badge">${e[0]}<div class="wg-emoji-count">${e[1].toLocaleString()}</div></div>`).join("");

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
            <h2>${escapeHtml(chatTitle)}</h2>
            <p>${escapeHtml(dateRange)}</p>
        </div>

        <div class="wg-stats-grid">
            <div class="wg-stat-card">
                <span>Total Messages</span>
                <h3>${total.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Total Words</span>
                <h3>${totalWords.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Shared Media</span>
                <h3>${totalMedia.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Peak Activity</span>
                <h3>${peakHour12}</h3>
            </div>
        </div>

        <div class="wg-section">
            <span>Most Used Emojis</span>
            <div class="wg-emoji-list">
                ${emojisHtml}
            </div>
        </div>

        <div class="wg-section">
            <span>Top Contributors</span>
            <div class="wg-split">
                <div class="wg-split-bar">${barHtml}</div>
                <div class="wg-split-labels">${labelsHtml}</div>
            </div>
        </div>

        <div class="wg-brand-footer">
            <div class="wg-logo"><i class="ph-fill ph-chat-teardrop-text"></i> ChatLume Wrapped</div>
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
        return `
            <div class="media-audio">
                <div class="media-audio-head">
                    <i class="ph-fill ph-waveform"></i>
                    <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <span>${formatBytes(item.size)}</span>
                    </div>
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
        renderChatList();
        return;
    }

    state.searchResults = state.messages
        .filter((entry) => entry.type === "msg" && getSearchableText(entry).includes(normalized))
        .map((entry) => entry.id);

    if (!state.searchResults.length) {
        state.searchPointer = -1;
        updateSearchCounter("No matches");
        renderChatList();
        return;
    }

    state.searchPointer = 0;
    updateSearchCounter();
    jumpToMessage(state.searchResults[state.searchPointer]);
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

function renderMessageText(text) {
    if (state.settings.richText) {
        return linkifyAndHighlight(text);
    }

    const query = $("live-search")?.value.trim();
    let escaped = escapeHtml(text || "");
    if (query) {
        const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
        escaped = escaped.replace(regex, '<span class="hl">$1</span>');
    }
    return escaped;
}

function linkifyAndHighlight(text) {
    const query = $("live-search")?.value.trim();
    let escaped = escapeHtml(text || "");

    escaped = escaped.replace(
        /(https?:\/\/[^\s<]+)/gi,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    escaped = escaped.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/_([^_\n]+)_/g, "<em>$1</em>");
    escaped = escaped.replace(/~([^~\n]+)~/g, "<s>$1</s>");

    if (query) {
        const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
        escaped = escaped.replace(regex, '<span class="hl">$1</span>');
    }

    return escaped;
}

function formatMessageTime(rawTime) {
    const original = extractTimePart(rawTime || "");
    const parsed = parseTimeParts(original);
    if (!parsed) {
        return applyBrackets(original, state.settings.timeBrackets);
    }
    if (state.settings.timeFormat === "auto") {
        const autoTime = state.settings.showSeconds
            ? original
            : original.replace(/:(\d{2})(\s?[APap][Mm])?$/, "$2");
        return applyBrackets(autoTime.trim(), state.settings.timeBrackets);
    }

    const showSeconds = state.settings.showSeconds && parsed.second !== "";
    let hour = parsed.hour;
    let suffix = "";

    if (state.settings.timeFormat === "12") {
        if (parsed.ampm === "pm" && hour < 12) hour += 12;
        if (parsed.ampm === "am" && hour === 12) hour = 0;
        suffix = hour >= 12 ? " PM" : " AM";
        hour = (hour % 12) || 12;
    } else if (state.settings.timeFormat === "24") {
        if (parsed.ampm === "pm" && hour < 12) hour += 12;
        if (parsed.ampm === "am" && hour === 12) hour = 0;
    }

    const hourText = state.settings.timeFormat === "24" ? String(hour).padStart(2, "0") : String(hour);
    const secondText = showSeconds ? `:${String(parsed.second).padStart(2, "0")}` : "";
    return applyBrackets(`${hourText}:${String(parsed.minute).padStart(2, "0")}${secondText}${suffix}`, state.settings.timeBrackets);
}

function parseTimeParts(value) {
    const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap][Mm])?/);
    if (!match) return null;

    return {
        hour: parseInt(match[1], 10),
        minute: parseInt(match[2], 10),
        second: match[3] || "",
        ampm: match[4] ? match[4].toLowerCase() : ""
    };
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
        if (state.activeMediaId) {
            closeMediaModal();
            return;
        }
        if (!$("wrapped-modal")?.hidden) {
            $("close-wrapped")?.click();
            return;
        }
        if (!$("date-sheet")?.hidden) {
            closeDateSheet();
            return;
        }
        closeMenu();
        document.querySelectorAll(".drawer.open").forEach((drawer) => drawer.classList.remove("open"));
    }
}

function handleDateJumpAction(event) {
    event.preventDefault();
    closeMenu();

    if (!state.messages.length) {
        showToast("Load a chat first");
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
        showToast("Select a date");
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
        showToast("Invalid date format");
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
        showToast(bestAfterIndex !== -1 ? "No messages on or before that date" : "No valid date markers found");
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
    }
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
    }, 120);
}

function updateLoadingCopy(copy) {
    const copyEl = $("processing-copy");
    if (copyEl) {
        copyEl.innerText = copy;
    }
}

function showToast(message) {
    const toast = $("toast");
    if (!toast) return;

    toast.innerText = message;
    toast.classList.add("show");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 2200);
}

async function copyUPI() {
    try {
        await navigator.clipboard.writeText("parassharma2306@okaxis");
        showToast("UPI ID copied");
    } catch (error) {
        console.error(error);
        showToast("Could not copy UPI ID");
    }
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
    $("upload-panel")?.classList.add("hidden");
    $("chat-list-panel")?.classList.remove("hidden");
    $("empty-state")?.classList.add("hidden");

    state.chatTitle = filename.replace(/(_chat\.txt|WhatsApp Chat with |\.\w+$)/gi, "").trim() || "Chat History";
    const withMedia = state.mediaCount ? ` • ${state.mediaCount.toLocaleString()} media` : "";

    if ($("sidebar-title")) $("sidebar-title").innerText = state.chatTitle;
    if ($("header-name")) $("header-name").innerText = state.chatTitle;
    if ($("header-meta")) $("header-meta").innerText = `${state.messageOnlyCount.toLocaleString()} messages${withMedia}`;
    if ($("sidebar-sub")) $("sidebar-sub").innerText = state.mediaMissingCount
        ? `${state.mediaMissingCount} missing attachment${state.mediaMissingCount === 1 ? "" : "s"}`
        : "Loaded successfully";
}

function getSearchableText(entry) {
    const mediaNames = entry.mediaItems.map((item) => item.name).join(" ");
    return `${entry.sender} ${entry.text} ${mediaNames}`.toLowerCase();
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
        element.addEventListener("loadedmetadata", markLoaded, { once: true });
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

async function parseChatData(text) {
    const messageRegex = /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}[,.]?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?(.*?):\s*(.*)$/;
    const systemRegex = /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}[,.]?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?(.*)$/;

    let lastDate = "";
    let lastMessage = null;
    let lineIndex = 0;
    let start = 0;
    let nextYieldAt = 2000;
    const newlineRegex = /\r?\n/g;

    const processLine = (originalLine) => {
        const line = originalLine.replace(/[\u200E\u200F\u202A-\u202E\u200B]/g, "");

        const messageMatch = line.match(messageRegex);
        if (messageMatch) {
            const rawTime = messageMatch[1].trim();
            const sender = messageMatch[2].trim();
            const rawContent = messageMatch[3] || "";
            const dateStr = extractDatePart(rawTime);

            if (dateStr && dateStr !== lastDate) {
                state.messages.push({ type: "date", content: dateStr, rawDate: dateStr, id: `date-${lineIndex}` });
                lastDate = dateStr;
            }

            const message = createMessageEntry(lineIndex, rawTime, sender, rawContent);
            state.messages.push(message);
            lastMessage = message;
            return;
        }

        const systemMatch = line.match(systemRegex);
        if (systemMatch) {
            const rawTime = systemMatch[1].trim();
            const content = (systemMatch[2] || "").trim();
            const dateStr = extractDatePart(rawTime);

            if (dateStr && dateStr !== lastDate) {
                state.messages.push({ type: "date", content: dateStr, rawDate: dateStr, id: `date-${lineIndex}` });
                lastDate = dateStr;
            }

            if (content) {
                state.messages.push({ type: "system", id: `sys-${lineIndex}`, rawTime, time: extractTimePart(rawTime), content });
                lastMessage = null;
            }
            return;
        }

        if (lastMessage && lastMessage.type === "msg") {
            appendContinuation(lastMessage, line);
        }
    };

    while (true) {
        const match = newlineRegex.exec(text);
        const end = match ? match.index : text.length;
        processLine(text.slice(start, end));
        lineIndex += 1;

        if (lineIndex >= nextYieldAt) {
            const pct = Math.round((end / text.length) * 100);
            updateLoadingCopy(`Parsing messages... ${pct}% (${lineIndex.toLocaleString()} lines)`);
            nextYieldAt += 2000;
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        if (!match) break;
        start = newlineRegex.lastIndex;
    }

    state.filteredMessages = state.messages;
    state.inferredDateOrder = inferDateOrder(state.messages.filter(e => e.type === "date").map(e => e.content));
    state.renderRange = { start: Math.max(0, state.filteredMessages.length - MAX_RENDERED_ITEMS), end: state.filteredMessages.length };
    generateStats();
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

    if (/^<media omitted>$/i.test(text.trim()) || /^<medien ausgeschlossen>$/i.test(text.trim())) {
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
    const clean = text.replace(/[\u200E\u200F\u202A-\u202E\u200B]/g, "");
    return isContinuation ? clean : clean.trim();
}

function normalizeLookupKey(value) {
    return String(value || "")
        .trim()
        .replace(/^<attached:\s*/i, "")
        .replace(/>$/g, "")
        .replace(/\(file attached\)$/i, "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .toLowerCase();
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

function detectMediaType(fileName, mimeType = "") {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
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
    return rawTime.match(/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/)?.[0] || "";
}

function extractTimePart(rawTime) {
    return rawTime.match(/\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap][Mm])?/)?.[0] || rawTime;
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

function parseExportDateLabel(label) {
    return parseLabelWithOrder(label, state.inferredDateOrder);
}

function parseLabelWithOrder(label, order) {
    const parts = (label || "").split(/[./-]/).map((part) => part.trim());
    if (parts.length !== 3) return null;

    const [aRaw, bRaw, cRaw] = parts;
    const a = parseInt(aRaw, 10);
    const b = parseInt(bRaw, 10);
    const c = parseInt(cRaw, 10);

    if ([a, b, c].some((value) => Number.isNaN(value))) {
        return null;
    }

    if (order === "YMD") {
        if (aRaw.length !== 4) return null;
        return createDateStrict(normalizeYear(a), b, c);
    }
    if (order === "MDY") {
        return createDateStrict(normalizeYear(c), a, b);
    }
    return createDateStrict(normalizeYear(c), b, a);
}

function normalizeYear(year) {
    if (year >= 100) return year;
    return year >= 70 ? year + 1900 : year + 2000;
}

function createDateStrict(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
}

function inferDateOrder(dateLabels) {
    const labels = (dateLabels || []).filter(Boolean);
    if (!labels.length) {
        return getTieBreakDateOrder();
    }

    const candidates = ["DMY", "MDY", "YMD"];
    let bestOrder = getTieBreakDateOrder();
    let bestScore = -Infinity;

    candidates.forEach((order) => {
        const score = scoreDateOrder(labels, order);
        if (score > bestScore) {
            bestScore = score;
            bestOrder = order;
        }
    });

    return bestOrder;
}

function scoreDateOrder(labels, order) {
    let valid = 0;
    let invalid = 0;
    let monotonic = 0;
    let previousTime = null;

    labels.forEach((label) => {
        const date = parseLabelWithOrder(label, order);
        if (!date) {
            invalid += 1;
            return;
        }

        valid += 1;
        if (previousTime !== null) {
            monotonic += date.getTime() >= previousTime ? 1 : -1;
        }
        previousTime = date.getTime();
    });

    return (valid * 4) + (monotonic * 2) - (invalid * 6);
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
