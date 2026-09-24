/**
 * ============================================================================
 * Full-screen media viewer
 * ============================================================================
 * Tap any attachment and it opens here with a download link. Images, videos
 * and audio render inline; anything else (a PDF, a .vcf, an unknown
 * extension) gets a document card with a download button — without that
 * branch the modal sat on its loading spinner forever.
 *
 * The factory binds to a page's element ids and to the viewer's state, which
 * must expose `activeMediaId` (also read by the blob-URL release logic).
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "./dom.js?v=1.7.0";
import { pushOverlayState } from "./history.js?v=1.7.0";

/**
 * @param {Object}   options
 * @param {Object}   options.state             Viewer state carrying `activeMediaId`.
 * @param {Object}   options.ids               { modal, body, subtitle, download }
 * @param {string}   options.overlayId         History entry name for Back handling.
 * @param {Function} options.getMedia          id → media record.
 * @param {Function} options.ensureUrl         media → Promise<blob URL>.
 * @param {Function} options.subtitleFor       media → header text.
 * @param {Function} options.documentNoteFor   media → secondary line on the document card.
 * @param {Function} [options.onClosed]        Called with the media that was open.
 */
export function createMediaModal({ state, ids, overlayId, getMedia, ensureUrl, subtitleFor, documentNoteFor, onClosed }) {
    async function open(mediaId) {
        const media = getMedia(mediaId);
        const modal = $(ids.modal);
        const body = $(ids.body);
        const subtitle = $(ids.subtitle);
        const downloadLink = $(ids.download);

        if (!modal || !body || !media) return;

        state.activeMediaId = mediaId;
        if (subtitle) subtitle.innerText = subtitleFor(media);
        body.innerHTML = `<div class="media-placeholder" aria-hidden="true"><i class="ph-fill ph-spinner-gap processing-spinner"></i></div>`;
        modal.hidden = false;
        requestAnimationFrame(() => modal.classList.add("open"));
        pushOverlayState(overlayId);

        let url = "";
        try {
            url = await ensureUrl(media);
        } catch (error) {
            console.error(error);
            body.innerHTML = `<div class="media-missing"><div class="media-missing-head"><i class="ph-fill ph-warning-circle"></i><div><strong>Unable to load media</strong><span>${escapeHtml(media.name)}</span></div></div></div>`;
            return;
        }
        // The user may have closed this and opened something else meanwhile.
        if (state.activeMediaId !== mediaId) return;

        if (downloadLink) {
            downloadLink.href = url;
            downloadLink.download = media.name;
        }

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
                            <span>${escapeHtml(documentNoteFor(media))}</span>
                        </div>
                    </div>
                    <a class="media-doc-link" href="${escapeAttribute(url)}" download="${escapeAttribute(media.name)}">Download file</a>
                </div>
            `;
        }
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
    }

    return { open, close };
}
