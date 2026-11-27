/**
 * ============================================================================
 * Full-screen media viewer
 * ============================================================================
 * Tap any attachment and it opens here with a download link. Images, videos
 * and audio render inline; anything else (a PDF, a .vcf, an unknown
 * extension) gets a document card with a download button — without that
 * branch the modal sat on its loading spinner forever.
 *
 * Opened with a `sequence` (the gallery's photos) it is a lightbox: previous
 * / next buttons, ←/→ keys and a horizontal swipe step through the list.
 * Focus moves into the dialog, Tab stays inside it, and closing returns
 * focus to whatever opened it (or to the tile of the photo last shown).
 *
 * The factory binds to a page's element ids and to the viewer's state, which
 * must expose `activeMediaId` (also read by the blob-URL release logic).
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "./dom.js?v=1.10.1";
import { pushOverlayState } from "./history.js?v=1.10.1";

/** Horizontal travel (px) that counts as a swipe in the lightbox. */
const SWIPE_DISTANCE = 50;

const FOCUSABLE = "a[href], button:not([disabled]), video[controls], audio[controls], [tabindex]:not([tabindex='-1'])";

/**
 * @param {Object}   options
 * @param {Object}   options.state             Viewer state carrying `activeMediaId`.
 * @param {Object}   options.ids               { modal, body, subtitle, download, close? }
 * @param {string}   options.overlayId         History entry name for Back handling.
 * @param {Function} options.getMedia          id → media record.
 * @param {Function} options.ensureUrl         media → Promise<blob URL>.
 * @param {Function} options.subtitleFor       media → header text.
 * @param {Function} options.documentNoteFor   media → secondary line on the document card.
 * @param {Function} [options.onClosed]        Called with each media the viewer stops showing.
 * @param {Function} [options.nameFor]         media → the name shown and downloaded
 *                                             (anonymized in Anonymize mode).
 */
export function createMediaModal({ state, ids, overlayId, getMedia, ensureUrl, subtitleFor, documentNoteFor, onClosed, nameFor = (media) => media.name }) {
    let sequence = null;
    let captionFor = null;
    let returnFocus = null;
    let opener = null;
    let bound = false;

    const visible = () => {
        const modal = $(ids.modal);
        return Boolean(modal && !modal.hidden && modal.classList.contains("open"));
    };

    /**
     * @param {string} mediaId
     * @param {Object}   [options]
     * @param {string[]} [options.sequence]     Media ids to step through (lightbox).
     * @param {Function} [options.caption]      mediaId → extra subtitle text (sender, date).
     * @param {Function} [options.returnFocus]  mediaId → element to focus on close.
     */
    async function open(mediaId, { sequence: list = null, caption = null, returnFocus: focusTarget = null } = {}) {
        const modal = $(ids.modal);
        if (!modal || !getMedia(mediaId)) return;
        if (modal.hidden) {
            const active = document.activeElement;
            opener = active && active !== document.body && !modal.contains(active) ? active : null;
        }
        sequence = Array.isArray(list) && list.length > 1 ? list.slice() : null;
        captionFor = typeof caption === "function" ? caption : null;
        returnFocus = typeof focusTarget === "function" ? focusTarget : null;
        bindOnce(modal);
        await show(mediaId, { focus: true });
    }

    async function show(mediaId, { focus = false } = {}) {
        const media = getMedia(mediaId);
        const modal = $(ids.modal);
        const body = $(ids.body);
        const subtitle = $(ids.subtitle);
        const downloadLink = $(ids.download);

        if (!modal || !body || !media) return;

        const name = nameFor(media);
        state.activeMediaId = mediaId;
        const position = sequence ? sequence.indexOf(mediaId) : -1;
        if (subtitle) {
            const extra = captionFor ? captionFor(mediaId) : "";
            const counter = position >= 0 ? `${position + 1} of ${sequence.length}` : "";
            subtitle.innerText = [subtitleFor(media), extra, counter].filter(Boolean).join(" · ");
        }
        syncNav(modal, position);
        body.innerHTML = `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-spinner-gap processing-spinner"></i></div>`;
        const wasHidden = modal.hidden;
        modal.hidden = false;
        modal.classList.add("open");
        if (wasHidden) pushOverlayState(overlayId);
        // After "open": nothing inside a display:none modal can take focus.
        if (focus) focusInitial(modal);
        // Never offer the previous attachment's file while this one decodes.
        downloadLink?.removeAttribute("href");

        let url = "";
        try {
            url = await ensureUrl(media);
        } catch (error) {
            console.error(error);
            if (state.activeMediaId !== mediaId) return;
            body.innerHTML = `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>Unable to load media</strong><span>${escapeHtml(name)}</span></div></div></div>`;
            return;
        }
        // The user may have closed this, or stepped on, meanwhile.
        if (state.activeMediaId !== mediaId) return;

        if (downloadLink) {
            downloadLink.href = url;
            downloadLink.download = name;
        }

        if (media.kind === "image" || media.kind === "sticker") {
            body.innerHTML = `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(name)}" decoding="async" draggable="false">`;
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
                            <strong>${escapeHtml(name)}</strong>
                            <span>${escapeHtml(documentNoteFor(media))}</span>
                        </div>
                    </div>
                    <a class="media-doc-link" href="${escapeAttribute(url)}" download="${escapeAttribute(name)}">Download file</a>
                </div>
            `;
        }
        body.querySelector("img, video, audio")?.addEventListener("error", () => {
            if (state.activeMediaId !== mediaId) return;
            body.innerHTML = `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-file-x"></i><div><strong>${escapeHtml(name)}</strong><span>This browser can't preview this file. Use the download button above.</span></div></div></div>`;
        }, { once: true });
    }

    /** Previous (-1) / next (+1) in the lightbox sequence. */
    function step(direction) {
        if (!sequence || !visible()) return;
        const index = sequence.indexOf(state.activeMediaId);
        const next = sequence[index + direction];
        if (index < 0 || !next) return;
        const previous = getMedia(state.activeMediaId);
        show(next);
        // Only now is it no longer the active one, so it can be released.
        if (previous) onClosed?.(previous);
    }

    function syncNav(modal, position) {
        const prev = modal.querySelector(".media-nav-prev");
        const next = modal.querySelector(".media-nav-next");
        if (!prev || !next) return;
        const on = position >= 0;
        prev.hidden = !on;
        next.hidden = !on;
        prev.disabled = !on || position === 0;
        next.disabled = !on || position === sequence.length - 1;
        // Disabling the focused button would drop focus to <body>.
        if (document.activeElement === prev && prev.disabled) next.focus({ preventScroll: true });
        if (document.activeElement === next && next.disabled) prev.focus({ preventScroll: true });
    }

    function focusInitial(modal) {
        const close = (ids.close && $(ids.close)) || modal.querySelector(".media-modal-actions button");
        close?.focus({ preventScroll: true });
    }

    /** Nav buttons, keys, swipe and the focus trap — added the first time it opens. */
    function bindOnce(modal) {
        if (bound) return;
        bound = true;
        const dialog = modal.querySelector(".media-modal-dialog");
        if (dialog && !dialog.hasAttribute("aria-label") && !dialog.hasAttribute("aria-labelledby")) {
            dialog.setAttribute("aria-label", "Media viewer");
        }
        const body = $(ids.body);
        if (dialog && body) {
            const nav = (cls, label, icon, direction) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `media-nav ${cls}`;
                button.setAttribute("aria-label", label);
                button.hidden = true;
                button.innerHTML = `<i class="ph-bold ${icon}" aria-hidden="true"></i>`;
                button.addEventListener("click", () => step(direction));
                return button;
            };
            const stage = document.createElement("div");
            stage.className = "media-stage";
            body.replaceWith(stage);
            stage.append(nav("media-nav-prev", "Previous", "ph-caret-left", -1), body, nav("media-nav-next", "Next", "ph-caret-right", 1));
        }

        modal.addEventListener("keydown", (event) => {
            if (event.key === "Tab") {
                trapFocus(modal, event);
                return;
            }
            if (!sequence || event.altKey || event.ctrlKey || event.metaKey) return;
            // Arrow keys seek inside a focused video or audio player.
            if (event.target?.matches?.("video, audio, input, select, textarea")) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const rtl = getComputedStyle(modal).direction === "rtl";
                step((event.key === "ArrowRight") !== rtl ? 1 : -1);
            } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const target = event.key === "Home" ? sequence[0] : sequence[sequence.length - 1];
                if (target !== state.activeMediaId) {
                    const previous = getMedia(state.activeMediaId);
                    show(target);
                    if (previous) onClosed?.(previous);
                }
            }
        });

        let touch = null;
        const stage = modal.querySelector(".media-stage") || body;
        stage?.addEventListener("touchstart", (event) => {
            touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY, t: Date.now() } : null;
        }, { passive: true });
        stage?.addEventListener("touchmove", (event) => {
            // A second finger means pinch-zoom, never a swipe.
            if (event.touches.length > 1) touch = null;
        }, { passive: true });
        stage?.addEventListener("touchend", (event) => {
            if (!touch || !sequence) return;
            const point = event.changedTouches[0];
            const dx = point.clientX - touch.x;
            const dy = point.clientY - touch.y;
            const quick = Date.now() - touch.t < 800;
            touch = null;
            if (quick && Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
        }, { passive: true });
    }

    /** Tab and Shift+Tab cycle through the dialog's controls and never leave it. */
    function trapFocus(modal, event) {
        const focusable = [...modal.querySelectorAll(FOCUSABLE)].filter((el) =>
            !el.hidden && !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
        event.preventDefault();
        if (!focusable.length) return;
        const index = focusable.indexOf(document.activeElement);
        const next = index < 0
            ? (event.shiftKey ? focusable.length - 1 : 0)
            : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        focusable[next].focus();
    }

    function close() {
        const modal = $(ids.modal);
        const body = $(ids.body);
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
                    onClosed?.(getMedia(closingMediaId));
                }
            }
        }, 120);
        state.activeMediaId = "";

        const target = (returnFocus && closingMediaId && returnFocus(closingMediaId)) || opener;
        sequence = null;
        captionFor = null;
        returnFocus = null;
        opener = null;
        const focusLost = modal.contains(document.activeElement) || !document.activeElement || document.activeElement === document.body;
        if (target?.isConnected && focusLost) target.focus({ preventScroll: true });
    }

    return { open, close, step, isOpen: visible };
}
