/**
 * ============================================================================
 * Instagram message list rendering
 * ============================================================================
 * Paints the virtual window of `igState.filteredMessages` into
 * #ig-message-list — bubbles with reactions, shared links and media — and
 * keeps the window in step with scrolling. Also produces the normalised
 * message list the HTML export consumes.
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.7.0";
import { colorForName } from "../shared/colors.js?v=1.7.0";
import { releaseOffscreenMediaUrls } from "../shared/media-urls.js?v=1.7.0";
import { buildRichText, highlightOutsideTags } from "../shared/text.js?v=1.7.0";
import {
    clampRenderRange,
    paginateOnScroll,
    syncScrollLatestButton,
    tailRange
} from "../shared/virtual-list.js?v=1.7.0";
import { IG_BATCH_SIZE, IG_MAX_RENDERED, igState } from "./state.js?v=1.7.0";
import { lazyMedia } from "./media.js?v=1.7.0";
import { closeMenu } from "./ui.js?v=1.7.0";

export const getColor = (name) => colorForName(name, igState.colorMap);

/** Decorative bar heights for the voice-note waveform. */
const WAVEFORM_BARS = [30, 50, 70, 45, 80, 60, 35, 90, 55, 75, 40, 85, 65, 50, 70, 45, 80, 35, 65, 90, 50, 40, 75, 60, 85, 45, 70, 55, 80, 40];

// ── Main render ─────────────────────────────────────────────────────────────

export function renderChatList() {
    const list = $("ig-message-list");
    if (!list) return;

    clampRenderRange(igState, IG_MAX_RENDERED);
    lazyMedia.disconnect();
    releaseOffscreenMediaUrls(igState);

    let lastSender = null;
    let html = "";

    for (let i = igState.renderRange.start; i < igState.renderRange.end; i++) {
        const item = igState.filteredMessages[i];
        if (!item) continue;

        if (item.type === "date") {
            html += `<div class="system-msg sticky-date" id="${item.id}">${escapeHtml(item.content)}</div>`;
            lastSender = null;
            continue;
        }

        if (item.type === "system") {
            html += `<div class="system-msg" id="${item.id}">${escapeHtml(item.content)}</div>`;
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

    const senderHtml = !item.isMe && isFirst
        ? `<div class="sender" style="color:${getColor(item.sender)}">${escapeHtml(item.sender)}</div>`
        : "";

    let textHtml = "";
    if (item.text) {
        textHtml = `<div class="msg-text ${!item.mediaItems.length && !item.shareLink ? "has-meta" : ""}">${linkifyAndHighlight(item.text)}</div>`;
    }

    const mediaHtml = item.mediaItems.length ? renderMediaStack(item.mediaItems) : "";

    let shareHtml = "";
    if (item.shareLink) {
        const label = item.shareText ? escapeHtml(item.shareText) : escapeHtml(item.shareLink);
        shareHtml = `<div class="ig-share-link has-meta"><i class="ph ph-link-simple"></i><a href="${escapeAttribute(item.shareLink)}" target="_blank" rel="noopener noreferrer">${label}</a></div>`;
    }

    const reactionsHtml = item.reactions.length ? renderReactions(item.reactions) : "";

    return `
      <article class="${rowClass}" id="${item.id}">
        <div class="bubble">
          ${senderHtml}${textHtml}${mediaHtml}${shareHtml}
          <div class="meta"><span>${escapeHtml(item.time)}</span></div>
          ${reactionsHtml}
        </div>
      </article>`;
}

// ── Text ────────────────────────────────────────────────────────────────────

/** Links (no WhatsApp-style formatting markers), then the search highlight. */
export function linkifyAndHighlight(text) {
    const query = $("ig-live-search")?.value.trim();
    let html = buildRichText(escapeHtml(text || ""), { formatting: false });
    if (query) html = highlightOutsideTags(html, query);
    return html;
}

// ── Media cards ─────────────────────────────────────────────────────────────

function renderMediaStack(items) {
    return `<div class="msg-media-stack">${items.map(renderMediaItem).join("")}</div>`;
}

function renderMediaItem(item) {
    if (item.status === "missing") {
        return `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>${escapeHtml(item.name || "Missing media")}</strong><span>Not included in this export.</span></div></div></div>`;
    }

    const media = igState.mediaStore.get(item.id);
    const url = media?.url || "";
    const loaded = Boolean(media?.hasLoaded && url);
    // Already-decoded media gets its src straight away; the rest waits for
    // the lazy loader (see shared/lazy-media.js).
    const srcAttr = loaded ? `src="${escapeAttribute(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;

    if (item.kind === "image" || item.kind === "sticker") {
        const cls = item.kind === "sticker" ? "media-sticker" : "media-image";
        return `<button class="media-button ${cls}" type="button" data-open-media="${item.id}"><img ${srcAttr} data-media-id="${item.id}" alt="${escapeAttribute(item.name)}" loading="lazy" decoding="async"></button>`;
    }

    if (item.kind === "video") {
        const placeholder = loaded ? "" : `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-play-circle"></i></div>`;
        return `<div class="media-video">${placeholder}<video controls preload="none" ${srcAttr} data-media-id="${item.id}"></video></div>`;
    }

    if (item.kind === "audio") {
        const waveHtml = WAVEFORM_BARS.map((height) => `<span style="height:${height}%"></span>`).join("");
        return `<div class="media-audio ig-voice-note"><div class="voice-note-row"><i class="ph-fill ph-microphone voice-mic-icon"></i><div class="voice-waveform">${waveHtml}</div><span class="voice-duration" data-media-id="${item.id}">–:––</span></div><audio controls preload="metadata" data-lazy-media="${item.id}" data-media-id="${item.id}"></audio></div>`;
    }

    return `<div class="media-doc"><div class="media-doc-head"><i class="ph-fill ph-file"></i><div><strong>${escapeHtml(item.name)}</strong></div></div><div class="media-doc-actions"><button type="button" class="media-doc-link" data-open-media="${item.id}">Preview</button><button type="button" class="media-doc-link" data-download-media="${item.id}">Download</button></div></div>`;
}

/** Groups reactions by emoji; hovering a pill lists who reacted. */
function renderReactions(reactions) {
    const grouped = {};
    reactions.forEach((r) => {
        if (!grouped[r.reaction]) grouped[r.reaction] = [];
        grouped[r.reaction].push(r.actor);
    });
    const pills = Object.entries(grouped).map(([emoji, actors]) =>
        `<span class="ig-reaction" title="${escapeAttribute(actors.join(", "))}">${escapeHtml(emoji)}${actors.length > 1 ? ` <small>${actors.length}</small>` : ""}</span>`
    ).join("");
    return `<div class="ig-reactions">${pills}</div>`;
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Builds a normalised list of all parsed messages for the HTML export. Reads
 * from igState.filteredMessages so the export includes every message, not
 * just the virtual-scroll window — and never re-parses the raw file.
 */
export function collectExportMessages() {
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
            color: getColor(item.sender),
            text: item.text,
            media: (item.mediaItems || []).map((m) => ({ kind: m.kind, name: m.name })),
            shareLink: item.shareLink,
            shareText: item.shareText,
            reactions: item.reactions || []
        };
    });
}

// ── Search focus ────────────────────────────────────────────────────────────

/** Marks the current search hit's highlight as the focused one. */
export function syncFocusedSearchResult() {
    if (igState.searchPointer < 0 || !igState.searchResults.length) return;
    $(igState.searchResults[igState.searchPointer])?.querySelector(".hl")?.classList.add("focus");
}

// ── Scrolling ───────────────────────────────────────────────────────────────

export function handleViewportScroll(event) {
    const viewport = event.currentTarget;
    syncScrollLatest(viewport);
    paginateOnScroll(viewport, igState, {
        batchSize: IG_BATCH_SIZE,
        maxRendered: IG_MAX_RENDERED,
        render: renderChatList
    });
}

export function scrollToBottom() {
    const viewport = $("ig-viewport");
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    syncScrollLatest(viewport);
}

export function syncScrollLatest(viewport) {
    syncScrollLatestButton($("ig-scroll-latest"), viewport || $("ig-viewport"), igState);
}

/** Renders the newest window of messages. */
export function resetRenderToBottom() {
    igState.renderRange = tailRange(igState.filteredMessages.length, IG_MAX_RENDERED);
    renderChatList();
}

export function jumpToBottom() {
    closeMenu();
    resetRenderToBottom();
    requestAnimationFrame(scrollToBottom);
}
