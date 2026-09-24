/**
 * ============================================================================
 * WhatsApp message list rendering
 * ============================================================================
 * Paints the virtual window of `state.filteredMessages` into #message-list
 * as WhatsApp-style bubbles, and keeps the window in step with scrolling.
 * Also produces the normalised message list the HTML export consumes.
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.7.2";
import { colorForName } from "../shared/colors.js?v=1.7.2";
import { formatBytes, labelForMediaKind } from "../shared/media-types.js?v=1.7.2";
import { buildRichText, highlightOutsideTags } from "../shared/text.js?v=1.7.2";
import { releaseOffscreenMediaUrls } from "../shared/media-urls.js?v=1.7.2";
import {
    clampRenderRange,
    paginateOnScroll,
    syncScrollLatestButton,
    tailRange
} from "../shared/virtual-list.js?v=1.7.2";
import { BATCH_SIZE, MAX_RENDERED_ITEMS, state } from "./state.js?v=1.7.2";
import { formatDateLabel, formatMessageTime } from "./format.js?v=1.7.2";
import { lazyMedia } from "./media.js?v=1.7.2";
import { closeMenu } from "./ui.js?v=1.7.2";

/** Colour for a sender's name label, stable for the life of the chat. */
export const getColor = (name) => colorForName(name, state.colorMap);

/** WhatsApp writes calls as bare lines; "null" is how some exports mark a missed one. */
const CALL_PATTERN = /^(Missed voice call|Missed video call|Voice call|Video call|null)$/i;

/** Decorative bar heights for the voice-note waveform. */
const WAVEFORM_BARS = [30, 50, 70, 45, 80, 60, 35, 90, 55, 75, 40, 85, 65, 50, 70, 45, 80, 35, 65, 90, 50, 40, 75, 60, 85, 45, 70, 55, 80, 40];

// ── Main render ─────────────────────────────────────────────────────────────

export function renderChatList() {
    const list = $("message-list");
    if (!list) return;

    clampRenderRange(state, MAX_RENDERED_ITEMS);
    lazyMedia.disconnect();
    releaseOffscreenMediaUrls(state);

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

        html += renderMessageRow(item, item.sender !== lastSender);
        lastSender = item.sender;
    }

    list.innerHTML = html;
    syncFocusedSearchResult();
    lazyMedia.hydrate();
    syncScrollLatest();
}

/** One bubble. `isFirst` adds the tail and (for others) the sender name. */
function renderMessageRow(item, isFirst) {
    const tailClass = isFirst ? (item.isMe ? "tail-out" : "tail-in") : "";
    const rowClass = `msg-row ${item.isMe ? "sent" : "received"} ${isFirst ? "tail" : ""} ${tailClass}`.trim();
    const senderHtml = state.settings.showSenderNames && !item.isMe && isFirst
        ? `<div class="sender" style="color:${getColor(item.sender)}">${escapeHtml(item.sender)}</div>`
        : "";

    let textHtml = "";
    if (item.text) {
        textHtml = CALL_PATTERN.test(item.text)
            ? renderCallCard(item.text)
            : `<div class="msg-text ${item.mediaItems.length ? "" : "has-meta"}">${renderMessageText(item.text)}</div>`;
    }
    const mediaHtml = item.mediaItems.length ? renderMediaStack(item.mediaItems) : "";
    const readTick = item.isMe && state.settings.showReadTicks ? '<i class="ph-bold ph-checks" style="color:#53bdeb"></i>' : "";

    return `
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
}

function renderCallCard(text) {
    const isVideo = text.toLowerCase().includes("video");
    const isMissed = text.toLowerCase().includes("missed") || text === "null";
    const callIcon = isVideo ? "ph-video-camera" : "ph-phone";
    const callColor = isMissed ? "var(--danger)" : "var(--primary)";
    const callText = text === "null" ? "Missed call" : text;

    return `
        <div class="msg-text has-meta" style="display: flex; align-items: center; gap: 6px; font-weight: 500;">
            <i class="ph-fill ${callIcon}" style="font-size: 18px; color: ${callColor}"></i> 
            ${escapeHtml(callText)}
        </div>`;
}

// ── Text ────────────────────────────────────────────────────────────────────

const currentSearchQuery = () => $("live-search")?.value.trim();

/** Message body: rich text when the setting is on, else escaped + highlighted. */
export function renderMessageText(text) {
    if (state.settings.richText) {
        return linkifyAndHighlight(text);
    }

    const query = currentSearchQuery();
    let escaped = escapeHtml(text || "");
    if (query) {
        escaped = highlightOutsideTags(escaped, query);
    }
    return escaped;
}

/** Links + formatting markers, then the search highlight over the result. */
export function linkifyAndHighlight(text) {
    const query = currentSearchQuery();
    let html = buildRichText(escapeHtml(text || ""));

    if (query) {
        html = highlightOutsideTags(html, query);
    }

    return html;
}

// ── Media cards ─────────────────────────────────────────────────────────────

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
    // Already-decoded media gets its src straight away; the rest waits for
    // the lazy loader (see shared/lazy-media.js).
    const srcAttr = isLoaded ? `src="${escapeAttribute(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;

    if (item.kind === "image" || item.kind === "sticker") {
        return `
            <button class="media-button media-${item.kind}" type="button" data-open-media="${item.id}">
                <img ${srcAttr} data-media-id="${item.id}" alt="${escapeAttribute(item.name)}" loading="lazy" decoding="async">
            </button>
        `;
    }

    if (item.kind === "video") {
        const placeholder = isLoaded ? "" : `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-play-circle"></i></div>`;
        return `
            <div class="media-video">
                ${placeholder}
                <video controls preload="none" ${srcAttr} data-media-id="${item.id}"></video>
            </div>
        `;
    }

    if (item.kind === "audio") {
        const waveHtml = WAVEFORM_BARS.map((height) => `<span style="height:${height}%"></span>`).join("");
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

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Builds a normalised, theme-agnostic list of all parsed messages for the
 * HTML export. Reads from state.filteredMessages (the source of the rendered
 * DOM) so the export includes every message, not just the virtual-scroll
 * window — and never re-parses the raw file.
 */
export function collectExportMessages() {
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

// ── Search focus ────────────────────────────────────────────────────────────

/** Marks the current search hit's highlight as the focused one. */
export function syncFocusedSearchResult() {
    if (state.searchPointer < 0 || !state.searchResults.length) return;
    const current = $(state.searchResults[state.searchPointer]);
    current?.querySelector(".hl")?.classList.add("focus");
}

// ── Scrolling ───────────────────────────────────────────────────────────────

export function handleViewportScroll(event) {
    const viewport = event.currentTarget;
    syncScrollLatest(viewport);
    paginateOnScroll(viewport, state, {
        batchSize: BATCH_SIZE,
        maxRendered: MAX_RENDERED_ITEMS,
        render: renderChatList
    });
}

export function scrollToBottom() {
    const viewport = $("viewport");
    if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
        syncScrollLatest(viewport);
    }
}

export function syncScrollLatest(viewport) {
    syncScrollLatestButton($("scroll-latest"), viewport || $("viewport"), state);
}

/** Renders the newest window of messages. */
export function resetRenderToBottom() {
    state.renderRange = tailRange(state.filteredMessages.length, MAX_RENDERED_ITEMS);
    renderChatList();
}

export function jumpToBottom() {
    closeMenu();
    resetRenderToBottom();
    requestAnimationFrame(scrollToBottom);
}
