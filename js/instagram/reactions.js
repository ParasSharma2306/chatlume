/**
 * ============================================================================
 * Who reacted
 * ============================================================================
 * Tapping (or pressing Enter / Space on) a reaction pill under a bubble opens
 * a small popover listing who reacted with that emoji; the "+N" pill lists
 * every reaction on the message. It is a plain button → dialog pattern, so it
 * works the same with touch, mouse and keyboard and never needs a long-press
 * (the gallery's long-press menu lives in its own panel and is unaffected).
 *
 * Escape, the close button, a tap outside, scrolling the chat, re-rendering
 * the list or switching Anonymize closes it; focus returns to the pill.
 * Names go through Anonymize like everywhere else.
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.10.1";
import { describeReactionGroup, groupReactions } from "../shared/reactions.js?v=1.10.1";
import { initialsFor } from "../shared/text.js?v=1.10.1";
import { igState } from "./state.js?v=1.10.1";
import { display } from "./anonymize.js?v=1.10.1";

let popover = null;
let anchor = null;

const isOpen = () => Boolean(popover && !popover.hidden);
export const isReactionPopoverOpen = isOpen;

function ensurePopover() {
    if (popover) return popover;
    popover = document.createElement("div");
    popover.className = "reaction-popover";
    popover.id = "ig-reaction-popover";
    popover.setAttribute("role", "dialog");
    popover.hidden = true;
    popover.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeReactionPopover({ restoreFocus: true });
        } else if (event.key === "Tab") {
            // One control inside; leaving it means leaving the popover.
            event.preventDefault();
            closeReactionPopover({ restoreFocus: true });
        }
    });
    popover.addEventListener("click", (event) => {
        if (event.target.closest("[data-reaction-close]")) closeReactionPopover({ restoreFocus: true });
    });
    document.body.appendChild(popover);
    return popover;
}

/**
 * Message-list click handler. Returns true when the click was on a pill.
 */
export function handleReactionClick(event) {
    const pill = event.target.closest(".ig-reaction");
    if (!pill) return false;
    event.preventDefault();
    if (isOpen() && anchor === pill) {
        closeReactionPopover({ restoreFocus: true });
        return true;
    }
    openFor(pill);
    return true;
}

function openFor(pill) {
    const row = pill.closest("[data-reactions-for]");
    const message = row && igState.filteredMessages.find((item) => item.id === row.dataset.reactionsFor);
    if (!message) return;
    const groups = groupReactions(message.reactions, display.name);
    const which = pill.dataset.reactionGroup;
    const shown = which === "all" ? groups : [groups[Number(which)]].filter(Boolean);
    if (!shown.length) return;

    closeReactionPopover({ restoreFocus: false });
    const panel = ensurePopover();
    const total = shown.reduce((sum, group) => sum + group.count, 0);
    const title = which === "all"
        ? `${total} ${total === 1 ? "reaction" : "reactions"}`
        : `${shown[0].emoji} ${shown[0].count}`;
    panel.setAttribute("aria-label", which === "all" ? `All reactions, ${title}` : describeReactionGroup(shown[0]));
    panel.innerHTML = `
        <div class="reaction-popover-head">
            <strong>${escapeHtml(title)}</strong>
            <button type="button" class="reaction-popover-close" data-reaction-close aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
        </div>
        <ul class="reaction-popover-list">${shown.map((group) => group.actors.map((actor) => `
            <li><span class="reaction-popover-avatar" aria-hidden="true">${escapeHtml(initialsFor(actor))}</span><bdi class="reaction-popover-name">${escapeHtml(actor)}</bdi><span class="reaction-popover-emoji" aria-label="reacted ${escapeAttribute(group.emoji)}">${escapeHtml(group.emoji)}</span></li>`).join("")).join("")}
        </ul>`;
    panel.hidden = false;
    anchor = pill;
    pill.setAttribute("aria-expanded", "true");
    pill.classList.add("is-open");
    position(panel, pill);
    panel.querySelector(".reaction-popover-close")?.focus({ preventScroll: true });

    // Next tick, so the tap that opened it doesn't close it.
    window.setTimeout(() => {
        if (!isOpen()) return;
        document.addEventListener("pointerdown", onOutside, true);
        $("ig-viewport")?.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
    }, 0);
}

/** Below the pill if it fits, else above; always inside the window. */
function position(panel, pill) {
    const margin = 8;
    const rect = pill.getBoundingClientRect();
    panel.style.left = "0px";
    panel.style.top = "0px";
    // Layout size, not getBoundingClientRect(): the scale-in animation makes
    // the box read small on the first frame, which let it overflow the edge.
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const rtl = getComputedStyle(pill).direction === "rtl";
    let left = rtl ? rect.right - width : rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
}

function onOutside(event) {
    if (popover?.contains(event.target) || anchor?.contains(event.target)) return;
    closeReactionPopover({ restoreFocus: false });
}

function onScroll() {
    closeReactionPopover({ restoreFocus: false });
}

export function closeReactionPopover({ restoreFocus = false } = {}) {
    if (!isOpen()) return;
    const hadFocus = popover.contains(document.activeElement);
    popover.hidden = true;
    popover.innerHTML = "";
    document.removeEventListener("pointerdown", onOutside, true);
    $("ig-viewport")?.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    const pill = anchor;
    anchor = null;
    if (!pill) return;
    pill.setAttribute("aria-expanded", "false");
    pill.classList.remove("is-open");
    if ((restoreFocus || hadFocus) && pill.isConnected) pill.focus({ preventScroll: true });
}

