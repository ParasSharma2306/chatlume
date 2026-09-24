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
import { $ } from "./dom.js?v=1.7.3";

/**
 * @param {Object}   options
 * @param {string}   options.rootId       Scroll container the observer watches.
 * @param {Function} options.getMedia     id → media record (or undefined).
 * @param {Function} options.ensureUrl    media → Promise<blob URL>.
 * @param {Function} [options.onDetached] Called with the media when the element
 *                                        left the DOM before its URL arrived,
 *                                        so the caller can release it again.
 */
export function createLazyMediaLoader({ rootId, getMedia, ensureUrl, onDetached }) {
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
            return;
        }
        // The render window may have moved on while the entry was decoding.
        if (!element.isConnected) {
            onDetached?.(media);
            return;
        }

        if (element.tagName === "VIDEO") {
            element.src = source;
            element.load();
            element.addEventListener("loadeddata", () => {
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
            if (element.complete) {
                markLoaded();
            }
        }
    }

    /** Fills the "–:––" label on a voice-note card once the duration is known. */
    function showVoiceNoteDuration(audio) {
        const duration = audio.duration;
        if (!duration || !isFinite(duration)) return;
        const durationEl = document.querySelector(`.voice-duration[data-media-id="${audio.dataset.mediaId}"]`);
        if (!durationEl) return;
        const minutes = Math.floor(duration / 60);
        const seconds = String(Math.floor(duration % 60)).padStart(2, "0");
        durationEl.textContent = `${minutes}:${seconds}`;
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
