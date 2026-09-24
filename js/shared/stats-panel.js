/**
 * ============================================================================
 * Analytics drawer
 * ============================================================================
 * Message / media totals, per-sender share bars and the top-12 emoji grid.
 * The markup is the same on both viewers; only element ids and the noun in
 * the empty-state copy ("chat" vs "conversation") differ.
 * ============================================================================
 */
import { $, escapeHtml, prefersReducedMotion } from "./dom.js?v=1.7.2";

/**
 * @param {Object} options
 * @param {Object} options.ids     { total, media, list, grid }
 * @param {Object} options.stats   { messageCount, mediaCount, senderStats, emojiStats }
 * @param {string} [options.noun]  "chat" or "conversation" for the empty copy.
 */
export function renderStatsPanel({ ids, stats, noun = "chat" }) {
    const { messageCount, mediaCount, senderStats, emojiStats } = stats;

    const totalEl = $(ids.total);
    if (totalEl) totalEl.innerText = messageCount.toLocaleString();
    const mediaEl = $(ids.media);
    if (mediaEl) mediaEl.innerText = mediaCount.toLocaleString();

    const list = $(ids.list);
    if (list && !messageCount) {
        list.innerHTML = `
            <div class="drawer-empty">
                <i class="ph-duotone ph-chart-bar" aria-hidden="true"></i>
                <p>Load a ${noun} and this fills up with who talks most, when, and how often.</p>
            </div>`;
    } else if (list) {
        const sorted = Object.entries(senderStats).sort((a, b) => b[1] - a[1]);
        list.innerHTML = sorted.map(([name, count]) => {
            const pct = messageCount ? ((count / messageCount) * 100).toFixed(1) : "0.0";
            return `
                <div class="stat-row">
                    <div class="stat-header">
                        <span class="stat-name">${escapeHtml(name)}</span>
                        <span class="stat-pct">${pct}% (${count})</span>
                    </div>
                    <div class="progress-bg">
                        <div class="progress-val" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        }).join("");
    }

    const grid = $(ids.grid);
    if (grid) {
        const top12 = Object.entries(emojiStats).sort((a, b) => b[1] - a[1]).slice(0, 12);

        if (top12.length === 0) {
            grid.innerHTML = `
                <div class="drawer-empty" style="grid-column:1/-1">
                    <i class="ph-duotone ph-smiley-blank" aria-hidden="true"></i>
                    <p>${messageCount ? `No emojis in this ${noun} — a rare breed.` : `Emoji highlights appear once a ${noun} is loaded.`}</p>
                </div>`;
        } else {
            grid.innerHTML = top12.map(([emoji, count]) => `
                <div class="emoji-item">
                    <span class="emoji-char">${emoji}</span>
                    <span class="emoji-count">${count.toLocaleString()}</span>
                </div>
            `).join("");
        }
    }
}

/**
 * Counts the stat tiles up and grows the per-sender bars from zero when the
 * drawer opens. Skipped entirely under "reduce motion".
 *
 * @param {Array<[string, number]>} tiles         [elementId, targetValue] pairs.
 * @param {string}                  barsSelector  The `.progress-val` bars to grow.
 */
export function animateStatsIn(tiles, barsSelector) {
    const reduce = prefersReducedMotion();

    tiles.forEach(([id, target]) => {
        const el = $(id);
        if (!el) return;
        if (reduce || !target) {
            el.innerText = Number(target || 0).toLocaleString();
            return;
        }
        countUp(el, target, 750);
    });

    if (reduce) return;
    document.querySelectorAll(barsSelector).forEach((bar) => {
        const width = bar.style.width;
        bar.style.width = "0%";
        requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = width; }));
    });
}

/** Animates a number from 0 to `target` over `duration` ms. */
export function countUp(el, target, duration) {
    const start = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // easeOutCubic — fast start, gentle landing.
        const eased = 1 - Math.pow(1 - t, 3);
        el.innerText = Math.round(target * eased).toLocaleString();
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
