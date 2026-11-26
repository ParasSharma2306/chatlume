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
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.9.0";
import { colorForName } from "../shared/colors.js?v=1.9.0";
import { releaseOffscreenMediaUrls } from "../shared/media-urls.js?v=1.9.0";
import { toEmojiPresentation } from "../shared/emoji.js?v=1.9.0";
import { buildRichText, highlightOutsideTags, safeHttpUrl } from "../shared/text.js?v=1.9.0";
import {
    clampRenderRange,
    createBottomPin,
    paginateOnScroll,
    syncScrollLatestButton,
    tailRange
} from "../shared/virtual-list.js?v=1.9.0";
import { IG_BATCH_SIZE, IG_MAX_RENDERED, igState } from "./state.js?v=1.9.0";
import { lazyMedia } from "./media.js?v=1.9.0";
import { closeMenu } from "./ui.js?v=1.9.0";
import { formatDateLabel, formatMessageTime } from "./format.js?v=1.9.0";
import { display } from "./anonymize.js?v=1.9.0";

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
            html += `<div class="system-msg sticky-date" id="${item.id}">${escapeHtml(formatDateLabel(item.ts, igState.settings))}</div>`;
            lastSender = null;
            continue;
        }

        if (item.type === "system") {
            html += `<div class="system-msg" id="${item.id}">${escapeHtml(display.text(item.content))}</div>`;
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

    const senderHtml = igState.settings.showSenderNames && !item.isMe && isFirst
        ? `<div class="sender" style="color:${getColor(item.sender)}">${escapeHtml(display.name(item.sender))}</div>`
        : "";

    let textHtml = "";
    if (item.text) {
        textHtml = `<div class="msg-text ${!item.mediaItems.length && !item.shareLink && !item.shareText ? "has-meta" : ""}">${linkifyAndHighlight(display.text(item.text))}</div>`;
    }

    const mediaHtml = item.mediaItems.length ? renderMediaStack(item.mediaItems) : "";

    let shareHtml = "";
    if (item.shareLink || item.shareText) {
        const { link: shareLink, text: shareText } = shownShare(item);
        const href = safeHttpUrl(shareLink);
        const label = highlight(escapeHtml(shareText || shareLink || ""));
        const body = href
            ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
            : `<span>${label}</span>`;
        shareHtml = `<div class="ig-share-link"><i class="ph ph-link-simple"></i>${body}</div>`;
    }

    const reactionsHtml = item.reactions.length ? renderReactions(item.reactions) : "";

    return `
      <article class="${rowClass}" id="${item.id}">
        <div class="bubble">
          ${senderHtml}${textHtml}${mediaHtml}${shareHtml}
          ${reactionsHtml}
          <div class="meta"><span>${escapeHtml(formatMessageTime(item.ts, igState.settings))}</span></div>
        </div>
      </article>`;
}

/**
 * A shared post's link and caption as shown. A link Anonymize had to mask
 * (a name or number in the URL) is no longer a working address, so it is
 * shown as text rather than linked.
 */
function shownShare(item) {
    const link = display.text(item.shareLink) || null;
    const text = display.text(item.shareText) || null;
    if (link && link !== item.shareLink) return { link: null, text: text || link };
    return { link, text };
}

// ── Text ────────────────────────────────────────────────────────────────────

/** Links (no WhatsApp-style formatting markers), then the search highlight. */
export function linkifyAndHighlight(text) {
    return highlight(buildRichText(escapeHtml(text || ""), { formatting: false }));
}

function highlight(html) {
    const query = $("ig-live-search")?.value.trim();
    return query ? highlightOutsideTags(html, query) : html;
}

// ── Media cards ─────────────────────────────────────────────────────────────

function renderMediaStack(items) {
    return `<div class="msg-media-stack">${items.map(renderMediaItem).join("")}</div>`;
}

function renderMediaItem(item) {
    const name = display.fileName(item.name);
    if (item.status === "missing") {
        return `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>${escapeHtml(name || "Missing media")}</strong><span>Not included in this export.</span></div></div></div>`;
    }

    const media = igState.mediaStore.get(item.id);
    const url = media?.url || "";
    const loaded = Boolean(media?.hasLoaded && url);
    // Already-decoded media gets its src straight away; the rest waits for
    // the lazy loader (see shared/lazy-media.js).
    const srcAttr = loaded ? `src="${escapeAttribute(url)}" class="loaded"` : `data-lazy-media="${item.id}"`;

    if (item.kind === "image" || item.kind === "sticker") {
        const cls = item.kind === "sticker" ? "media-sticker" : "media-image";
        return `<button class="media-button ${cls}" type="button" data-open-media="${item.id}"><img ${srcAttr} data-media-id="${item.id}" alt="${escapeAttribute(name)}" loading="lazy" decoding="async"></button>`;
    }

    if (item.kind === "video") {
        const placeholder = loaded ? "" : `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-play-circle"></i></div>`;
        return `<div class="media-video">${placeholder}<video controls playsinline preload="metadata" ${srcAttr} data-media-id="${item.id}"></video></div>`;
    }

    if (item.kind === "audio") {
        const waveHtml = WAVEFORM_BARS.map((height) => `<span style="height:${height}%"></span>`).join("");
        return `<div class="media-audio ig-voice-note"><div class="voice-note-row"><i class="ph-fill ph-microphone voice-mic-icon"></i><div class="voice-waveform">${waveHtml}</div><span class="voice-duration" data-media-id="${item.id}">–:––</span></div><audio controls preload="metadata" data-lazy-media="${item.id}" data-media-id="${item.id}"></audio></div>`;
    }

    return `<div class="media-doc"><div class="media-doc-head"><i class="ph-fill ph-file"></i><div><strong>${escapeHtml(name)}</strong></div></div><div class="media-doc-actions"><button type="button" class="media-doc-link" data-open-media="${item.id}">Preview</button><button type="button" class="media-doc-link" data-download-media="${item.id}">Download</button></div></div>`;
}

/** Groups reactions by emoji; hovering a pill lists who reacted. */
function renderReactions(reactions) {
    const grouped = {};
    reactions.forEach((r) => {
        if (!grouped[r.reaction]) grouped[r.reaction] = [];
        grouped[r.reaction].push(display.name(r.actor));
    });
    const pills = Object.entries(grouped).map(([emoji, actors]) =>
        `<span class="ig-reaction" title="${escapeAttribute(actors.join(", "))}">${escapeHtml(toEmojiPresentation(emoji))}${actors.length > 1 ? ` <small>${actors.length}</small>` : ""}</span>`
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
            return { type: "date", label: formatDateLabel(item.ts, igState.settings) };
        }
        if (item.type === "system") {
            return { type: "system", text: display.text(item.content) };
        }
        return {
            type: "msg",
            sender: display.name(item.sender),
            time: formatMessageTime(item.ts, igState.settings),
            isMe: item.isMe,
            color: getColor(item.sender),
            text: display.text(item.text),
            media: (item.mediaItems || []).map((m) => ({ id: m.id, kind: m.kind, name: display.fileName(m.name) })),
            ...(({ link, text }) => ({ shareLink: link, shareText: text }))(shownShare(item)),
            reactions: (item.reactions || []).map((reaction) => ({ reaction: reaction.reaction, actor: display.name(reaction.actor) }))
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

let bottomPin = null;

export function scrollToBottom() {
    const viewport = $("ig-viewport");
    if (!viewport) return;
    bottomPin ||= createBottomPin(viewport, $("ig-message-list"), igState);
    bottomPin.pin();
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
    scrollToBottom();
}
