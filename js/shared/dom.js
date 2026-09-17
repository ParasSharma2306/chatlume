/**
 * ============================================================================
 * DOM helpers
 * ============================================================================
 * Tiny, dependency-free helpers shared by every viewer module: element
 * lookup, HTML escaping for template strings, and a couple of predicates
 * about the current page state. Nothing here knows about chats.
 * ============================================================================
 */

/** `document.getElementById`, shortened because it is called everywhere. */
export const $ = (id) => document.getElementById(id);

/** `querySelector` with an optional root, for the few non-id lookups. */
export const q = (selector, root = document) => root.querySelector(selector);

/** Escapes text for interpolation into an HTML template string. */
export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Like escapeHtml, but also neutralises backticks for attribute values. */
export function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
}

/** Escapes a string so it can be embedded literally inside a RegExp. */
export function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the element exists and is not `hidden`. Overlay checks need both
 * halves: `!el?.hidden` was true when the element was simply absent.
 */
export function isVisible(element) {
    return Boolean(element) && !element.hidden;
}

/** Whether a keyboard event originated inside a text-entry control. */
export function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

/** Honour the OS "reduce motion" preference before animating anything. */
export const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Resolves on the next animation frame — lets a class change paint first. */
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Resolves after `ms` — used to hand the main thread back during long parses. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Removes and re-adds a class on the next frame so a CSS transition re-runs.
 * Used for the one-shot "chat revealed" fade on the viewport and header.
 */
export function replayClass(elements, className) {
    const targets = elements.filter(Boolean);
    targets.forEach((el) => el.classList.remove(className));
    requestAnimationFrame(() => targets.forEach((el) => el.classList.add(className)));
}
