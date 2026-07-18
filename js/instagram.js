import { configure, BlobReader, ZipReader, BlobWriter, TextWriter } from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";
import { exportChatAsHTML } from './export.js';
configure({ useDecompressionStream: typeof DecompressionStream !== 'undefined' });

const IG_SUPPORTS_STREAMING =
    typeof DecompressionStream !== 'undefined' &&
    typeof WritableStream !== 'undefined' &&
    typeof TextDecoderStream !== 'undefined';
const IG_COMPAT_FILE_SIZE_LIMIT = 1 * 1024 * 1024 * 1024; // 1 GB cap for browsers without streaming APIs

// Instagram DM Viewer — all processing is client-side, nothing is uploaded.

const IG_BATCH_SIZE = 60;
const IG_MAX_RENDERED = 180;
const IG_APP_VERSION = "1.2.3";
const IG_COLORS = ["#e542a3","#1f7aec","#d44638","#2ecc71","#f39c12","#9b59b6","#3498db","#1abc9c"];

const igState = {
  zipEntries: [],
  threads: [],
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
  selectedFile: null,
  isLoading: false,
  toastTimer: null,
  activeMediaId: "",
  chatTitle: "Instagram DMs",
  mediaObserver: null,
  activeTheme: "dark",
  searchResults: [],
  searchPointer: -1,
  searchTimer: null,
  zipReader: null,
  loadGeneration: 0
};

const $ig = (id) => document.getElementById(id);
const qig = (sel, root = document) => root.querySelector(sel);

// ── Mojibake fix ──────────────────────────────────────────────────────────────
// Instagram exports encode UTF-8 text as latin1 byte values. Re-decode as UTF-8.
function fixMojibake(str) {
  if (!str) return str;
  try {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    const decoded = new TextDecoder("utf-8").decode(bytes);
    // If the decoded version has more printable chars, it was indeed mojibaked
    return decoded;
  } catch {
    return str;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  applyIgTheme();
  bindIgUI();
  document.querySelectorAll("[data-app-version]").forEach((el) => { el.textContent = `v${IG_APP_VERSION}`; });
  runIgLoader();
  checkIgBrowserCompatibility();
  if (window.innerWidth <= 800) setIgSidebarState(true);
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 800) setIgSidebarState(false);
});

window.addEventListener("beforeunload", () => {
  igState.mediaUrls.forEach(url => URL.revokeObjectURL(url));
  igState.zipReader?.close().catch(() => {});
});

window.addEventListener("popstate", () => closeIgMediaModal());

function applyIgTheme() {
  const saved = localStorage.getItem("chatlume-theme");
  if (saved === "light") { document.body.classList.add("light-theme"); igState.activeTheme = "light"; }
  syncIgThemeButton();
}

function syncIgThemeButton() {
  const icon = qig("#ig-theme-toggle i");
  const meta = qig('meta[name="theme-color"]');
  if (icon) icon.className = igState.activeTheme === "light" ? "ph ph-sun-dim" : "ph ph-moon-stars";
  if (meta) meta.setAttribute("content", igState.activeTheme === "light" ? "#f0f2f5" : "#111b21");
}

function runIgLoader() {
  const loader = $ig("loader");
  const bar = qig(".fill");
  if (bar) setTimeout(() => { bar.style.width = "100%"; }, 100);
  if (loader) {
    setTimeout(() => {
      loader.style.opacity = "0";
      setTimeout(() => { loader.style.display = "none"; }, 500);
    }, 800);
  }
}

function checkIgBrowserCompatibility() {
  if (IG_SUPPORTS_STREAMING) return;
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

// ── UI Bindings ───────────────────────────────────────────────────────────────
function bindIgUI() {
  $ig("ig-theme-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    igState.activeTheme = document.body.classList.contains("light-theme") ? "light" : "dark";
    localStorage.setItem("chatlume-theme", igState.activeTheme);
    syncIgThemeButton();
  });

  $ig("ig-mobile-menu")?.addEventListener("click", toggleIgSidebar);
  $ig("ig-sidebar-backdrop")?.addEventListener("click", toggleIgSidebar);

  const fileInput = $ig("ig-file-input");
  $ig("ig-drop-target")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("click", e => {
    e.target.value = null;
    igState.selectedFile = null;
    resetIgDropUI();
  });
  fileInput?.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!IG_SUPPORTS_STREAMING && f.size > IG_COMPAT_FILE_SIZE_LIMIT) {
      showIgToast("File exceeds the 1 GB limit for your browser. Use Chrome 80+, Firefox 79+, or Safari 16.4+ for larger files.");
      e.target.value = "";
      return;
    }
    igState.selectedFile = f;
    reflectIgFile(f);
  });

  const dt = $ig("ig-drop-target");
  if (dt) {
    ["dragenter","dragover"].forEach(ev => dt.addEventListener(ev, e => { e.preventDefault(); dt.classList.add("dragover"); }));
    ["dragleave","drop"].forEach(ev => dt.addEventListener(ev, e => { e.preventDefault(); dt.classList.remove("dragover"); }));
    dt.addEventListener("drop", e => {
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const f = files[0];
      if (!IG_SUPPORTS_STREAMING && f.size > IG_COMPAT_FILE_SIZE_LIMIT) {
        showIgToast("File exceeds the 1 GB limit for your browser. Use Chrome 80+, Firefox 79+, or Safari 16.4+ for larger files.");
        return;
      }
      igState.selectedFile = f;
      reflectIgFile(f);
    });
  }

  $ig("ig-load-btn")?.addEventListener("click", initIgViewer);

  setupIgGlobalDropZone();

  $ig("ig-search-toggle")?.addEventListener("click", toggleIgSearch);
  $ig("ig-search-close")?.addEventListener("click", toggleIgSearch);
  $ig("ig-live-search")?.addEventListener("input", e => {
    clearTimeout(igState.searchTimer);
    igState.searchTimer = setTimeout(() => runIgSearch(e.target.value.trim().toLowerCase()), 120);
  });
  $ig("ig-search-up")?.addEventListener("click", () => navIgSearch("up"));
  $ig("ig-search-down")?.addEventListener("click", () => navIgSearch("down"));

  $ig("ig-menu-toggle")?.addEventListener("click", () => $ig("ig-header-menu")?.classList.toggle("show"));
  $ig("ig-jump-bottom")?.addEventListener("click", igJumpToBottom);
  document.addEventListener("click", e => {
    const menu = $ig("ig-header-menu");
    if (menu?.classList.contains("show") && !menu.contains(e.target) && !$ig("ig-menu-toggle")?.contains(e.target)) {
      menu.classList.remove("show");
    }
  });

  $ig("ig-media-modal-close")?.addEventListener("click", () => {
    closeIgMediaModal();
    if (history.state && history.state.overlay) history.back();
  });
  $ig("ig-media-modal-backdrop")?.addEventListener("click", closeIgMediaModal);

  $ig("ig-chat-list-item")?.addEventListener("click", () => {
    if (window.innerWidth <= 800) setIgSidebarState(false);
  });

  $ig("ig-open-stats")?.addEventListener("click", () => openIgDrawer("ig-stats"));
  $ig("ig-close-stats")?.addEventListener("click", () => closeIgDrawer("ig-stats"));

  $ig("ig-viewport")?.addEventListener("scroll", handleIgViewportScroll);
  $ig("ig-message-list")?.addEventListener("click", handleIgMessageListClick);

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (igState.activeMediaId) { closeIgMediaModal(); return; }
    document.querySelectorAll(".drawer.open").forEach(d => d.classList.remove("open"));
  });
}

function openIgDrawer(id) { $ig(`${id}-drawer`)?.classList.add("open"); }
function closeIgDrawer(id) { $ig(`${id}-drawer`)?.classList.remove("open"); }

// ── File UI ───────────────────────────────────────────────────────────────────
function reflectIgFile(file) {
  const dt = $ig("ig-drop-target");
  if (!dt) return;
  dt.classList.add("ready");
  const icon = qig("i", dt);
  const label = qig("p", dt);
  if (icon) { icon.className = "ph-fill ph-check-circle"; icon.style.color = "#C13584"; }
  if (label) label.innerHTML = `<strong>${escIg(file.name)}</strong><br><span style="font-size:12px;opacity:0.7">Ready to load</span>`;
}

function resetIgDropUI() {
  const dt = $ig("ig-drop-target");
  if (!dt) return;
  dt.classList.remove("ready");
  const icon = qig("i", dt);
  const label = qig("p", dt);
  if (icon) { icon.className = "ph ph-file-zip"; icon.style.color = ""; }
  if (label) label.innerHTML = "Drop <strong>.zip</strong> export";
}

// ── Full-window drag overlay ────────────────────────────────────────────────
// dragenter/dragleave depth counter prevents flicker when the cursor crosses
// child elements within the window.
function setupIgGlobalDropZone() {
  const overlay = $ig("ig-drag-overlay");
  if (!overlay) return;

  let depth = 0;
  const dragHasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const show = () => overlay.classList.add("active");
  const hide = () => { overlay.classList.remove("active"); overlay.classList.remove("error"); };

  window.addEventListener("dragenter", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    show();
  });
  window.addEventListener("dragover", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
  });
  window.addEventListener("dragleave", (e) => {
    if (!dragHasFiles(e)) return;
    depth -= 1;
    if (depth <= 0) { depth = 0; hide(); }
  });
  window.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    hide();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleIgDroppedFile(file);
  });
}

function handleIgDroppedFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt")) {
    showIgToast("Instagram exports are .zip (JSON format) — .txt is WhatsApp only");
    return;
  }
  if (!name.endsWith(".zip")) {
    showIgToast("Please drop a .zip Instagram export");
    return;
  }
  if (!IG_SUPPORTS_STREAMING && file.size > IG_COMPAT_FILE_SIZE_LIMIT) {
    showIgToast("File exceeds the 1 GB limit for your browser. Use Chrome 80+, Firefox 79+, or Safari 16.4+ for larger files.");
    return;
  }
  igState.selectedFile = file;
  const fileInput = $ig("ig-file-input");
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (fileInput) fileInput.files = transfer.files;
  } catch (err) {
    console.warn("Unable to assign dropped file to input:", err);
  }
  reflectIgFile(file);
  if ($ig("ig-upload-panel")?.classList.contains("hidden")) {
    if (window.innerWidth <= 800) setIgSidebarState(true);
    showIgToast("File ready — tap Load DMs to open it");
  }
}

// ── Main load flow ────────────────────────────────────────────────────────────
async function initIgViewer() {
  if (igState.isLoading) return;
  const file = $ig("ig-file-input")?.files?.[0] || igState.selectedFile;
  if (!file) { showIgToast("Please select an Instagram export ZIP"); return; }
  if (!file.name.toLowerCase().endsWith(".zip")) { showIgToast("Please select a .zip file"); return; }

  if (!IG_SUPPORTS_STREAMING && file.size > IG_COMPAT_FILE_SIZE_LIMIT) {
    showIgToast(`File is too large for your browser (${(file.size / 1073741824).toFixed(1)} GB). Use Chrome 80+, Firefox 79+, or Safari 16.4+ for files over 1 GB.`);
    return;
  }

  const igGen = ++igState.loadGeneration;

  setIgLoading(true, "Opening ZIP", "Reading your Instagram export...");
  await yieldIg();

  try {
    const reader = new ZipReader(new BlobReader(file));
    const entries = await reader.getEntries();
    igState.zipEntries = entries;
    igState.zipReader = reader;

    setIgLoading(true, "Scanning threads", "Finding message folders...");
    await yieldIg();

    const threads = findIgThreads(entries);
    if (!threads.length) throw new Error("No Instagram message folders found. Make sure you selected JSON format when requesting the export.");

    igState.threads = threads;
    setIgLoading(false);

    if (threads.length === 1) {
      await loadIgThread(threads[0]);
    } else {
      showIgThreadSelector(threads);
    }
  } catch (err) {
    console.error(err);
    const emptyEl = $ig("ig-empty-state");
    if (emptyEl) {
      emptyEl.innerHTML = `
        <div class="illustration"><i class="ph-duotone ph-warning-circle" style="color:#f5a623"></i></div>
        <h2 style="color:var(--text-primary)">Couldn't load this file</h2>
        <p style="max-width:300px">${escIg(err.message || "Make sure it's a valid Instagram JSON export ZIP.")}</p>
        <a href="how-to-export-instagram.html" style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:13px;color:#C13584;text-decoration:none">
          <i class="ph ph-question"></i> How to export Instagram DMs
        </a>`;
      emptyEl.classList.remove("hidden");
    } else {
      showIgToast(err.message || "Error loading ZIP");
    }
    setIgLoading(false);
  }
}

// ── Thread discovery ──────────────────────────────────────────────────────────
function findIgThreads(entries) {
  const map = new Map();
  entries.forEach(entry => {
    if (entry.directory) return;
    const m = entry.filename.match(/messages\/inbox\/([^/]+)\/(message_\d+\.json)$/i);
    if (!m) return;
    const folder = m[1];
    if (!map.has(folder)) map.set(folder, { folder, files: [] });
    map.get(folder).files.push(entry);
  });
  return Array.from(map.values());
}

// ── Thread selector ───────────────────────────────────────────────────────────
function showIgThreadSelector(threads) {
  $ig("ig-upload-panel")?.classList.add("hidden");
  const panel = $ig("ig-thread-panel");
  const list = $ig("ig-thread-list");
  if (!panel || !list) return;
  panel.classList.remove("hidden");

  list.innerHTML = threads.map((t, i) => `
    <button class="chat-item" type="button" data-thread-idx="${i}">
      <div class="chat-item-avatar" style="background:linear-gradient(135deg,#833AB4,#C13584,#E1306C)" aria-hidden="true"></div>
      <div class="chat-item-info">
        <h4>${escIg(igFolderLabel(t.folder))}</h4>
        <span>${t.files.length} file${t.files.length !== 1 ? "s" : ""}</span>
      </div>
    </button>`).join("");

  list.querySelectorAll("[data-thread-idx]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await loadIgThread(igState.threads[parseInt(btn.dataset.threadIdx, 10)]);
    });
  });

  if (window.innerWidth <= 800) setIgSidebarState(true);
}

function igFolderLabel(folder) {
  return folder.replace(/_[a-z0-9]{6,}$/i, "").replace(/_/g, " ").trim() || folder;
}

// ── Thread loading & parsing ──────────────────────────────────────────────────
async function loadIgThread(thread) {
  setIgLoading(true, "Loading thread", "Parsing messages...");
  await yieldIg();

  // Reset per-thread state
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
  igState.mediaStore.clear();
  igState.mediaLookup.clear();
  igState.mediaUrls.forEach(url => URL.revokeObjectURL(url));
  igState.mediaUrls.clear();
  disconnectIgMediaObserver();
  if ($ig("ig-message-list")) $ig("ig-message-list").innerHTML = "";

  try {
    const sortedFiles = [...thread.files].sort((a, b) => {
      const na = parseInt(a.filename.match(/message_(\d+)\.json$/i)?.[1] || "0", 10);
      const nb = parseInt(b.filename.match(/message_(\d+)\.json$/i)?.[1] || "0", 10);
      return na - nb;
    });

    let allRaw = [];
    let threadTitle = igFolderLabel(thread.folder);
    let participants = [];

    for (let i = 0; i < sortedFiles.length; i++) {
      setIgLoading(true, "Loading thread", `Parsing file ${i + 1} of ${sortedFiles.length}...`);
      await yieldIg();
      const text = await sortedFiles[i].getData(new TextWriter("utf-8"));
      let data;
      try { data = JSON.parse(text); } catch { continue; }
      if (data.title) threadTitle = fixMojibake(data.title);
      if (data.participants?.length && !participants.length) {
        participants = data.participants.map(p => fixMojibake(p.name));
      }
      if (data.messages?.length) allRaw.push(...data.messages);
    }

    // Oldest first
    allRaw.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

    const nameInput = $ig("ig-my-name")?.value.trim();
    igState.myName = nameInput || participants[0] || "";
    igState.chatTitle = threadTitle;

    // Build media store from all non-JSON files in this thread's folder
    buildIgMediaStore(igState.zipEntries, thread.folder);

    const validRaw = allRaw.filter(m => !m.is_unsent);
    allRaw = null; // release raw message array memory before parsing
    parseIgMessages(validRaw);

    if (igState.messageOnlyCount === 0) {
      showIgToast("No messages found in this thread.");
      setIgLoading(false);
      return;
    }

    updateIgUI(threadTitle, participants);
    renderIgChatList();
    requestAnimationFrame(igScrollToBottom);
    showIgToast(`Loaded ${igState.messageOnlyCount.toLocaleString()} messages`);
    if (window.innerWidth <= 800) setIgSidebarState(false);
    showProjectModal();

  } catch (err) {
    console.error(err);
    const emptyEl = $ig("ig-empty-state");
    if (emptyEl) {
      emptyEl.innerHTML = `
        <div class="illustration"><i class="ph-duotone ph-warning-circle" style="color:#f5a623"></i></div>
        <h2 style="color:var(--text-primary)">Couldn't parse this file</h2>
        <p style="max-width:300px">${escIg(err.message || "Make sure it's a valid Instagram JSON export ZIP.")}</p>
        <a href="how-to-export-instagram.html" style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:13px;color:#C13584;text-decoration:none">
          <i class="ph ph-question"></i> How to export Instagram DMs
        </a>`;
      emptyEl.classList.remove("hidden");
    } else {
      showIgToast(err.message || "Error parsing thread");
    }
  } finally {
    setIgLoading(false);
  }
}

// ── Media store ───────────────────────────────────────────────────────────────
function buildIgMediaStore(entries, threadFolder) {
  let idx = 0;
  entries.forEach(entry => {
    if (entry.directory || entry.filename.toLowerCase().endsWith(".json")) return;

    const mt = detectIgMediaType(igBaseName(entry.filename));
    const id = `igm-${idx++}-${igNormKey(entry.filename).slice(-20)}`;
    const media = {
      id,
      name: igBaseName(entry.filename),
      path: entry.filename,
      kind: mt.kind,
      mime: mt.mime,
      entry,
      url: "",
      loadingPromise: null,
      hasLoaded: false
    };

    igState.mediaStore.set(id, media);
    [igNormKey(entry.filename), igNormKey(igBaseName(entry.filename))].forEach(k => {
      if (k && !igState.mediaLookup.has(k)) igState.mediaLookup.set(k, media);
    });
  });
}

function findIgMedia(uri) {
  if (!uri) return null;
  // Try increasingly loose matches
  const candidates = [
    igNormKey(uri),
    igNormKey(igBaseName(uri)),
    igNormKey(uri.replace(/^[^/]*\/[^/]*\/[^/]*\/[^/]*\//, "")) // strip 4 leading path segments
  ].filter(Boolean);

  for (const k of candidates) {
    const m = igState.mediaLookup.get(k);
    if (m) return m;
  }
  return null;
}

// ── Message parsing ───────────────────────────────────────────────────────────
function parseIgMessages(rawMessages) {
  let lastDateStr = "";
  let idx = 0;

  rawMessages.forEach(raw => {
    const ts = raw.timestamp_ms || 0;
    const date = new Date(ts);
    const dateStr = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    if (dateStr !== lastDateStr) {
      igState.messages.push({ type: "date", id: `igd-${idx}`, content: dateStr, ts });
      lastDateStr = dateStr;
    }

    const sender = fixMojibake(raw.sender_name || "Unknown");
    const isMe = sender.toLowerCase() === igState.myName.toLowerCase();
    const content = raw.content ? fixMojibake(raw.content) : "";
    const shareLink = raw.share?.link || null;
    const shareText = raw.share?.share_text ? fixMojibake(raw.share.share_text) : null;
    const reactions = (raw.reactions || []).map(r => ({
      reaction: fixMojibake(r.reaction || ""),
      actor: fixMojibake(r.actor || "")
    }));

    const mediaItems = [];

    const addMediaItem = (uri, kindHint) => {
      const media = findIgMedia(uri);
      const name = igBaseName(uri || kindHint);
      if (media) {
        mediaItems.push({ id: media.id, status: "available", name: media.name, kind: media.kind, mime: media.mime });
      } else {
        mediaItems.push({ id: `igmiss-${idx}-${mediaItems.length}`, status: "missing", name, kind: kindHint });
      }
    };

    (raw.photos || []).forEach(p => addMediaItem(p.uri, "image"));
    (raw.videos || []).forEach(v => addMediaItem(v.uri, "video"));
    (raw.audio_files || []).forEach(a => addMediaItem(a.uri, "audio"));
    (raw.gifs || []).forEach(g => addMediaItem(g.uri, "image"));
    if (raw.sticker?.uri) addMediaItem(raw.sticker.uri, "sticker");

    // Skip truly empty/unsupported messages (no text, media, share, or reactions)
    if (!content && !mediaItems.length && !shareLink && !reactions.length) {
      idx++;
      return;
    }

    // Analytics
    igState.senderStats[sender] = (igState.senderStats[sender] || 0) + 1;
    igState.hourlyStats[date.getHours()] += 1;
    if (content) igTrackEmojis(content);
    igState.messageOnlyCount++;
    igState.mediaCount += mediaItems.length;

    igState.messages.push({
      type: "msg",
      id: `igmsg-${idx}`,
      ts,
      time: igFormatTime(date),
      sender,
      isMe,
      text: content,
      mediaItems,
      reactions,
      shareLink,
      shareText
    });

    idx++;
  });

  igState.filteredMessages = igState.messages;
  igState.renderRange = {
    start: Math.max(0, igState.filteredMessages.length - IG_MAX_RENDERED),
    end: igState.filteredMessages.length
  };
  generateIgStats();
}

function igFormatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
}

function igTrackEmojis(text) {
  const m = text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
  if (m) m.forEach(e => { igState.emojiStats[e] = (igState.emojiStats[e] || 0) + 1; });
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderIgChatList() {
  const list = $ig("ig-message-list");
  if (!list) return;

  igClampRange();
  disconnectIgMediaObserver();

  let lastSender = null;
  let html = "";

  for (let i = igState.renderRange.start; i < igState.renderRange.end; i++) {
    const item = igState.filteredMessages[i];
    if (!item) continue;

    if (item.type === "date") {
      html += `<div class="system-msg sticky-date" id="${item.id}">${escIg(item.content)}</div>`;
      lastSender = null;
      continue;
    }

    if (item.type === "system") {
      html += `<div class="system-msg" id="${item.id}">${escIg(item.content)}</div>`;
      lastSender = null;
      continue;
    }

    const isFirst = item.sender !== lastSender;
    const tailClass = isFirst ? (item.isMe ? "tail-out" : "tail-in") : "";
    const rowClass = `msg-row ${item.isMe ? "sent" : "received"} ${isFirst ? "tail" : ""} ${tailClass}`.trim();

    const senderHtml = !item.isMe && isFirst
      ? `<div class="sender" style="color:${getIgColor(item.sender)}">${escIg(item.sender)}</div>`
      : "";

    let textHtml = "";
    if (item.text) {
      textHtml = `<div class="msg-text ${!item.mediaItems.length && !item.shareLink ? "has-meta" : ""}">${igLinkify(item.text)}</div>`;
    }

    const mediaHtml = item.mediaItems.length ? renderIgMediaStack(item.mediaItems) : "";

    let shareHtml = "";
    if (item.shareLink) {
      const label = item.shareText ? escIg(item.shareText) : escIg(item.shareLink);
      shareHtml = `<div class="ig-share-link has-meta"><i class="ph ph-link-simple"></i><a href="${escAttrIg(item.shareLink)}" target="_blank" rel="noopener noreferrer">${label}</a></div>`;
    }

    const reactionsHtml = item.reactions.length ? renderIgReactions(item.reactions) : "";

    html += `
      <article class="${rowClass}" id="${item.id}">
        <div class="bubble">
          ${senderHtml}${textHtml}${mediaHtml}${shareHtml}
          <div class="meta"><span>${escIg(item.time)}</span></div>
          ${reactionsHtml}
        </div>
      </article>`;

    lastSender = item.sender;
  }

  list.innerHTML = html;
  igSyncSearch();
  hydrateIgLazyMedia();
}

// Builds a normalised list of all parsed messages for the HTML export. Reads
// from igState.filteredMessages so the export includes every message, not just
// the virtual-scroll window — and never re-parses the raw file.
function collectIgExportMessages() {
  return igState.filteredMessages.map((item) => {
    if (item.type === "date") {
      return { type: "date", label: item.content };
    }
    if (item.type === "system") {
      return { type: "system", text: item.content };
    }
    return {
      type: "msg",
      sender: item.sender,
      time: item.time,
      isMe: item.isMe,
      color: getIgColor(item.sender),
      text: item.text,
      media: (item.mediaItems || []).map((m) => ({ kind: m.kind, name: m.name })),
      shareLink: item.shareLink,
      shareText: item.shareText,
      reactions: item.reactions || []
    };
  });
}

function renderIgMediaStack(items) {
  return `<div class="msg-media-stack">${items.map(renderIgMediaItem).join("")}</div>`;
}

function renderIgMediaItem(item) {
  if (item.status === "missing") {
    return `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>${escIg(item.name || "Missing media")}</strong><span>Not included in this export.</span></div></div></div>`;
  }

  const media = igState.mediaStore.get(item.id);
  const url = media?.url || "";
  const loaded = Boolean(media?.hasLoaded && url);
  const srcAttr = loaded ? `src="${escAttrIg(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;

  if (item.kind === "image" || item.kind === "sticker") {
    const cls = item.kind === "sticker" ? "media-sticker" : "media-image";
    return `<button class="media-button ${cls}" type="button" data-open-media="${item.id}"><img ${srcAttr} data-media-id="${item.id}" alt="${escAttrIg(item.name)}" loading="lazy" decoding="async"></button>`;
  }

  if (item.kind === "video") {
    const placeholder = loaded ? "" : `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-play-circle"></i></div>`;
    const vsrc = loaded ? `src="${escAttrIg(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;
    return `<div class="media-video">${placeholder}<video controls preload="none" ${vsrc} data-media-id="${item.id}"></video></div>`;
  }

  if (item.kind === "audio") {
    const bars = [30,50,70,45,80,60,35,90,55,75,40,85,65,50,70,45,80,35,65,90,50,40,75,60,85,45,70,55,80,40];
    const waveHtml = bars.map(h => `<span style="height:${h}%"></span>`).join("");
    return `<div class="media-audio ig-voice-note"><div class="voice-note-row"><i class="ph-fill ph-microphone voice-mic-icon"></i><div class="voice-waveform">${waveHtml}</div><span class="voice-duration" data-media-id="${item.id}">–:––</span></div><audio controls preload="metadata" data-lazy-media="${item.id}" data-media-id="${item.id}"></audio></div>`;
  }

  return `<div class="media-doc"><div class="media-doc-head"><i class="ph-fill ph-file"></i><div><strong>${escIg(item.name)}</strong></div></div><div class="media-doc-actions"><button type="button" class="media-doc-link" data-open-media="${item.id}">Preview</button></div></div>`;
}

function renderIgReactions(reactions) {
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.reaction]) grouped[r.reaction] = [];
    grouped[r.reaction].push(r.actor);
  });
  const pills = Object.entries(grouped).map(([emoji, actors]) =>
    `<span class="ig-reaction" title="${escAttrIg(actors.join(", "))}">${escIg(emoji)}${actors.length > 1 ? ` <small>${actors.length}</small>` : ""}</span>`
  ).join("");
  return `<div class="ig-reactions">${pills}</div>`;
}

// ── Media loading ─────────────────────────────────────────────────────────────
async function ensureIgMediaUrl(media) {
  if (media.url) return media.url;
  if (media.loadingPromise) return media.loadingPromise;
  if (!media.entry) throw new Error("No entry for media");
  media.loadingPromise = media.entry
    .getData(new BlobWriter(media.mime || "application/octet-stream"))
    .then(blob => {
      const url = URL.createObjectURL(blob);
      media.url = url;
      igState.mediaUrls.add(url);
      return url;
    })
    .finally(() => { media.loadingPromise = null; });
  return media.loadingPromise;
}

function hydrateIgLazyMedia() {
  const root = $ig("ig-viewport");
  if (!root) return;
  if (!("IntersectionObserver" in window)) {
    root.querySelectorAll("[data-lazy-media]").forEach(loadIgLazyEl);
    return;
  }
  if (!igState.mediaObserver) {
    igState.mediaObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => { if (!entry.isIntersecting) return; loadIgLazyEl(entry.target); obs.unobserve(entry.target); });
    }, { root, rootMargin: "800px 0px" });
  }
  root.querySelectorAll("[data-lazy-media]").forEach(el => igState.mediaObserver.observe(el));
}

async function loadIgLazyEl(el) {
  const id = el.dataset.lazyMedia || el.dataset.mediaId;
  const media = igState.mediaStore.get(id);
  if (!media) return;
  el.removeAttribute("data-lazy-media");
  const mark = () => { el.classList.add("loaded"); media.hasLoaded = true; };
  let src;
  try { src = await ensureIgMediaUrl(media); } catch { return; }
  if (!el.isConnected) return;
  if (el.tagName === "VIDEO") {
    el.src = src; el.load();
    el.addEventListener("loadeddata", () => { el.previousElementSibling?.remove(); mark(); }, { once: true });
  } else if (el.tagName === "AUDIO") {
    el.src = src; el.load();
    el.addEventListener("loadedmetadata", () => {
      mark();
      const dur = el.duration;
      if (dur && isFinite(dur)) {
        const mediaId = el.dataset.mediaId;
        const dEl = document.querySelector(`.voice-duration[data-media-id="${mediaId}"]`);
        if (dEl) {
          const m = Math.floor(dur / 60);
          const s = String(Math.floor(dur % 60)).padStart(2, "0");
          dEl.textContent = `${m}:${s}`;
        }
      }
    }, { once: true });
  } else {
    el.onload = mark; el.src = src; if (el.complete) mark();
  }
}

function disconnectIgMediaObserver() {
  if (igState.mediaObserver) { igState.mediaObserver.disconnect(); igState.mediaObserver = null; }
}

async function handleIgMessageListClick(e) {
  const dl = e.target.closest("[data-download-media]");
  if (dl) { await downloadIgMedia(dl.dataset.downloadMedia); return; }
  const open = e.target.closest("[data-open-media]");
  if (open) await openIgMediaModal(open.dataset.openMedia);
}

async function openIgMediaModal(mediaId) {
  const media = igState.mediaStore.get(mediaId);
  const modal = $ig("ig-media-modal");
  const body = $ig("ig-media-modal-body");
  const subtitle = $ig("ig-media-modal-subtitle");
  const dl = $ig("ig-media-download-link");
  if (!modal || !body || !media) return;

  igState.activeMediaId = mediaId;
  if (subtitle) subtitle.innerText = media.name;
  body.innerHTML = `<div class="media-placeholder"><i class="ph-fill ph-spinner-gap processing-spinner"></i></div>`;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add("open"));
  history.pushState({ overlay: "igmedia" }, "");

  let url;
  try { url = await ensureIgMediaUrl(media); } catch {
    body.innerHTML = `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>Unable to load</strong><span>${escIg(media.name)}</span></div></div></div>`;
    return;
  }
  if (igState.activeMediaId !== mediaId) return;
  if (dl) { dl.href = url; dl.download = media.name; }

  if (media.kind === "image" || media.kind === "sticker") {
    body.innerHTML = `<img src="${escAttrIg(url)}" alt="${escAttrIg(media.name)}" decoding="async">`;
  } else if (media.kind === "video") {
    body.innerHTML = `<video controls autoplay src="${escAttrIg(url)}"></video>`;
  } else if (media.kind === "audio") {
    body.innerHTML = `<audio controls autoplay src="${escAttrIg(url)}"></audio>`;
  }
}

function closeIgMediaModal() {
  const modal = $ig("ig-media-modal");
  if (!modal || modal.hidden) return;
  modal.classList.remove("open");
  setTimeout(() => {
    if (!modal.classList.contains("open")) { modal.hidden = true; const b = $ig("ig-media-modal-body"); if (b) b.innerHTML = ""; }
  }, 120);
  igState.activeMediaId = "";
}

async function downloadIgMedia(id) {
  const media = igState.mediaStore.get(id);
  if (!media) return;
  try {
    const url = await ensureIgMediaUrl(media);
    const a = document.createElement("a"); a.href = url; a.download = media.name; a.click();
  } catch { showIgToast("Unable to download media"); }
}

// ── Search ────────────────────────────────────────────────────────────────────
function toggleIgSearch() {
  const bar = $ig("ig-search-toolbar");
  const input = $ig("ig-live-search");
  if (!bar || !input) return;
  const open = bar.classList.toggle("active");
  if (open) { input.focus(); return; }
  input.value = "";
  clearTimeout(igState.searchTimer);
  igState.searchResults = [];
  igState.searchPointer = -1;
  igState.renderRange = { start: Math.max(0, igState.filteredMessages.length - IG_MAX_RENDERED), end: igState.filteredMessages.length };
  updateIgSearchCounter();
  renderIgChatList();
}

function runIgSearch(query) {
  if (!query) { igState.searchResults = []; igState.searchPointer = -1; updateIgSearchCounter(); renderIgChatList(); return; }
  igState.searchResults = igState.messages.filter(m => m.type === "msg" && `${m.sender} ${m.text}`.toLowerCase().includes(query)).map(m => m.id);
  if (!igState.searchResults.length) { igState.searchPointer = -1; updateIgSearchCounter("No matches"); return; }
  igState.searchPointer = 0;
  updateIgSearchCounter();
  igJumpToMsg(igState.searchResults[0]);
}

function navIgSearch(dir) {
  if (!igState.searchResults.length) return;
  igState.searchPointer += dir === "up" ? -1 : 1;
  if (igState.searchPointer < 0) igState.searchPointer = igState.searchResults.length - 1;
  if (igState.searchPointer >= igState.searchResults.length) igState.searchPointer = 0;
  updateIgSearchCounter();
  igJumpToMsg(igState.searchResults[igState.searchPointer]);
}

function updateIgSearchCounter(fallback = "") {
  const el = $ig("ig-search-counter");
  if (!el) return;
  el.innerText = fallback || (igState.searchResults.length ? `${igState.searchPointer + 1}/${igState.searchResults.length}` : "");
}

function igJumpToMsg(id) {
  const idx = igState.filteredMessages.findIndex(m => m.id === id);
  if (idx === -1) return;
  igState.renderRange.start = Math.max(0, idx - 40);
  igState.renderRange.end = Math.min(igState.filteredMessages.length, igState.renderRange.start + IG_MAX_RENDERED);
  renderIgChatList();
  setTimeout(() => { document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "auto" }); igSyncSearch(); }, 40);
}

function igSyncSearch() {
  if (igState.searchPointer < 0 || !igState.searchResults.length) return;
  document.getElementById(igState.searchResults[igState.searchPointer])?.querySelector(".hl")?.classList.add("focus");
}

// ── Scroll helpers ────────────────────────────────────────────────────────────
function handleIgViewportScroll(e) {
  const vp = e.currentTarget;
  if (vp.scrollTop <= 0 && igState.renderRange.start > 0) {
    const anchor = getIgAnchor(vp);
    igState.renderRange.start = Math.max(0, igState.renderRange.start - IG_BATCH_SIZE);
    igState.renderRange.end = Math.min(igState.filteredMessages.length, igState.renderRange.start + IG_MAX_RENDERED);
    renderIgChatList();
    if (!restoreIgAnchor(vp, anchor)) vp.scrollTop = 1;
    return;
  }
  if (vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 20 && igState.renderRange.end < igState.filteredMessages.length) {
    const anchor = getIgAnchor(vp);
    igState.renderRange.end = Math.min(igState.filteredMessages.length, igState.renderRange.end + IG_BATCH_SIZE);
    igState.renderRange.start = Math.max(0, igState.renderRange.end - IG_MAX_RENDERED);
    renderIgChatList();
    if (!restoreIgAnchor(vp, anchor)) vp.scrollTop = Math.max(0, vp.scrollHeight - vp.clientHeight - 1);
  }
}

function getIgAnchor(vp) {
  const vr = vp.getBoundingClientRect();
  for (const el of vp.querySelectorAll(".message-list > .msg-row, .message-list > .system-msg")) {
    if (el.getBoundingClientRect().bottom >= vr.top) return { id: el.id, offset: el.getBoundingClientRect().top - vr.top };
  }
  return null;
}

function restoreIgAnchor(vp, anchor) {
  if (!anchor?.id) return false;
  const el = document.getElementById(anchor.id);
  if (!el) return false;
  vp.scrollTop += el.getBoundingClientRect().top - vp.getBoundingClientRect().top - anchor.offset;
  return true;
}

function igScrollToBottom() { const vp = $ig("ig-viewport"); if (vp) vp.scrollTop = vp.scrollHeight; }

function igJumpToBottom() {
  $ig("ig-header-menu")?.classList.remove("show");
  igState.renderRange = { start: Math.max(0, igState.filteredMessages.length - IG_MAX_RENDERED), end: igState.filteredMessages.length };
  renderIgChatList();
  requestAnimationFrame(igScrollToBottom);
}

function igClampRange() {
  const total = igState.filteredMessages.length;
  let { start, end } = igState.renderRange;
  start = Math.max(0, Math.min(start, total));
  end = Math.max(start, Math.min(end, total));
  if (end - start > IG_MAX_RENDERED) start = Math.max(0, end - IG_MAX_RENDERED);
  igState.renderRange = { start, end };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function generateIgStats() {
  const tot = $ig("ig-stat-total"); if (tot) tot.innerText = igState.messageOnlyCount.toLocaleString();
  const med = $ig("ig-stat-media"); if (med) med.innerText = igState.mediaCount.toLocaleString();

  const list = $ig("ig-stats-list");
  if (list) {
    list.innerHTML = Object.entries(igState.senderStats).sort((a, b) => b[1] - a[1]).map(([name, count]) => {
      const pct = igState.messageOnlyCount ? ((count / igState.messageOnlyCount) * 100).toFixed(1) : "0.0";
      return `<div class="stat-row"><div class="stat-header"><span class="stat-name">${escIg(name)}</span><span class="stat-pct">${pct}% (${count})</span></div><div class="progress-bg"><div class="progress-val" style="width:${pct}%"></div></div></div>`;
    }).join("");
  }

  const grid = $ig("ig-emoji-grid");
  if (grid) {
    const top = Object.entries(igState.emojiStats).sort((a, b) => b[1] - a[1]).slice(0, 12);
    grid.innerHTML = top.length
      ? top.map(([e, c]) => `<div class="emoji-item"><span class="emoji-char">${e}</span><span class="emoji-count">${c.toLocaleString()}</span></div>`).join("")
      : `<p style="grid-column:1/-1;text-align:center;font-size:13px;color:var(--text-secondary)">No emojis found.</p>`;
  }
}

// ── Analytics export ─────────────────────────────────────────────────────────

// ── UI state ──────────────────────────────────────────────────────────────────
function updateIgUI(title, participants) {
  $ig("ig-upload-panel")?.classList.add("hidden");
  $ig("ig-thread-panel")?.classList.add("hidden");
  $ig("ig-chat-list-panel")?.classList.remove("hidden");
  $ig("ig-empty-state")?.classList.add("hidden");

  const withMedia = igState.mediaCount ? ` • ${igState.mediaCount.toLocaleString()} media` : "";
  const avatar = qig(".chat-item-avatar", $ig("ig-chat-list-item"));
  if (avatar) avatar.textContent = igInitials(title);
  if ($ig("ig-sidebar-title")) $ig("ig-sidebar-title").innerText = title;
  if ($ig("ig-header-name")) $ig("ig-header-name").innerText = title;
  if ($ig("ig-header-meta")) $ig("ig-header-meta").innerText = `${igState.messageOnlyCount.toLocaleString()} messages${withMedia}`;
  if ($ig("ig-sidebar-sub")) $ig("ig-sidebar-sub").innerText = participants.join(", ") || "Direct Message";

  // Inject export button into header menu (once per session; re-inject on new thread)
  const menu = $ig("ig-header-menu");
  if (menu) {
    const existing = $ig("ig-export-chat-btn");
    if (existing) existing.remove();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item";
    btn.id = "ig-export-chat-btn";
    btn.setAttribute("data-export-btn", "");
    btn.title = "Exports text only — media referenced by filename for efficiency";
    btn.innerHTML = '<i class="ph ph-download-simple"></i> Export HTML';
    btn.addEventListener("click", () => {
      $ig("ig-header-menu")?.classList.remove("show");
      try {
        exportChatAsHTML({
          theme: "instagram",
          title: igState.chatTitle || "Instagram DMs",
          messageCount: igState.messageOnlyCount,
          messages: collectIgExportMessages()
        });
        showIgToast("Chat exported as HTML");
      } catch (err) {
        console.error('[ChatLume] Export failed:', err);
        showIgToast("Export failed");
      }
    });
    menu.appendChild(btn);
  }
}

function setIgLoading(on, title = "Loading", copy = "Please wait...") {
  igState.isLoading = on;
  const ov = $ig("ig-processing-overlay");
  const te = $ig("ig-processing-title"); if (te) te.innerText = title;
  const ce = $ig("ig-processing-copy"); if (ce) ce.innerText = copy;
  $ig("ig-load-btn")?.toggleAttribute("disabled", on);
  if (!ov) return;
  if (on) { ov.hidden = false; requestAnimationFrame(() => ov.classList.add("open")); return; }
  ov.classList.remove("open");
  setTimeout(() => { if (!ov.classList.contains("open")) ov.hidden = true; }, 120);
}

function toggleIgSidebar() { setIgSidebarState(!$ig("ig-sidebar")?.classList.contains("active")); }
function setIgSidebarState(open) {
  $ig("ig-sidebar")?.classList.toggle("active", open);
  $ig("ig-sidebar-backdrop")?.classList.toggle("active", open);
}

function showIgToast(msg) {
  const t = $ig("ig-toast"); if (!t) return;
  t.innerText = msg; t.classList.add("show");
  clearTimeout(igState.toastTimer);
  igState.toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}



// ── Utilities ─────────────────────────────────────────────────────────────────
function escIg(v) {
  return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function escAttrIg(v) { return escIg(v).replace(/`/g, "&#96;"); }

function igLinkify(text) {
  const query = $ig("ig-live-search")?.value.trim();
  let s = escIg(text || "");
  s = s.replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  if (query) {
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    s = s.replace(re, '<span class="hl">$1</span>');
  }
  return s;
}

function getIgColor(name) {
  if (!igState.colorMap[name]) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    igState.colorMap[name] = IG_COLORS[Math.abs(h) % IG_COLORS.length];
  }
  return igState.colorMap[name];
}

function igInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function igBaseName(p) { return String(p || "").split("/").pop() || ""; }

function igNormKey(p) { return String(p || "").trim().toLowerCase().replace(/\\/g, "/"); }

const IG_AUDIO_EXTENSIONS = new Set(["opus", "ogg", "oga", "mp3", "m4a", "aac", "wav", "flac", "wma", "amr"]);

function detectIgMediaType(fileName) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  // Explicit audio guard: known voice-note extensions are always audio,
  // regardless of MIME (e.g. m4a → audio/mp4 must never be treated as video).
  if (IG_AUDIO_EXTENSIONS.has(ext)) {
    const mimeMap = { mp3:"audio/mpeg", m4a:"audio/mp4", opus:"audio/ogg", ogg:"audio/ogg", oga:"audio/ogg", aac:"audio/aac", wav:"audio/wav" };
    return { kind: "audio", mime: mimeMap[ext] || `audio/${ext}`, ext };
  }

  const mimeMap = { jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",heic:"image/heic",heif:"image/heif",mp4:"video/mp4",mov:"video/quicktime",avi:"video/x-msvideo",webm:"video/webm",mp3:"audio/mpeg",m4a:"audio/mp4",opus:"audio/ogg",ogg:"audio/ogg",aac:"audio/aac",wav:"audio/wav" };
  const mime = mimeMap[ext] || "application/octet-stream";
  const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
  return { kind, mime, ext };
}

function yieldIg() {
  return new Promise(r => { requestAnimationFrame(() => setTimeout(r, 30)); });
}


function showProjectModal() {
    const storageKey = 'chatlume_project_popup_dismissed_v2';
    if (localStorage.getItem(storageKey)) return;

    if (document.getElementById('project-modal-backdrop')) return;

    const modalHtml = `
    <div class="project-modal-backdrop" id="project-modal-backdrop" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease;">
        <div class="project-modal" style="background: var(--bg-sidebar, #111b21); border: 1px solid var(--border, #2a3942); border-radius: 20px; width: 90%; max-width: 400px; padding: 24px; position: relative; transform: translateY(20px); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);">
            <button class="project-modal-close" id="project-modal-close" type="button" aria-label="Close" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--text-secondary, #8696a0); cursor: pointer; padding: 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <i class="ph ph-x"></i>
            </button>
            <div class="project-modal-content">
                <h2 style="font-size: 20px; font-weight: 700; color: var(--primary, #00a884); margin-bottom: 16px; margin-top: 0; text-align: center;">Try my other projects</h2>
                <a href="https://realtalk.parassharma.in" target="_blank" rel="noopener noreferrer" style="display: block; background: rgba(0, 168, 132, 0.05); border: 1px solid rgba(0, 168, 132, 0.15); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; text-decoration: none;">
                    <h3 style="font-size: 16px; font-weight: 600; color: var(--text-primary, #e9edef); margin: 0 0 4px 0; display: flex; align-items: center; gap: 6px;">RealTalk AI <i class="ph-bold ph-arrow-up-right" style="font-size:12px"></i></h3>
                    <p style="font-size: 13px; color: var(--text-secondary, #8696a0); margin: 0; line-height: 1.4;">A basic AI personality report. Costs $1.99 USD.</p>
                </a>
                <a href="https://parassharma.com" target="_blank" rel="noopener noreferrer" style="display: block; background: rgba(0, 168, 132, 0.05); border: 1px solid rgba(0, 168, 132, 0.15); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; text-decoration: none;">
                    <h3 style="font-size: 16px; font-weight: 600; color: var(--text-primary, #e9edef); margin: 0 0 4px 0; display: flex; align-items: center; gap: 6px;">Portfolio <i class="ph-bold ph-arrow-up-right" style="font-size:12px"></i></h3>
                    <p style="font-size: 13px; color: var(--text-secondary, #8696a0); margin: 0; line-height: 1.4;">Know me better at parassharma.com</p>
                </a>
            </div>
            <div class="project-modal-actions" style="margin-top: 20px; text-align: center;">
                <button class="btn-secondary" id="project-dismiss" type="button" style="width: 100%;">Dismiss</button>
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const backdrop = document.getElementById('project-modal-backdrop');
    const modal = backdrop.querySelector('.project-modal');
    const closeBtn = document.getElementById('project-modal-close');
    const dismissBtn = document.getElementById('project-dismiss');

    // Slight delay for smooth animation
    setTimeout(() => {
        backdrop.style.opacity = '1';
        modal.style.transform = 'translateY(0)';
    }, 1500); // Wait 1.5 seconds after chat finishes loading

    const closeModal = () => {
        backdrop.style.opacity = '0';
        modal.style.transform = 'translateY(20px)';
        setTimeout(() => backdrop.remove(), 300);
        try { localStorage.setItem(storageKey, 'true'); } catch (e) {}
    };

    closeBtn.onclick = closeModal;
    dismissBtn.onclick = closeModal;
    backdrop.onclick = (e) => {
        if (e.target === backdrop) closeModal();
    };
}
