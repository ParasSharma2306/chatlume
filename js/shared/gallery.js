/**
 * ============================================================================
 * Media gallery
 * ============================================================================
 * The "Media, links and docs" panel both viewers open from the chat menu. It
 * covers the message list (the header, filter and Anonymize banner stay put)
 * and has tabs built from already-parsed messages (see gallery-model.js):
 *
 *   Media   photos and videos in a grid; tap opens the lightbox, which steps
 *           through them all
 *   Links   a list; tap opens the link in a new tab (WhatsApp only: in
 *           Instagram nearly every link is a shared reel or post, which
 *           would bury everything else, so those stay in the chat)
 *   Docs    documents open in the viewer; voice notes and other audio play
 *           and pause inline
 *
 * Long-press (touch), right-click (mouse) or the Menu key / Shift+F10 on an
 * item offers "Jump to message", which closes the gallery and scrolls the
 * chat to the message it came from.
 *
 * Built for very long chats: lists render a page at a time (more load as the
 * end scrolls into view), thumbnails decode only near the viewport and are
 * released again when they scroll far away, and every blob URL the gallery
 * holds is pinned in `state.pinnedMediaIds` while shown and released after.
 *
 * Everything shown — sender labels, link text, captions, file names — goes
 * through the viewer's Anonymize `display`. Link targets are the original
 * URLs, never rewritten; only their visible text is masked.
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "./dom.js?v=1.10.1";
import { overlayDepth, popOverlayState, pushOverlayState } from "./history.js?v=1.10.1";
import { collectGallery } from "./gallery-model.js?v=1.10.1";
import { createLongPress } from "./long-press.js?v=1.10.1";
import { hostOf, maskUrlLabel } from "./text.js?v=1.10.1";

export const GALLERY_TABS = ["media", "links", "docs"];

const TAB_META = {
    media: { label: "Media", icon: "ph-images", page: 60, noun: ["photo or video", "photos or videos"] },
    links: { label: "Links", icon: "ph-link-simple", page: 40, noun: ["link", "links"] },
    docs: { label: "Docs", icon: "ph-file-text", page: 40, noun: ["document or voice note", "documents or voice notes"] }
};

/** Icon for a row in the Docs list. */
const DOC_ICONS = { audio: "ph-microphone", archive: "ph-file-zip", contact: "ph-address-book", document: "ph-file-text" };

/** Thumbnails decode within this distance of the visible area and are released beyond it. */
const THUMB_MARGIN = "600px 0px";
/** The next page loads once its "Show more" button is this close. */
const MORE_MARGIN = "900px 0px";

const plural = (count, [one, many]) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const cssEscape = (value) => (window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

function formatClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "–:––";
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * @param {Object}   config
 * @param {string}   config.prefix           Element id prefix ("gallery", "ig-gallery").
 * @param {string}   config.viewportId       The message list's scroll container.
 * @param {string}   config.openerId         Focus goes back here when the gallery closes.
 * @param {string}   config.overlayId        History entry name (Back closes the gallery).
 * @param {string}   config.platform         "whatsapp" | "instagram" (empty-state copy).
 * @param {string[]} [config.tabs]           Which of GALLERY_TABS to show, in order.
 * @param {string}   [config.title]          Panel heading.
 * @param {Function} [config.describeSize]   bytes → "1.2 MB" for Docs rows.
 * @param {Object}   config.state            Viewer state (pinnedMediaIds).
 * @param {Object}   config.display          The viewer's Anonymize view.
 * @param {Function} config.getMessages      () → the (filtered) parsed messages.
 * @param {Function} config.isFiltered       () → whether a sender filter is active.
 * @param {Function} config.getMedia         id → media record.
 * @param {Function} config.ensureUrl        media → Promise<blob URL>.
 * @param {Function} config.releaseIfUnused  media → void.
 * @param {Function} config.describeWhen     gallery item → "16/01/2024 18:10".
 * @param {Function} config.openLightbox     (mediaId, options) → void (media-modal open).
 * @param {Function} config.jumpToMessage    messageId → void; scrolls and highlights.
 * @param {Function} config.notify           (message, type) → void (toast).
 * @param {string}   [config.howToExportHref]
 */
export function createGallery(config) {
    const {
        prefix, viewportId, openerId, overlayId, platform, state, display,
        getMessages, isFiltered, getMedia, ensureUrl, releaseIfUnused,
        describeWhen, openLightbox, jumpToMessage, notify, howToExportHref = "",
        title = "Media, links and docs", describeSize = () => ""
    } = config;
    const TABS = (config.tabs || GALLERY_TABS).filter((key) => TAB_META[key]);

    let built = false;
    let panel = null;
    let scroller = null;
    let menu = null;
    let menuTarget = null;
    const tabButtons = {};
    const tabPanels = {};

    let isOpen = false;
    let depth = 0;
    let activeTab = TABS[0];
    let data = null;
    let dataKey = [];
    const shown = Object.fromEntries(TABS.map((key) => [key, 0]));
    const rendered = Object.fromEntries(TABS.map((key) => [key, false]));
    const scrollPositions = Object.fromEntries(TABS.map((key) => [key, 0]));

    let thumbObserver = null;
    let moreObserver = null;
    const pins = new Map();
    const player = { audio: null, key: "", mediaId: "" };

    // ── Building ────────────────────────────────────────────────────────────

    function build() {
        if (built) return true;
        const viewport = $(viewportId);
        const wrap = viewport?.closest(".viewport-wrap");
        if (!wrap) return false;

        panel = document.createElement("section");
        panel.className = "gallery-panel";
        panel.id = `${prefix}-panel`;
        panel.hidden = true;
        panel.setAttribute("aria-labelledby", `${prefix}-title`);
        panel.innerHTML = `
            <div class="gallery-bar">
                <button type="button" class="gallery-back" id="${prefix}-back" aria-label="Back to chat"><i class="ph ph-arrow-left" aria-hidden="true"></i></button>
                <h2 id="${prefix}-title">${escapeHtml(title)}</h2>
            </div>
            <div class="gallery-tabs" role="tablist" aria-label="Media type">
                ${TABS.map((key) => `
                <button type="button" role="tab" class="gallery-tab" id="${prefix}-tab-${key}" aria-controls="${prefix}-tabpanel-${key}" aria-selected="false" tabindex="-1" data-gallery-tab="${key}">
                    <i class="ph ${TAB_META[key].icon}" aria-hidden="true"></i><span>${TAB_META[key].label}</span><span class="gallery-count" data-gallery-count="${key}"></span>
                </button>`).join("")}
            </div>
            <p class="gallery-note" id="${prefix}-note" hidden></p>
            <div class="gallery-scroll" id="${prefix}-scroll">
                ${TABS.map((key) => `<div class="gallery-tabpanel gallery-tabpanel-${key}" role="tabpanel" id="${prefix}-tabpanel-${key}" aria-labelledby="${prefix}-tab-${key}" tabindex="0" data-gallery-panel="${key}" hidden></div>`).join("")}
            </div>
            <p class="sr-only" id="${prefix}-hint">For more options, including Jump to message, long-press, right-click, or press Shift+F10.</p>`;
        wrap.appendChild(panel);

        scroller = $(`${prefix}-scroll`);
        TABS.forEach((key) => {
            tabButtons[key] = $(`${prefix}-tab-${key}`);
            tabPanels[key] = $(`${prefix}-tabpanel-${key}`);
        });

        // On <body>, not in the panel: position: fixed must not be caught by
        // a transformed ancestor, and it has to float over everything.
        menu = document.createElement("div");
        menu.className = "gallery-menu";
        menu.id = `${prefix}-menu`;
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Item options");
        menu.hidden = true;
        menu.innerHTML = `<button type="button" role="menuitem" class="gallery-menu-item" data-gallery-action="jump"><i class="ph ph-arrow-bend-up-left" aria-hidden="true"></i> Jump to message</button>`;
        document.body.appendChild(menu);

        bindEvents();
        built = true;
        return true;
    }

    function bindEvents() {
        $(`${prefix}-back`).addEventListener("click", () => dismiss());

        const tablist = panel.querySelector("[role=tablist]");
        tablist.addEventListener("click", (event) => {
            const tab = event.target.closest("[data-gallery-tab]");
            if (tab) selectTab(tab.dataset.galleryTab, { focus: true });
        });
        tablist.addEventListener("keydown", (event) => {
            const index = TABS.indexOf(event.target.closest("[data-gallery-tab]")?.dataset.galleryTab);
            if (index < 0) return;
            const rtl = getComputedStyle(tablist).direction === "rtl";
            let next = -1;
            if (event.key === "ArrowRight") next = index + (rtl ? -1 : 1);
            else if (event.key === "ArrowLeft") next = index + (rtl ? 1 : -1);
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = TABS.length - 1;
            else return;
            event.preventDefault();
            selectTab(TABS[(next + TABS.length) % TABS.length], { focus: true });
        });

        scroller.addEventListener("click", handleListClick);
        createLongPress(scroller, { selector: ".gallery-item", onMenu: openMenu });

        menu.addEventListener("click", (event) => {
            if (!event.target.closest("[data-gallery-action=jump]") || !menuTarget) return;
            const target = menuTarget;
            closeMenu({ restoreFocus: false });
            jumpFrom(target);
        });
        menu.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMenu({ restoreFocus: true });
            } else if (event.key === "Tab") {
                event.preventDefault();
                closeMenu({ restoreFocus: true });
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                menu.querySelector("[role=menuitem]")?.focus();
            }
        });
    }

    // ── Opening and closing ─────────────────────────────────────────────────

    function open(tab) {
        const messages = getMessages();
        if (!messages.length) {
            notify?.("Load a chat first", "warn");
            return;
        }
        if (!build()) return;
        if (tab && TABS.includes(tab)) activeTab = tab;
        if (isOpen) {
            selectTab(activeTab, { focus: true });
            return;
        }
        isOpen = true;
        ensureData(true);
        resetRendered();
        renderChrome();
        panel.hidden = false;
        setChatHidden(true);
        pushOverlayState(overlayId);
        depth = overlayDepth();
        selectTab(activeTab, { focus: true, restoreScroll: false });
    }

    /** Closes without touching history (Back already popped the entry). */
    function close({ restoreFocus = true } = {}) {
        if (!isOpen) return;
        isOpen = false;
        const hadFocus = panel.contains(document.activeElement) || menu.contains(document.activeElement);
        closeMenu({ restoreFocus: false });
        stopPlayer();
        teardownLists();
        panel.hidden = true;
        setChatHidden(false);
        if (restoreFocus && (hadFocus || document.activeElement === document.body)) {
            $(openerId)?.focus({ preventScroll: true });
        }
    }

    /**
     * Closes from a user gesture (back arrow, Escape, Jump): pops its history
     * entry too. Resolves once that Back has landed, so a caller can open
     * another overlay without racing it. When something else sits above the
     * gallery's entry (a drawer), popping would close that instead, so the
     * entry is left for Back to skip.
     */
    function dismiss(options) {
        if (!isOpen) return Promise.resolve();
        close(options);
        if (history.state?.overlay !== overlayId) return Promise.resolve();
        return new Promise((resolve) => {
            let timer = 0;
            const done = () => {
                window.removeEventListener("popstate", done);
                window.clearTimeout(timer);
                resolve();
            };
            window.addEventListener("popstate", done);
            timer = window.setTimeout(done, 500);
            popOverlayState();
        });
    }

    /** A new chat (or none): close and forget everything built from the old one. */
    function reset() {
        dismiss({ restoreFocus: false });
        data = null;
        dataKey = [];
        activeTab = TABS[0];
        TABS.forEach((key) => { scrollPositions[key] = 0; });
        resetRendered();
    }

    /**
     * The messages or how they're shown changed (sender filter, Anonymize,
     * owner). Re-renders in place, keeping the tab, how far it was paged and
     * the scroll position.
     */
    function refresh() {
        if (!built) return;
        if (!isOpen) {
            data = null;
            return;
        }
        const keep = { ...shown };
        const top = scroller.scrollTop;
        ensureData(true);
        stopPlayer();
        teardownLists();
        resetRendered();
        renderChrome();
        TABS.forEach((key) => { shown[key] = 0; });
        renderTab(activeTab, Math.max(keep[activeTab], TAB_META[activeTab].page));
        scroller.scrollTop = top;
    }

    function setChatHidden(hidden) {
        const viewport = $(viewportId);
        viewport?.closest(".chat-interface")?.classList.toggle("gallery-open", hidden);
        if (!viewport) return;
        // Hidden behind the panel: keep its links and media out of Tab order
        // and out of the screen reader's reach.
        viewport.inert = hidden;
        if (hidden) viewport.setAttribute("aria-hidden", "true");
        else viewport.removeAttribute("aria-hidden");
    }

    // ── Data ────────────────────────────────────────────────────────────────

    function ensureData(force = false) {
        const messages = getMessages();
        const key = [messages, messages.length];
        if (!force && data && key.every((part, index) => part === dataKey[index])) return data;
        dataKey = key;
        data = collectGallery(messages);
        return data;
    }

    function resetRendered() {
        TABS.forEach((key) => {
            rendered[key] = false;
            shown[key] = 0;
        });
    }

    // ── Tabs ────────────────────────────────────────────────────────────────

    function renderChrome() {
        TABS.forEach((key) => {
            const count = panel.querySelector(`[data-gallery-count="${key}"]`);
            if (count) count.textContent = data[key].length ? data[key].length.toLocaleString() : "";
        });
        const note = $(`${prefix}-note`);
        if (note) {
            note.hidden = !isFiltered();
            note.textContent = isFiltered() ? "Showing only messages from the participants you filtered by." : "";
        }
    }

    function selectTab(key, { focus = false, restoreScroll = true } = {}) {
        if (!TABS.includes(key) || !built) return;
        if (key !== activeTab && isOpen) scrollPositions[activeTab] = scroller.scrollTop;
        activeTab = key;
        TABS.forEach((tab) => {
            const selected = tab === key;
            tabButtons[tab].setAttribute("aria-selected", String(selected));
            tabButtons[tab].tabIndex = selected ? 0 : -1;
            tabPanels[tab].hidden = !selected;
        });
        if (!rendered[key]) renderTab(key);
        scroller.scrollTop = restoreScroll ? scrollPositions[key] : 0;
        // Re-observe: a panel that was hidden reported nothing while hidden.
        observeMore(tabPanels[key]);
        if (focus) tabButtons[key].focus({ preventScroll: true });
    }

    function renderTab(key, count = TAB_META[key].page) {
        const host = tabPanels[key];
        releaseThumbs(host);
        rendered[key] = true;
        const items = data[key];
        if (!items.length) {
            host.innerHTML = emptyStateHtml(key);
            shown[key] = 0;
            return;
        }
        const end = Math.min(items.length, count);
        const listClass = key === "media" ? "gallery-grid" : "gallery-list";
        host.innerHTML = `${noticeHtml(key)}<ul class="${listClass}" role="list">${itemsHtml(key, 0, end)}</ul>${moreHtml(key, end)}`;
        shown[key] = end;
        observeThumbs(host);
        observeMore(host);
    }

    function appendPage(key, { focusNew = false } = {}) {
        const host = tabPanels[key];
        const list = host.querySelector("ul");
        const items = data?.[key] || [];
        const start = shown[key];
        if (!list || start >= items.length) return;
        const end = Math.min(items.length, start + TAB_META[key].page);
        list.insertAdjacentHTML("beforeend", itemsHtml(key, start, end));
        shown[key] = end;
        const more = host.querySelector("[data-gallery-more]");
        if (more) {
            moreObserver?.unobserve(more);
            if (end >= items.length) {
                // Never strand keyboard focus on a button that goes away.
                if (document.activeElement === more) focusNew = true;
                more.remove();
            } else {
                // Updated in place: replacing it would drop focus for someone
                // who just tabbed onto it (and it loads more as it comes into view).
                const left = more.querySelector("span");
                if (left) left.textContent = `(${(items.length - end).toLocaleString()} left)`;
            }
        }
        observeThumbs(host);
        observeMore(host);
        if (focusNew) host.querySelector(`[data-gallery-index="${start}"]`)?.focus();
    }

    // ── Markup ──────────────────────────────────────────────────────────────

    function itemsHtml(key, start, end) {
        const items = data[key];
        let html = "";
        for (let index = start; index < end; index += 1) {
            const item = items[index];
            if (key === "media") html += mediaTileHtml(item, index);
            else if (key === "links") html += linkHtml(item, index);
            else if (item.kind === "audio") html += voiceHtml(item, index);
            else html += docHtml(item, index);
        }
        return html;
    }

    const metaHtml = (sender, when) => `<span class="gallery-meta"><bdi>${escapeHtml(sender)}</bdi>${when ? ` · <span>${escapeHtml(when)}</span>` : ""}</span>`;

    function mediaTileHtml(item, index) {
        const sender = display.name(item.sender) || "Unknown";
        const when = describeWhen(item);
        const isVideo = item.kind === "video";
        const label = `${isVideo ? "Video" : "Photo"} from ${sender}${when ? `, ${when}` : ""}`;
        // A video shows its first frame: muted, metadata only, never playing here.
        const thumb = isVideo
            ? `<video muted playsinline preload="metadata" tabindex="-1" aria-hidden="true" disablepictureinpicture data-gallery-thumb="${escapeAttribute(item.mediaId)}"></video><span class="gallery-video-badge" aria-hidden="true"><i class="ph-fill ph-play"></i></span>`
            : `<img alt="" draggable="false" decoding="async" data-gallery-thumb="${escapeAttribute(item.mediaId)}">`;
        return `<li><button type="button" class="gallery-item gallery-photo${isVideo ? " gallery-video" : ""}" data-gallery-index="${index}" data-gallery-key="${escapeAttribute(item.key)}" data-media-id="${escapeAttribute(item.mediaId)}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}" aria-describedby="${prefix}-hint">${thumb}</button></li>`;
    }

    function docHtml(item, index) {
        const sender = display.name(item.sender) || "Unknown";
        const when = describeWhen(item);
        const name = display.fileName(item.name) || "Attachment";
        const size = describeSize(item.size || getMedia(item.mediaId)?.size || 0);
        const ext = String(item.name || "").split(".").pop();
        const type = ext && ext !== item.name && ext.length <= 5 ? ext.toUpperCase() : "";
        const details = [type, size].filter(Boolean).join(" · ");
        return `<li><button type="button" class="gallery-item gallery-doc" data-gallery-index="${index}" data-gallery-key="${escapeAttribute(item.key)}" data-media-id="${escapeAttribute(item.mediaId)}" aria-label="${escapeAttribute(`${name}${details ? `, ${details}` : ""}, from ${sender}${when ? `, ${when}` : ""}`)}" aria-describedby="${prefix}-hint">
            <span class="gallery-doc-icon" aria-hidden="true"><i class="ph-fill ${DOC_ICONS[item.kind] || "ph-file"}"></i></span>
            <span class="gallery-link-body"><span class="gallery-link-title" dir="auto">${escapeHtml(name)}</span>${details ? `<span class="gallery-link-url">${escapeHtml(details)}</span>` : ""}${metaHtml(sender, when)}</span>
        </button></li>`;
    }

    function linkHtml(item, index) {
        const sender = display.name(item.sender) || "Unknown";
        const when = describeWhen(item);
        // The href is the URL exactly as sent; only the text people see is masked.
        // Paths join words with "_" ("/Bob_Jones"): mask them as file names are.
        const shownUrl = maskUrlLabel(item.url, display.fileName);
        const title = item.label ? display.text(item.label) : shownUrl;
        const secondary = item.label ? shownUrl : display.text(hostOf(item.url));
        return `<li><a class="gallery-item gallery-link" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer" draggable="false" data-gallery-index="${index}" data-gallery-key="${escapeAttribute(item.key)}" aria-describedby="${prefix}-hint">
            <span class="gallery-link-icon" aria-hidden="true"><i class="ph ph-link-simple"></i></span>
            <span class="gallery-link-body"><span class="gallery-link-title" dir="auto">${escapeHtml(title)}</span>${secondary && secondary !== title ? `<span class="gallery-link-url" dir="ltr">${escapeHtml(secondary)}</span>` : ""}${metaHtml(sender, when)}</span>
            <i class="ph ph-arrow-square-out gallery-link-out" aria-hidden="true"></i>
        </a></li>`;
    }

    /** "Voice note" for recorded notes; an audio file's (masked) name otherwise. */
    function voiceTitle(item) {
        const name = String(item.name || "");
        if (platform === "instagram" || /^PTT-|-AUDIO-|^audioclip/i.test(name)) return "Voice note";
        return display.fileName(name) || "Audio";
    }

    function voiceHtml(item, index) {
        const sender = display.name(item.sender) || "Unknown";
        const when = describeWhen(item);
        const label = `${voiceTitle(item)} from ${sender}${when ? `, ${when}` : ""}`;
        const playing = player.key === item.key && player.audio && !player.audio.paused;
        return `<li><button type="button" class="gallery-item gallery-voice${playing ? " is-playing" : ""}" data-gallery-index="${index}" data-gallery-key="${escapeAttribute(item.key)}" data-media-id="${escapeAttribute(item.mediaId)}" aria-pressed="${playing}" aria-label="${escapeAttribute(label)}" aria-describedby="${prefix}-hint">
            <span class="gallery-voice-toggle" aria-hidden="true"><i class="ph-fill ${playing ? "ph-pause" : "ph-play"}"></i></span>
            <span class="gallery-voice-body"><span class="gallery-link-title" dir="auto">${escapeHtml(voiceTitle(item))}</span><span class="gallery-voice-track" aria-hidden="true"><span class="gallery-voice-progress"></span></span>${metaHtml(sender, when)}</span>
            <span class="gallery-voice-time" aria-hidden="true">–:––</span>
        </button></li>`;
    }

    function moreHtml(key, end) {
        const left = data[key].length - end;
        if (left <= 0) return "";
        return `<button type="button" class="gallery-more" data-gallery-more="${key}">Show more <span>(${left.toLocaleString()} left)</span></button>`;
    }

    /** "3 photos mentioned in the chat aren't in this export." above a non-empty tab. */
    function noticeHtml(key) {
        const missing = data.missing[key] || 0;
        const parts = [];
        if (missing) parts.push(`${plural(missing, TAB_META[key].noun)} mentioned in the chat ${missing === 1 ? "isn't" : "aren't"} in this export.`);
        if (key !== "links" && data.omitted) parts.push(`${plural(data.omitted, ["attachment was", "attachments were"])} left out of the export ("&lt;Media omitted&gt;").`);
        return parts.length ? `<p class="gallery-notice"><i class="ph-fill ph-info" aria-hidden="true"></i><span>${parts.join(" ")}</span></p>` : "";
    }

    function emptyStateHtml(key) {
        const meta = TAB_META[key];
        const filtered = isFiltered() ? " from the participants you filtered by" : "";
        let title = `No ${meta.noun[1]}`;
        let body = `No ${meta.noun[1]} were shared in this chat${filtered}.`;
        let cta = "";
        const missing = data.missing[key] || 0;
        if (key === "media") {
            title = "No media";
            body = `No photos or videos were shared in this chat${filtered}.`;
        } else if (key === "docs") {
            title = "No docs";
            body = `No documents, voice notes or audio were shared in this chat${filtered}.`;
        }

        if (key !== "links" && data.omitted && platform === "whatsapp") {
            title = key === "media" ? "No media in this export" : "No docs in this export";
            body = `This chat was exported without media: WhatsApp replaced ${plural(data.omitted, ["attachment", "attachments"])} with “&lt;Media omitted&gt;”. Export it again with <strong>Attach media</strong> (or <strong>Include media</strong>) and open the .zip to see photos, videos, documents and voice notes here.`;
            if (howToExportHref) cta = `<a class="empty-cta" href="${escapeAttribute(howToExportHref)}"><i class="ph ph-question" aria-hidden="true"></i> How to export with media</a>`;
        } else if (missing) {
            title = key === "media" ? "Media not included" : "Docs not included";
            body = `${plural(missing, meta.noun)} ${missing === 1 ? "is" : "are"} mentioned in this chat${filtered}, but the ${missing === 1 ? "file isn't" : "files aren't"} in the export.`;
        }
        const icon = { media: "ph-image", links: "ph-link-simple-break", docs: "ph-file-dashed" }[key];
        return `<div class="gallery-empty" role="status"><i class="ph-duotone ${icon}" aria-hidden="true"></i><h3>${title}</h3><p>${body}</p>${cta}</div>`;
    }

    // ── Thumbnails ──────────────────────────────────────────────────────────

    function pin(mediaId) {
        pins.set(mediaId, (pins.get(mediaId) || 0) + 1);
        state.pinnedMediaIds.add(mediaId);
    }

    function unpin(mediaId) {
        const count = (pins.get(mediaId) || 0) - 1;
        if (count > 0) {
            pins.set(mediaId, count);
            return;
        }
        pins.delete(mediaId);
        state.pinnedMediaIds.delete(mediaId);
        const media = getMedia(mediaId);
        if (media) releaseIfUnused(media);
    }

    function observeThumbs(host) {
        const images = host.querySelectorAll("[data-gallery-thumb]:not([data-observed])");
        if (!("IntersectionObserver" in window)) {
            images.forEach(loadThumb);
            return;
        }
        thumbObserver ||= new IntersectionObserver((entries) => {
            entries.forEach((entry) => (entry.isIntersecting ? loadThumb(entry.target) : unloadThumb(entry.target)));
        }, { root: scroller, rootMargin: THUMB_MARGIN });
        images.forEach((image) => {
            image.dataset.observed = "1";
            thumbObserver.observe(image);
        });
    }

    function loadThumb(image) {
        if (image.dataset.state) return;
        const mediaId = image.dataset.galleryThumb;
        const media = getMedia(mediaId);
        if (!media) {
            markBroken(image);
            return;
        }
        image.dataset.state = "loading";
        pin(mediaId);
        ensureUrl(media).then((url) => {
            // Scrolled away (or the gallery closed) while the entry decoded: the
            // URL only exists now, after the unpin, so let it go here.
            if (image.dataset.state !== "loading" || !image.isConnected) {
                releaseIfUnused(media);
                return;
            }
            image.dataset.state = "loaded";
            const loaded = () => image.closest(".gallery-photo")?.classList.add("loaded");
            image.addEventListener("error", () => markBroken(image), { once: true });
            if (image.tagName === "VIDEO") {
                image.addEventListener("loadeddata", loaded, { once: true });
                // #t: ask for a frame just past the start (some open on black).
                image.src = `${url}#t=0.1`;
            } else {
                image.addEventListener("load", loaded, { once: true });
                image.src = url;
            }
        }).catch((error) => {
            console.error(error);
            if (image.dataset.state === "loading") {
                unpin(mediaId);
                markBroken(image);
            }
        });
    }

    function unloadThumb(image) {
        const stateName = image.dataset.state;
        if (stateName !== "loading" && stateName !== "loaded") return;
        delete image.dataset.state;
        image.removeAttribute("src");
        // A <video> keeps its decoder until it is told the source is gone.
        if (image.tagName === "VIDEO") image.load();
        image.closest(".gallery-photo")?.classList.remove("loaded");
        unpin(image.dataset.galleryThumb);
    }

    function markBroken(image) {
        image.dataset.state = "broken";
        image.removeAttribute("src");
        const tile = image.closest(".gallery-photo");
        if (!tile) return;
        tile.classList.add("is-broken");
        if (!tile.querySelector(".gallery-broken-icon")) tile.insertAdjacentHTML("beforeend", `<i class="ph ph-image-broken gallery-broken-icon" aria-hidden="true"></i>`);
        tile.setAttribute("aria-label", `${tile.getAttribute("aria-label")} (can't be previewed)`);
    }

    function releaseThumbs(host) {
        host.querySelectorAll("[data-gallery-thumb]").forEach((image) => {
            thumbObserver?.unobserve(image);
            unloadThumb(image);
        });
    }

    function observeMore(host) {
        const more = host.querySelector("[data-gallery-more]");
        if (!more || !("IntersectionObserver" in window)) return;
        moreObserver ||= new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && isOpen) appendPage(entry.target.dataset.galleryMore);
            });
        }, { root: scroller, rootMargin: MORE_MARGIN });
        // Observing again reports the current state, so a page that still
        // leaves the button in range loads the next one too.
        moreObserver.unobserve(more);
        moreObserver.observe(more);
    }

    function teardownLists() {
        TABS.forEach((key) => {
            releaseThumbs(tabPanels[key]);
            tabPanels[key].innerHTML = "";
        });
        thumbObserver?.disconnect();
        thumbObserver = null;
        moreObserver?.disconnect();
        moreObserver = null;
        // Anything still pinned (a decode that never finished) is let go.
        [...pins.keys()].forEach((mediaId) => {
            pins.set(mediaId, 1);
            unpin(mediaId);
        });
    }

    // ── Item actions ────────────────────────────────────────────────────────

    function itemFor(element) {
        const key = element?.closest("[data-gallery-panel]")?.dataset.galleryPanel;
        const index = Number(element?.dataset.galleryIndex);
        const item = key && data?.[key]?.[index];
        return item ? { key, index, item } : null;
    }

    function handleListClick(event) {
        const more = event.target.closest("[data-gallery-more]");
        if (more) {
            appendPage(more.dataset.galleryMore, { focusNew: true });
            return;
        }
        const element = event.target.closest(".gallery-item");
        const found = element && itemFor(element);
        if (!found) return;
        if (found.key === "media") {
            event.preventDefault();
            openMedia(found.index, element);
        } else if (found.key === "docs") {
            event.preventDefault();
            if (found.item.kind === "audio") togglePlay(found.item);
            else openLightbox(found.item.mediaId, { returnFocus: () => (element.isConnected ? element : null) });
        }
        // Links: the browser opens them (target=_blank, noopener noreferrer).
    }

    function openMedia(index, element) {
        const photos = data.media;
        const byMedia = new Map();
        photos.forEach((photo) => { if (!byMedia.has(photo.mediaId)) byMedia.set(photo.mediaId, photo); });
        openLightbox(photos[index].mediaId, {
            sequence: [...byMedia.keys()],
            caption: (mediaId) => {
                const photo = byMedia.get(mediaId);
                return photo ? [display.name(photo.sender), describeWhen(photo)].filter(Boolean).join(" · ") : "";
            },
            // Back on the tile of the photo last shown, if it is rendered.
            returnFocus: (mediaId) => scroller.querySelector(`.gallery-photo[data-media-id="${cssEscape(mediaId)}"]`) || (element.isConnected ? element : null)
        });
    }

    function jumpFrom(element) {
        const found = itemFor(element);
        if (!found) return;
        dismiss({ restoreFocus: false });
        jumpToMessage(found.item.messageId);
    }

    // ── Voice notes ─────────────────────────────────────────────────────────

    function ensureAudio() {
        if (player.audio) return player.audio;
        const audio = new Audio();
        audio.preload = "metadata";
        const sync = () => syncVoiceRow();
        ["play", "pause", "loadedmetadata", "timeupdate", "durationchange"].forEach((type) => audio.addEventListener(type, sync));
        audio.addEventListener("ended", () => {
            audio.currentTime = 0;
            syncVoiceRow();
        });
        audio.addEventListener("error", () => {
            if (!player.key || !audio.getAttribute("src")) return;
            notify?.("This voice note can't be played in this browser", "error");
            stopPlayer();
        });
        player.audio = audio;
        return audio;
    }

    function togglePlay(item) {
        const media = getMedia(item.mediaId);
        if (!media) return;
        const audio = ensureAudio();
        if (player.key === item.key) {
            if (audio.paused) audio.play().catch(handlePlayError);
            else audio.pause();
            return;
        }
        stopPlayer();
        player.key = item.key;
        player.mediaId = item.mediaId;
        pin(item.mediaId);
        voiceRow(item.key)?.classList.add("is-loading");
        ensureUrl(media).then((url) => {
            if (player.key !== item.key) {
                // Stopped (or another note started) while it decoded.
                releaseIfUnused(media);
                return;
            }
            audio.src = url;
            return audio.play();
        }).catch(handlePlayError);
    }

    function handlePlayError(error) {
        // A pause or a newer note interrupting play() is not a failure.
        if (error?.name === "AbortError" || !player.key) return;
        console.error(error);
        notify?.("This voice note can't be played in this browser", "error");
        stopPlayer();
    }

    function stopPlayer() {
        const { audio, key, mediaId } = player;
        player.key = "";
        player.mediaId = "";
        if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
        }
        if (key) resetVoiceRow(voiceRow(key));
        if (mediaId) unpin(mediaId);
    }

    const voiceRow = (key) => (scroller ? scroller.querySelector(`.gallery-voice[data-gallery-key="${cssEscape(key)}"]`) : null);

    function syncVoiceRow() {
        const { audio, key } = player;
        const row = key && voiceRow(key);
        if (!audio || !row) return;
        const playing = !audio.paused && !audio.ended;
        row.classList.remove("is-loading");
        row.classList.toggle("is-playing", playing);
        row.setAttribute("aria-pressed", String(playing));
        const icon = row.querySelector(".gallery-voice-toggle i");
        if (icon) icon.className = `ph-fill ${playing ? "ph-pause" : "ph-play"}`;
        const duration = audio.duration;
        const progress = Number.isFinite(duration) && duration > 0 ? Math.min(1, audio.currentTime / duration) : 0;
        const bar = row.querySelector(".gallery-voice-progress");
        if (bar) bar.style.width = `${(progress * 100).toFixed(1)}%`;
        const time = row.querySelector(".gallery-voice-time");
        if (time) time.textContent = audio.currentTime > 0 ? formatClock(audio.currentTime) : formatClock(duration);
    }

    function resetVoiceRow(row) {
        if (!row) return;
        row.classList.remove("is-playing", "is-loading");
        row.setAttribute("aria-pressed", "false");
        const icon = row.querySelector(".gallery-voice-toggle i");
        if (icon) icon.className = "ph-fill ph-play";
        const bar = row.querySelector(".gallery-voice-progress");
        if (bar) bar.style.width = "0%";
    }

    // ── Context menu ────────────────────────────────────────────────────────

    function openMenu(element, { x, y, source }) {
        if (!itemFor(element)) return;
        menuTarget = element;
        menu.hidden = false;
        const { width, height } = menu.getBoundingClientRect();
        const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
        const top = y + height + 8 > window.innerHeight ? Math.max(8, y - height) : y;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        element.classList.add("menu-open");
        const focusItem = () => menu.querySelector("[role=menuitem]")?.focus({ preventScroll: true });
        focusItem();
        // Lifting the finger sends compatibility mouse events that put focus
        // back on the item; take it again once the touch is over.
        if (source === "touch") document.addEventListener("pointerup", () => window.setTimeout(() => { if (!menu.hidden) focusItem(); }, 0), { once: true, capture: true });
        // Next tick: the press that opened it must not also close it.
        window.setTimeout(() => {
            document.addEventListener("pointerdown", onOutsidePointer, true);
            scroller.addEventListener("scroll", onScrollWhileMenu, { passive: true, once: true });
        }, 0);
    }

    function closeMenu({ restoreFocus = false } = {}) {
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        document.removeEventListener("pointerdown", onOutsidePointer, true);
        scroller?.removeEventListener("scroll", onScrollWhileMenu);
        const target = menuTarget;
        menuTarget = null;
        target?.classList.remove("menu-open");
        if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
    }

    function onOutsidePointer(event) {
        if (!menu.contains(event.target)) closeMenu({ restoreFocus: false });
    }

    function onScrollWhileMenu() {
        closeMenu({ restoreFocus: false });
    }

    /** Back: close only when it went below the gallery's own entry. */
    function handlePopState(event) {
        if (isOpen && overlayDepth(event.state) < depth) close();
    }

    return {
        open,
        close,
        handlePopState,
        dismiss,
        reset,
        refresh,
        isOpen: () => isOpen,
        isMenuOpen: () => Boolean(menu && !menu.hidden),
        closeMenu
    };
}
