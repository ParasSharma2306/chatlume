/**
 * ============================================================================
 * Virtualised message list
 * ============================================================================
 * Only a sliding window of `state.filteredMessages` is in the DOM at once
 * (`state.renderRange = { start, end }`), so 100k-message chats scroll
 * smoothly. Scrolling to either edge slides the window by one batch and
 * restores the scroll position against an anchor element so nothing jumps.
 * ============================================================================
 */
import { $ } from "./dom.js?v=1.7.0";

/** The window that shows the newest messages. */
export function tailRange(total, maxRendered) {
    return { start: Math.max(0, total - maxRendered), end: total };
}

/** Keeps the range inside the list and no wider than `maxRendered`. */
export function clampRenderRange(state, maxRendered) {
    const total = state.filteredMessages.length;
    let start = Math.max(0, Math.min(state.renderRange.start, total));
    let end = Math.max(start, Math.min(state.renderRange.end, total));

    if (end - start > maxRendered) {
        start = Math.max(0, end - maxRendered);
    }

    state.renderRange = { start, end };
}

/** First row that is at least partly visible, with its offset from the top. */
export function getScrollAnchor(viewport) {
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

/** Scrolls so the anchor row sits where it was before the re-render. */
export function restoreScrollAnchor(viewport, anchor) {
    if (!anchor?.id) return false;
    const element = $(anchor.id);
    if (!element) return false;

    const viewportRect = viewport.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    viewport.scrollTop += rect.top - viewportRect.top - anchor.offset;
    return true;
}

/**
 * Slides the window when the viewport hits the top or bottom edge.
 *
 * @param {HTMLElement} viewport
 * @param {Object}      state                 Carries renderRange / filteredMessages.
 * @param {Object}      options
 * @param {number}      options.batchSize     Rows added per step.
 * @param {number}      options.maxRendered   Window size cap.
 * @param {Function}    options.render        Re-renders the list from `state.renderRange`.
 */
export function paginateOnScroll(viewport, state, { batchSize, maxRendered, render }) {
    const total = state.filteredMessages.length;

    if (viewport.scrollTop <= 0 && state.renderRange.start > 0) {
        const anchor = getScrollAnchor(viewport);
        state.renderRange.start = Math.max(0, state.renderRange.start - batchSize);
        state.renderRange.end = Math.min(total, state.renderRange.start + maxRendered);
        render();
        if (!restoreScrollAnchor(viewport, anchor)) {
            viewport.scrollTop = 1;
        }
        return;
    }

    if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 20 && state.renderRange.end < total) {
        const anchor = getScrollAnchor(viewport);
        state.renderRange.end = Math.min(total, state.renderRange.end + batchSize);
        state.renderRange.start = Math.max(0, state.renderRange.end - maxRendered);
        render();
        if (!restoreScrollAnchor(viewport, anchor)) {
            viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - 1);
        }
    }
}

/** How far from the bottom (px) before the jump-to-latest pill appears. */
export const SCROLL_LATEST_THRESHOLD = 320;

/**
 * Shows the floating jump-to-latest pill once the conversation is scrolled
 * away from the newest message. The virtual window matters as much as the
 * pixel offset: sitting at the bottom of a mid-chat window is still far from
 * the latest message, so an unrendered tail also counts as "scrolled up".
 */
export function syncScrollLatestButton(button, viewport, state) {
    if (!button) return;

    if (!viewport || !state.filteredMessages.length) {
        button.hidden = true;
        button.classList.remove("show");
        return;
    }

    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
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
