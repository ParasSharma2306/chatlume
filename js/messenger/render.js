/**
 * Messenger message list rendering, with ChatLume's shared bubble styles,
 * virtual window helpers and lazy media loader.
 */
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.9.0-beta1";
import { buildRichText } from "../shared/text.js?v=1.9.0-beta1";
import { clampRenderRange, paginateOnScroll, syncScrollLatestButton, tailRange } from "../shared/virtual-list.js?v=1.9.0-beta1";
import { releaseOffscreenMediaUrls } from "../shared/media-urls.js?v=1.9.0-beta1";
import { messengerState } from "./state.js?v=1.9.0-beta1";
import { lazyMedia, handleMediaClick } from "./media.js?v=1.9.0-beta1";

const MAX_RENDERED = 180;
const BATCH_SIZE = 60;

function mediaItem(item) {
    if (item.status === "missing") return `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>${escapeHtml(item.name || "Missing attachment")}</strong><span>Not included in this export.</span></div></div></div>`;
    const stored = messengerState.mediaStore.get(item.id);
    const loaded = Boolean(stored?.hasLoaded && stored.url);
    const src = loaded ? `src="${escapeAttribute(stored.url)}" class="loaded"` : `data-lazy-media="${escapeAttribute(item.id)}"`;
    if (item.kind === "image") return `<button class="media-button media-image" type="button" data-open-media="${escapeAttribute(item.id)}"><img ${src} data-media-id="${escapeAttribute(item.id)}" alt="${escapeAttribute(item.name)}" loading="lazy" decoding="async"></button>`;
    if (item.kind === "video") return `<div class="media-video"><div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-play-circle"></i></div><video controls preload="none" ${src} data-media-id="${escapeAttribute(item.id)}"></video></div>`;
    if (item.kind === "audio") return `<div class="media-audio"><audio controls preload="metadata" ${src} data-media-id="${escapeAttribute(item.id)}"></audio></div>`;
    return `<div class="media-doc"><div class="media-doc-head"><i class="ph ph-file"></i><div><strong>${escapeHtml(item.name)}</strong></div></div><div class="media-doc-actions"><button type="button" class="media-doc-link" data-open-media="${escapeAttribute(item.id)}">Preview</button><button type="button" class="media-doc-link" data-download-media="${escapeAttribute(item.id)}">Download</button></div></div>`;
}

export function renderMessages() {
    const list = $("messenger-message-list");
    if (!list) return;
    clampRenderRange(messengerState, MAX_RENDERED);
    lazyMedia.disconnect();
    releaseOffscreenMediaUrls(messengerState);
    let html = "";
    let previousSender = "";
    for (let i = messengerState.renderRange.start; i < messengerState.renderRange.end; i++) {
        const item = messengerState.filteredMessages[i];
        if (!item) continue;
        if (item.type === "date") {
            html += `<div class="system-msg sticky-date" id="${escapeAttribute(item.id)}">${escapeHtml(item.content)}</div>`;
            previousSender = "";
            continue;
        }
        const isFirst = item.sender !== previousSender;
        const sender = !item.isMe && isFirst ? `<div class="sender">${escapeHtml(item.sender)}</div>` : "";
        const text = item.text ? `<div class="msg-text ${item.mediaItems.length ? "" : "has-meta"}">${buildRichText(escapeHtml(item.text), { formatting: false })}</div>` : "";
        const media = item.mediaItems.length ? `<div class="msg-media-stack">${item.mediaItems.map(mediaItem).join("")}</div>` : "";
        const direction = item.isMe ? "sent tail-out" : "received tail-in";
        html += `<article class="msg-row ${direction} ${isFirst ? "tail" : ""}" id="${escapeAttribute(item.id)}"><div class="bubble">${sender}${text}${media}<div class="meta"><span>${escapeHtml(item.time || item.rawTime || "")}</span></div></div></article>`;
        previousSender = item.sender;
    }
    list.innerHTML = html;
    lazyMedia.hydrate();
    syncLatest();
}

export function resetToLatest() {
    messengerState.renderRange = tailRange(messengerState.filteredMessages.length, MAX_RENDERED);
    renderMessages();
}

export function scrollToLatest() {
    const viewport = $("messenger-viewport");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
}

function syncLatest(viewport) {
    syncScrollLatestButton($("messenger-scroll-latest"), viewport || $("messenger-viewport"), messengerState);
}

export function handleMessageScroll(event) {
    const viewport = event.currentTarget;
    syncLatest(viewport);
    paginateOnScroll(viewport, messengerState, { batchSize: BATCH_SIZE, maxRendered: MAX_RENDERED, render: renderMessages });
}

export { handleMediaClick };
