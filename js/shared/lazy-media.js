/**
 * ============================================================================
 * Lazy media hydration
 * ============================================================================
 * Rendered media elements start with `data-lazy-media="<id>"` and no `src`.
 * An IntersectionObserver on the scroll viewport swaps the blob URL in when
 * the element comes within 800px of view, so a chat with thousands of photos
 * only decodes the ones near the reader.
 *
 *   const lazyMedia = createLazyMediaLoader({ rootId, getMedia, ensureUrl, onDetached });
 *   lazyMedia.hydrate();     // after every render
 *   lazyMedia.disconnect();  // before re-rendering or resetting
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "./dom.js?v=1.10.0";

/**
 * @param {Object}   options
 * @param {string}   options.rootId       Scroll container the observer watches.
 * @param {Function} options.getMedia     id → media record (or undefined).
 * @param {Function} options.ensureUrl    media → Promise<blob URL>.
 * @param {Function} [options.onDetached] Called with the media when the element
 *                                        left the DOM before its URL arrived,
 *                                        so the caller can release it again.
 * @param {Function} [options.nameFor]    media → name shown on the fallback card.
 */
export function createLazyMediaLoader({ rootId, getMedia, ensureUrl, onDetached, nameFor = (media) => media.name }) {
    let observer = null;

    async function loadElement(element) {
        const mediaId = element.dataset.lazyMedia || element.dataset.mediaId;
        const media = getMedia(mediaId);
        if (!media) return;

        element.removeAttribute("data-lazy-media");

        const markLoaded = () => {
            element.classList.add("loaded");
            media.hasLoaded = true;
        };

        let source = "";
        try {
            source = await ensureUrl(media);
        } catch (error) {
            console.error(error);
            if (element.isConnected) showUnavailable(element, media);
            return;
        }
        // The render window may have moved on while the entry was decoding.
        if (!element.isConnected) {
            onDetached?.(media);
            return;
        }

        element.addEventListener("error", () => showUnavailable(element, media), { once: true });

        if (element.tagName === "VIDEO") {
            element.src = source;
            element.load();
            // Not "loadeddata": with preload="metadata" it may never fire.
            element.addEventListener("loadedmetadata", () => {
                // Drop the play-icon placeholder that sits before the <video>.
                element.previousElementSibling?.remove();
                markLoaded();
            }, { once: true });
        } else if (element.tagName === "AUDIO") {
            element.src = source;
            element.load();
            element.addEventListener("loadedmetadata", () => {
                markLoaded();
                showVoiceNoteDuration(element);
            }, { once: true });
        } else {
            element.onload = markLoaded;
            element.src = source;
            if (element.complete && element.naturalWidth) {
                markLoaded();
            }
        }
    }

    /** Fills the "–:––" label on a voice-note card once the duration is known. */
    function showVoiceNoteDuration(audio) {
        const duration = audio.duration;
        if (!duration || !isFinite(duration)) return;
        const durationEl = audio.closest(".media-audio")?.querySelector(".voice-duration");
        if (!durationEl) return;
        const minutes = Math.floor(duration / 60);
        const seconds = String(Math.floor(duration % 60)).padStart(2, "0");
        durationEl.textContent = `${minutes}:${seconds}`;
    }

    /**
     * Swaps a preview the browser can't show (HEIC, an exotic codec, a damaged
     * entry) for a card with a download button. It used to shimmer forever.
     */
    function showUnavailable(element, media) {
        const host = element.closest(".media-button, .media-video, .media-audio");
        if (!host) return;
        const card = document.createElement("div");
        card.className = "media-doc";
        card.innerHTML = `
            <div class="media-doc-head"><i class="ph-fill ph-file-x"></i><div>
                <strong>${escapeHtml(nameFor(media))}</strong><span>Can't be previewed in this browser</span>
            </div></div>
            <div class="media-doc-actions"><button type="button" class="media-doc-link" data-download-media="${escapeAttribute(media.id)}">Download</button></div>`;
        host.replaceWith(card);
    }

    /** Observes every not-yet-loaded media element under the root. */
    function hydrate() {
        const root = $(rootId);
        if (!root) return;

        if (!("IntersectionObserver" in window)) {
            root.querySelectorAll("[data-lazy-media]").forEach(loadElement);
            return;
        }

        if (!observer) {
            observer = new IntersectionObserver((entries, activeObserver) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    loadElement(entry.target);
                    activeObserver.unobserve(entry.target);
                });
            }, {
                root,
                rootMargin: "800px 0px"
            });
        }

        root.querySelectorAll("[data-lazy-media]").forEach((element) => {
            observer.observe(element);
        });
    }

    function disconnect() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    return { hydrate, disconnect, loadElement };
}
