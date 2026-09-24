/**
 * ============================================================================
 * WhatsApp viewer chrome
 * ============================================================================
 * The bits of UI that aren't the message list: toast, drawers, sidebar,
 * header menu, the loading overlay, the viewport empty state, the
 * confirmation sheet and the upload panel. No parsing, no chat data —
 * these read `state` only for counts and flags.
 * ============================================================================
 */
import { $, q, escapeHtml, replayClass } from "../shared/dom.js?v=1.7.1";
import { pushOverlayState } from "../shared/history.js?v=1.7.1";
import { createToast } from "../shared/toast.js?v=1.7.1";
import { animateStatsIn } from "../shared/stats-panel.js?v=1.7.1";
import { state } from "./state.js?v=1.7.1";

export const showToast = createToast("toast");

/** The sidebar collapses into an overlay at this width (matches the CSS). */
export const MOBILE_BREAKPOINT = 800;
export const isMobileLayout = () => window.innerWidth <= MOBILE_BREAKPOINT;

// ── Drawers ─────────────────────────────────────────────────────────────────

export function openDrawer(id) {
    $(`${id}-drawer`)?.classList.add("open");
    pushOverlayState(`drawer-${id}`);
    if (id === "stats") {
        animateStatsIn(
            [["stat-total", state.messageOnlyCount], ["stat-media", state.mediaCount]],
            "#stats-list .progress-val"
        );
    }
}

export function closeDrawer(id) {
    $(`${id}-drawer`)?.classList.remove("open");
}

export function closeAllDrawers() {
    document.querySelectorAll(".drawer.open").forEach((drawer) => drawer.classList.remove("open"));
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

export function setSidebarState(isOpen) {
    $("sidebar")?.classList.toggle("active", isOpen);
    $("sidebar-backdrop")?.classList.toggle("active", isOpen);
}

export function toggleSidebar() {
    const sidebar = $("sidebar");
    if (!sidebar) return;
    setSidebarState(!sidebar.classList.contains("active"));
}

/** Tapping the open chat in the sidebar just closes the sidebar on phones. */
export function handleChatSelect() {
    if (isMobileLayout()) {
        setSidebarState(false);
    }
}

/** Swaps the sidebar between the import form and the open-chat list. */
export function setUploadPanelVisible(show) {
    const hasChat = state.messageOnlyCount > 0;
    $("upload-panel")?.classList.toggle("hidden", !show);
    $("chat-list-panel")?.classList.toggle("hidden", show || !hasChat);
    const back = $("upload-back");
    if (back) back.hidden = !(show && hasChat);
}

// ── Header menu ─────────────────────────────────────────────────────────────

export function toggleMenu(forceOpen) {
    const menu = $("header-menu");
    if (!menu) return;
    const willOpen = typeof forceOpen === "boolean" ? forceOpen : !menu.classList.contains("show");
    menu.classList.toggle("show", willOpen);
    $("menu-toggle")?.setAttribute("aria-expanded", String(willOpen));
}

export function closeMenu() {
    $("header-menu")?.classList.remove("show");
    $("menu-toggle")?.setAttribute("aria-expanded", "false");
}

/** Clicking anywhere outside the open header menu closes it. */
export function handleDocumentClick(event) {
    const menu = $("header-menu");
    const menuToggle = $("menu-toggle");
    if (menu?.classList.contains("show") && !menu.contains(event.target) && !menuToggle?.contains(event.target)) {
        closeMenu();
    }
}

// ── Loading overlay ─────────────────────────────────────────────────────────

export function setLoadingState(isLoading, title = "Loading chat", copy = "Parsing your export locally. This can take a moment for large ZIP files.") {
    state.isLoading = isLoading;

    const overlay = $("processing-overlay");
    const titleEl = $("processing-title");
    const copyEl = $("processing-copy");

    if (titleEl) {
        titleEl.innerText = title;
    }
    if (copyEl) {
        copyEl.innerText = copy;
    }

    $("load-chat")?.toggleAttribute("disabled", isLoading);
    $("drop-target")?.toggleAttribute("disabled", isLoading);
    $("display-name")?.toggleAttribute("disabled", isLoading);
    $("file-input")?.toggleAttribute("disabled", isLoading);

    // While parsing, stand a shimmering placeholder where the chat entry lands.
    const skeleton = $("chat-list-skeleton");
    if (skeleton) {
        const showSkeleton = isLoading && $("chat-list-panel")?.classList.contains("hidden");
        skeleton.classList.toggle("hidden", !showSkeleton);
    }

    if (!overlay) return;

    if (isLoading) {
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add("open"));
        return;
    }

    overlay.classList.remove("open");
    window.setTimeout(() => {
        if (!overlay.classList.contains("open")) {
            overlay.hidden = true;
        }
    }, 260);
}

/** Updates the progress line under the loading title ("Parsing… 42%"). */
export function updateLoadingCopy(copy) {
    const copyEl = $("processing-copy");
    if (copyEl) {
        copyEl.innerText = copy;
    }
}

/**
 * One-shot fade for the conversation the first time it paints. The message list
 * is virtualised and re-renders on every scroll, so per-message animation would
 * re-fire constantly — this animates the container instead and then gets out of
 * the way.
 */
export function playChatRevealOnce() {
    const viewport = $("viewport");
    if (!viewport) return;
    replayClass([viewport, q(".chat-header .header-profile")], "chat-revealed");
}

// ── Viewport empty state ────────────────────────────────────────────────────

let pristineEmptyStateHtml = null;

/** Remembers the markup shipped in the HTML so a state swap can be undone. */
function rememberEmptyState() {
    const emptyEl = $("empty-state");
    if (emptyEl && pristineEmptyStateHtml === null) {
        pristineEmptyStateHtml = emptyEl.innerHTML;
    }
    return emptyEl;
}

export function restoreEmptyState() {
    const emptyEl = rememberEmptyState();
    if (emptyEl && pristineEmptyStateHtml !== null) {
        emptyEl.innerHTML = pristineEmptyStateHtml;
    }
}

/**
 * Replaces the viewport placeholder with a titled state.
 * `actions` is trusted markup built by the caller, never user input.
 */
export function showEmptyState({ icon, iconColor, title, body, actions = "" }) {
    const emptyEl = rememberEmptyState();
    if (!emptyEl) return false;

    emptyEl.innerHTML = `
        <div class="illustration"><i class="${icon}"${iconColor ? ` style="color:${iconColor}"` : ""}></i></div>
        <h2>${escapeHtml(title)}</h2>
        <p style="max-width:340px">${escapeHtml(body)}</p>
        ${actions}`;
    emptyEl.classList.remove("hidden");
    return true;
}

// ── Confirmation sheet ──────────────────────────────────────────────────────
// Native confirm() blocks the page and looks nothing like the app, so this
// reuses the date-sheet styling instead.

let confirmSheetResolver = null;

/** Resolves true when the user confirms, false on cancel / Back / Escape. */
export function askConfirm({ title, body, confirmLabel = "Delete" }) {
    const sheet = $("confirm-sheet");
    if (!sheet) return Promise.resolve(false);

    resolveConfirmSheet(false);
    const titleEl = $("confirm-sheet-title");
    const bodyEl = $("confirm-sheet-body");
    const applyEl = $("confirm-sheet-apply");
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (applyEl) applyEl.textContent = confirmLabel;

    sheet.hidden = false;
    requestAnimationFrame(() => {
        sheet.classList.add("open");
        $("confirm-sheet-cancel")?.focus({ preventScroll: true });
    });
    pushOverlayState("confirm");

    return new Promise((resolve) => {
        confirmSheetResolver = resolve;
    });
}

export function resolveConfirmSheet(result, { fromHistory = false } = {}) {
    const sheet = $("confirm-sheet");
    if (!sheet || sheet.hidden || !sheet.classList.contains("open")) return;

    sheet.classList.remove("open");
    window.setTimeout(() => {
        if (!sheet.classList.contains("open")) sheet.hidden = true;
    }, 160);

    const resolve = confirmSheetResolver;
    confirmSheetResolver = null;
    resolve?.(result);

    if (!fromHistory && history.state && history.state.overlay === "confirm") history.back();
}

// ── Profile picture ─────────────────────────────────────────────────────────

/** Uses a locally picked image as the avatar in the header and profile drawer. */
export function handleProfilePictureChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (state.profileObjectUrl) {
        URL.revokeObjectURL(state.profileObjectUrl);
    }

    state.profileObjectUrl = URL.createObjectURL(file);
    if ($("my-pfp-img")) $("my-pfp-img").src = state.profileObjectUrl;
    if ($("drawer-pfp-img")) $("drawer-pfp-img").src = state.profileObjectUrl;
    if (q(".header-pfp")) q(".header-pfp").src = state.profileObjectUrl;
}
