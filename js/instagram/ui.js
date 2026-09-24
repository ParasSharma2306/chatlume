/**
 * ============================================================================
 * Instagram viewer chrome
 * ============================================================================
 * Toast, loading overlay, sidebar, header menu, drawers, the viewport error
 * state and the analytics drawer binding. Nothing here parses or renders
 * messages.
 * ============================================================================
 */
import { $, escapeHtml } from "../shared/dom.js?v=1.7.2";
import { pushOverlayState, popOverlayState } from "../shared/history.js?v=1.7.2";
import { animateStatsIn, renderStatsPanel } from "../shared/stats-panel.js?v=1.7.2";
import { createToast } from "../shared/toast.js?v=1.7.2";
import { igState } from "./state.js?v=1.7.2";

export const showToast = createToast("ig-toast");

/** The sidebar collapses into an overlay at this width (matches the CSS). */
export const isMobileLayout = () => window.innerWidth <= 800;

// ── Loading overlay ─────────────────────────────────────────────────────────

export function setLoading(on, title = "Loading", copy = "Please wait...") {
    igState.isLoading = on;
    const overlay = $("ig-processing-overlay");
    const titleEl = $("ig-processing-title");
    if (titleEl) titleEl.innerText = title;
    const copyEl = $("ig-processing-copy");
    if (copyEl) copyEl.innerText = copy;
    $("ig-load-btn")?.toggleAttribute("disabled", on);
    $("ig-drop-target")?.toggleAttribute("disabled", on);
    $("ig-my-name")?.toggleAttribute("disabled", on);
    $("ig-file-input")?.toggleAttribute("disabled", on);
    if (!overlay) return;
    if (on) {
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add("open"));
        return;
    }
    overlay.classList.remove("open");
    // Matches the 0.22s fade added to .processing-overlay.
    setTimeout(() => { if (!overlay.classList.contains("open")) overlay.hidden = true; }, 260);
}

/** Lets the overlay paint before a heavy step starts. */
export function yieldToPaint() {
    return new Promise((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 30)); });
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

export function setSidebarState(open) {
    $("ig-sidebar")?.classList.toggle("active", open);
    $("ig-sidebar-backdrop")?.classList.toggle("active", open);
}

export function toggleSidebar() {
    setSidebarState(!$("ig-sidebar")?.classList.contains("active"));
}

// ── Header menu ─────────────────────────────────────────────────────────────

export function toggleMenu(forceOpen) {
    const menu = $("ig-header-menu");
    if (!menu) return;
    const willOpen = typeof forceOpen === "boolean" ? forceOpen : !menu.classList.contains("show");
    menu.classList.toggle("show", willOpen);
    $("ig-menu-toggle")?.setAttribute("aria-expanded", String(willOpen));
}

export function closeMenu() {
    $("ig-header-menu")?.classList.remove("show");
    $("ig-menu-toggle")?.setAttribute("aria-expanded", "false");
}

/** Clicking anywhere outside the open header menu closes it. */
export function handleDocumentClick(event) {
    const menu = $("ig-header-menu");
    if (menu?.classList.contains("show") && !menu.contains(event.target) && !$("ig-menu-toggle")?.contains(event.target)) {
        closeMenu();
    }
}

// ── Drawers ─────────────────────────────────────────────────────────────────

export function openDrawer(id) {
    $(`${id}-drawer`)?.classList.add("open");
    pushOverlayState(`drawer-${id}`);
    if (id === "ig-stats") {
        animateStatsIn(
            [["ig-stat-total", igState.messageOnlyCount], ["ig-stat-media", igState.mediaCount]],
            "#ig-stats-list .progress-val"
        );
    }
}

export function closeDrawer(id) {
    $(`${id}-drawer`)?.classList.remove("open");
}

/** Closes a drawer from a user gesture, popping the entry openDrawer pushed. */
export function dismissDrawer(id) {
    closeDrawer(id);
    popOverlayState();
}

export function closeAllDrawers() {
    document.querySelectorAll(".drawer.open").forEach((drawer) => drawer.classList.remove("open"));
}

// ── Stats ───────────────────────────────────────────────────────────────────

/** Repaints the analytics drawer from `igState`. */
export function generateStats() {
    renderStatsPanel({
        ids: { total: "ig-stat-total", media: "ig-stat-media", list: "ig-stats-list", grid: "ig-emoji-grid" },
        stats: {
            messageCount: igState.messageOnlyCount,
            mediaCount: igState.mediaCount,
            senderStats: igState.senderStats,
            emojiStats: igState.emojiStats
        },
        noun: "conversation"
    });
}

// ── Viewport states ─────────────────────────────────────────────────────────

/** "Couldn't load / parse this file" with a link to the export guide. */
export function showErrorState(title, message) {
    const emptyEl = $("ig-empty-state");
    if (!emptyEl) {
        showToast(message, "error");
        return;
    }
    emptyEl.innerHTML = `
        <div class="illustration"><i class="ph-duotone ph-warning-circle" style="color:#f5a623"></i></div>
        <h2 style="color:var(--text-primary)">${escapeHtml(title)}</h2>
        <p style="max-width:300px">${escapeHtml(message)}</p>
        <a href="how-to-export-instagram.html" style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:13px;color:#C13584;text-decoration:none">
          <i class="ph ph-question"></i> How to export Instagram DMs
        </a>`;
    emptyEl.classList.remove("hidden");
}

/**
 * The thread parsed but held nothing readable. `onPickAnother` (optional)
 * adds a button back to the conversation list.
 */
export function showEmptyThreadState(onPickAnother) {
    const emptyEl = $("ig-empty-state");
    if (!emptyEl) return;
    emptyEl.innerHTML = `
        <div class="illustration"><i class="ph-duotone ph-file-dashed" style="color:#f5a623"></i></div>
        <h2>This conversation is empty</h2>
        <p style="max-width:340px">The thread parsed fine but contained no readable messages. Instagram sometimes ships placeholder folders for conversations you deleted.</p>
        ${onPickAnother ? `<button type="button" class="empty-cta" id="ig-back-to-threads"><i class="ph ph-arrow-left"></i> Pick another conversation</button>` : ""}`;
    emptyEl.classList.remove("hidden");
    if (onPickAnother) $("ig-back-to-threads")?.addEventListener("click", onPickAnother);
}
