/**
 * ChatLume promos — the "Try my other projects" modal shown after a chat loads,
 * and the sponsor card shown shortly after the app itself loads.
 *
 * Both viewers previously carried a byte-identical 94-line copy of the modal,
 * so every edit had to be made twice and the two drifted easily. This is the
 * single source for both.
 *
 * Nothing here is ever fed user data — the copy is authored below — but the
 * project fields still go through `esc()` so the markup can't be broken by a
 * stray quote in a description.
 */

const PROJECT_MODAL_KEY = "chatlume-projects-modal-seen";
const SPONSOR_PROMPT_KEY = "chatlume-sponsor-prompt-seen";
const SPONSOR_URL = "https://github.com/sponsors/ParasSharma2306";

/** Shown after a chat loads. Ordered newest-first. */
const PROJECTS = [
    {
        name: "Squish",
        url: "https://squish.parassharma.in",
        blurb: "Convert, combine and compress images and PDFs — entirely in your browser.",
        tint: "rgba(56, 160, 255, 0.06)",
        border: "rgba(56, 160, 255, 0.2)"
    },
    {
        name: "Calcify",
        url: "https://calcify.parassharma.in",
        blurb: "A scientific calculator, solvable formula library and function grapher, offline.",
        tint: "rgba(245, 166, 35, 0.06)",
        border: "rgba(245, 166, 35, 0.22)"
    },
    {
        name: "Backdoor",
        url: "https://backdoor.parassharma.in",
        blurb: "Play Backdoor. A free game that runs in your browser.",
        tint: "rgba(0, 168, 132, 0.05)",
        border: "rgba(0, 168, 132, 0.15)"
    },
    {
        name: "Know me better",
        url: "https://parassharma.com",
        blurb: "at parassharma.com",
        tint: "rgba(0, 168, 132, 0.05)",
        border: "rgba(0, 168, 132, 0.15)"
    }
];

function esc(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function seen(key) {
    try {
        return Boolean(sessionStorage.getItem(key));
    } catch (error) {
        return false;
    }
}

function markSeen(key) {
    try {
        sessionStorage.setItem(key, "1");
    } catch (error) {
        /* storage blocked — the prompt simply reappears next navigation */
    }
}

/* ── Sponsor card ────────────────────────────────────────────────────────── */

/**
 * A dismissible card that slides in a few seconds after the app is usable.
 * Deliberately not a modal: the app has just opened and nothing has been done
 * yet, so this must never stand between the user and loading a chat.
 */
export function showSponsorPrompt({ delay = 4000 } = {}) {
    if (seen(SPONSOR_PROMPT_KEY)) return;
    if (document.querySelector(".sponsor-prompt")) return;

    const timer = window.setTimeout(() => {
        // A chat modal owns the screen; don't stack a second ask on top of it.
        if (document.getElementById("project-modal-backdrop")) return;

        const card = document.createElement("div");
        card.className = "sponsor-prompt";
        card.setAttribute("role", "complementary");
        card.setAttribute("aria-label", "Support ChatLume");
        card.innerHTML =
            '<div class="sponsor-prompt-icon" aria-hidden="true"><i class="ph-fill ph-heart"></i></div>' +
            '<div class="sponsor-prompt-text">' +
                "<strong>ChatLume is free, and stays free</strong>" +
                "<span>No ads, no accounts, no upsell. Sponsorship is what keeps it that way.</span>" +
            "</div>" +
            '<div class="sponsor-prompt-actions">' +
                '<button type="button" class="sponsor-prompt-no">Not now</button>' +
                '<a class="sponsor-prompt-yes" href="' + SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">Sponsor</a>' +
            "</div>";

        document.body.appendChild(card);
        requestAnimationFrame(() => card.classList.add("show"));

        const close = () => {
            card.classList.remove("show");
            window.setTimeout(() => card.remove(), 320);
            markSeen(SPONSOR_PROMPT_KEY);
        };

        card.querySelector(".sponsor-prompt-no").addEventListener("click", close);
        card.querySelector(".sponsor-prompt-yes").addEventListener("click", close);
    }, delay);

    // Loading a chat replaces this ask with the projects modal.
    window.addEventListener("chatlume:chat-loaded", () => window.clearTimeout(timer), { once: true });
}

/* ── Projects modal ──────────────────────────────────────────────────────── */

function projectCard(project) {
    return '<a href="' + esc(project.url) + '" target="_blank" rel="noopener noreferrer" ' +
        'style="display: block; background: ' + esc(project.tint) + '; border: 1px solid ' + esc(project.border) + '; ' +
        'border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; text-decoration: none;">' +
        '<h3 style="font-size: 15px; font-weight: 600; color: var(--text-primary, #e9edef); margin: 0 0 4px 0; ' +
        'display: flex; align-items: center; gap: 6px;">' + esc(project.name) +
        ' <i class="ph-bold ph-arrow-up-right" style="font-size:12px"></i></h3>' +
        '<p style="font-size: 12.5px; color: var(--text-secondary, #8696a0); margin: 0; line-height: 1.45;">' +
        esc(project.blurb) + "</p></a>";
}

/** Shown once per session, shortly after a chat finishes loading. */
export function showProjectModal() {
    if (document.getElementById("project-modal-backdrop")) return;

    // Loading a second chat in the same session shouldn't re-prompt.
    if (seen(PROJECT_MODAL_KEY)) return;

    // Tell the sponsor card to stand down — one ask per session is plenty.
    window.dispatchEvent(new Event("chatlume:chat-loaded"));
    document.querySelector(".sponsor-prompt")?.remove();

    const modalHtml =
    '<div class="project-modal-backdrop" id="project-modal-backdrop" role="dialog" aria-modal="true" aria-label="More from the developer" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s ease;">' +
        '<div class="project-modal" style="background: var(--bg-sidebar, #111b21); border: 1px solid var(--border, #2a3942); border-radius: 20px; width: 90%; max-width: 400px; max-height: 86vh; overflow-y: auto; padding: 24px; position: relative; transform: translateY(20px); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);">' +
            '<button class="project-modal-close" id="project-modal-close" type="button" aria-label="Close" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--text-secondary, #8696a0); cursor: pointer; padding: 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">' +
                '<i class="ph ph-x"></i>' +
            "</button>" +
            '<div class="project-modal-content">' +
                '<h2 style="font-size: 20px; font-weight: 700; color: var(--primary, #00a884); margin-bottom: 4px; margin-top: 0; text-align: center;">Try my other projects</h2>' +
                '<p style="font-size: 12.5px; color: var(--text-secondary, #8696a0); text-align: center; margin: 0 0 16px;">All free, all private, all in your browser.</p>' +
                PROJECTS.map(projectCard).join("") +
            "</div>" +
            '<div class="project-modal-actions" style="margin-top: 16px; text-align: center;">' +
                '<button class="btn-secondary" id="project-dismiss" type="button" style="width: 100%;">Dismiss</button>' +
            "</div>" +
        "</div>" +
    "</div>";

    document.body.insertAdjacentHTML("beforeend", modalHtml);

    const backdrop = document.getElementById("project-modal-backdrop");
    const modal = backdrop.querySelector(".project-modal");
    const closeBtn = document.getElementById("project-modal-close");
    const dismissBtn = document.getElementById("project-dismiss");
    const previouslyFocused = document.activeElement;

    // The backdrop is inserted transparent but full-screen. Without
    // pointer-events:none it silently swallowed every click for the 1.5s
    // before the reveal — the app looked frozen right after a chat loaded.
    const revealTimer = window.setTimeout(() => {
        backdrop.style.opacity = "1";
        backdrop.style.pointerEvents = "auto";
        modal.style.transform = "translateY(0)";
        dismissBtn.focus({ preventScroll: true });
    }, 1500);

    let closed = false;
    const closeModal = () => {
        if (closed) return;
        closed = true;
        window.clearTimeout(revealTimer);
        backdrop.style.opacity = "0";
        backdrop.style.pointerEvents = "none";
        modal.style.transform = "translateY(20px)";
        document.removeEventListener("keydown", onKeydown, true);
        window.setTimeout(() => backdrop.remove(), 300);
        markSeen(PROJECT_MODAL_KEY);
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
            previouslyFocused.focus({ preventScroll: true });
        }
    };

    function onKeydown(event) {
        if (event.key !== "Escape") return;
        // Only claim Escape once the dialog is actually interactive.
        if (backdrop.style.pointerEvents !== "auto") return;
        event.stopPropagation();
        closeModal();
    }
    document.addEventListener("keydown", onKeydown, true);

    closeBtn.onclick = closeModal;
    dismissBtn.onclick = closeModal;
    backdrop.onclick = (event) => {
        if (event.target === backdrop) closeModal();
    };
}
