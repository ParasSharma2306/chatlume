/**
 * ChatLume sponsorship appeal.
 *
 * This is the app's only promotional surface. It replaces the old
 * `js/promos.js`, which additionally shoved a modal listing the developer's
 * other projects in front of the chat the moment it finished loading. Cross-
 * promoting unrelated apps inside a privacy tool cost more goodwill than it
 * earned, so the modal is gone and this is what is left: one card, one ask.
 *
 * Timing matters as much as the copy. The old sponsor card appeared four
 * seconds after the app booted — before the user had opened anything, so the
 * ask arrived with nothing behind it. It now waits until a chat has actually
 * rendered, which is the first moment the tool has been useful.
 *
 * Nothing here is ever fed user data; the copy is authored below.
 */

import { readStored, writeStored } from "./shared/safe-storage.js?v=1.7.2";

const SNOOZE_KEY = "chatlume-sponsor-snooze-until";
const SPONSOR_URL = "https://github.com/sponsors/ParasSharma2306";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Not now" is a real answer — don't ask again this month. */
const SNOOZE_DISMISSED_DAYS = 30;
/** Someone who opened the sponsor page shouldn't be asked again for a long while. */
const SNOOZE_SPONSORED_DAYS = 365;

function isSnoozed() {
    const until = parseInt(readStored(SNOOZE_KEY) || "0", 10);
    return Number.isFinite(until) && Date.now() < until;
}

function snooze(days) {
    writeStored(SNOOZE_KEY, String(Date.now() + days * DAY_MS));
}

/**
 * Shows the sponsorship card. Call it once a chat has finished rendering.
 *
 * Non-blocking by construction: a card in the corner, never a modal over the
 * conversation the user just opened.
 */
export function showSponsorPrompt({ delay = 2500 } = {}) {
    if (isSnoozed()) return;
    if (document.querySelector(".sponsor-prompt")) return;

    window.setTimeout(() => {
        // site.js may be offering the PWA install card from the same corner.
        // Two asks stacked on top of each other is one ask too many; the
        // install card is the more useful of the pair, so yield to it.
        if (document.querySelector(".install-prompt")) return;
        // Same goes for the "saving to this device" progress card.
        if (document.querySelector(".persist-card:not([hidden])")) return;
        if (isSnoozed()) return;

        const card = document.createElement("div");
        card.className = "sponsor-prompt";
        card.setAttribute("role", "complementary");
        card.setAttribute("aria-label", "Support ChatLume");
        card.innerHTML =
            '<div class="sponsor-prompt-icon" aria-hidden="true"><i class="ph-fill ph-heart"></i></div>' +
            '<div class="sponsor-prompt-text">' +
                "<strong>ChatLume is free, and stays free</strong>" +
                "<span>No ads, no accounts, nothing to upgrade to. Sponsors cover the hosting.</span>" +
            "</div>" +
            '<div class="sponsor-prompt-actions">' +
                '<button type="button" class="sponsor-prompt-no">Not now</button>' +
                '<a class="sponsor-prompt-yes" href="' + SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">' +
                    '<i class="ph-fill ph-heart" aria-hidden="true"></i> Sponsor</a>' +
            "</div>";

        document.body.appendChild(card);
        requestAnimationFrame(() => card.classList.add("show"));

        const close = (days) => {
            card.classList.remove("show");
            window.setTimeout(() => card.remove(), 320);
            snooze(days);
        };

        card.querySelector(".sponsor-prompt-no").addEventListener("click", () => close(SNOOZE_DISMISSED_DAYS));
        card.querySelector(".sponsor-prompt-yes").addEventListener("click", () => close(SNOOZE_SPONSORED_DAYS));
    }, delay);
}
