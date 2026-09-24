/**
 * ============================================================================
 * WhatsApp analytics drawer
 * ============================================================================
 * Thin binding of the shared stats panel to this viewer's element ids.
 * ============================================================================
 */
import { renderStatsPanel } from "../shared/stats-panel.js?v=1.7.3";
import { state } from "./state.js?v=1.7.3";

/** Repaints the totals, sender bars and emoji grid from `state`. */
export function generateStats() {
    renderStatsPanel({
        ids: { total: "stat-total", media: "stat-media", list: "stats-list", grid: "emoji-grid" },
        stats: {
            messageCount: state.messageOnlyCount,
            mediaCount: state.mediaCount,
            senderStats: state.senderStats,
            emojiStats: state.emojiStats
        },
        noun: "chat"
    });
}
