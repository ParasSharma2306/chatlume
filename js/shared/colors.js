/**
 * ============================================================================
 * Sender colours
 * ============================================================================
 * Each participant gets a stable colour for their name label, chosen by
 * hashing the name so the same person looks the same on every load.
 * ============================================================================
 */

export const SENDER_COLORS = ["#e542a3", "#1f7aec", "#d44638", "#2ecc71", "#f39c12", "#9b59b6", "#3498db", "#1abc9c"];

/**
 * Colour for `name`, memoised in `colorMap` (a plain object owned by the
 * viewer state so it resets with each chat).
 */
export function colorForName(name, colorMap) {
    if (!colorMap[name]) {
        let hash = 0;
        for (let index = 0; index < name.length; index += 1) {
            hash = name.charCodeAt(index) + ((hash << 5) - hash);
        }
        colorMap[name] = SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
    }
    return colorMap[name];
}
