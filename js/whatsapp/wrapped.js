/**
 * ============================================================================
 * ChatLume Wrapped
 * ============================================================================
 * A shareable summary graphic — messages, words, media, peak hour, top
 * emojis and top contributors — rendered as DOM and rasterised to a PNG
 * with html2canvas (loaded on first download, not at boot).
 * ============================================================================
 */
import { $, escapeHtml } from "../shared/dom.js?v=1.7.2";
import { pushOverlayState, popOverlayState } from "../shared/history.js?v=1.7.2";
import { SITE_URL, state } from "./state.js?v=1.7.2";
import { formatDateLabel } from "./format.js?v=1.7.2";
import { getColor } from "./render.js?v=1.7.2";
import { showToast } from "./ui.js?v=1.7.2";

const HTML2CANVAS_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

// ── Modal ───────────────────────────────────────────────────────────────────

export function openWrapped() {
    if (state.messageOnlyCount === 0) {
        showToast("Load a chat first to generate ChatLume Wrapped!", "warn");
        return;
    }
    populateWrappedGraphic();
    $("wrapped-modal").hidden = false;
    requestAnimationFrame(() => $("wrapped-modal").classList.add("open"));
    pushOverlayState("wrapped"); // Tie to hardware back button
}

/** Close from a user gesture: also pops the history entry openWrapped pushed. */
export function closeWrapped() {
    const modal = $("wrapped-modal");
    modal.classList.remove("open");
    window.setTimeout(() => modal.hidden = true, 120);
    popOverlayState();
}

/** Close from Back: the history entry is already gone. */
export function closeWrappedFromHistory() {
    const modal = $("wrapped-modal");
    if (!modal || modal.hidden) return;
    modal.classList.remove("open");
    window.setTimeout(() => {
        if (!modal.classList.contains("open")) {
            modal.hidden = true;
        }
    }, 120);
}

// ── Graphic ─────────────────────────────────────────────────────────────────

export function populateWrappedGraphic() {
    const graphic = $("wrapped-graphic");
    if (!graphic) return;

    const total = state.messageOnlyCount;
    const chatTitle = state.chatTitle || "Chat History";

    // Peak hour
    let peakHour = 0, maxMsgs = 0;
    state.hourlyStats.forEach((count, hr) => { if (count > maxMsgs) { maxMsgs = count; peakHour = hr; } });
    const ampm = peakHour >= 12 ? "PM" : "AM";
    const peakHour12 = state.settings.timeFormat === "24"
        ? `${String(peakHour).padStart(2, "0")}:00`
        : ((peakHour % 12) || 12) + " " + ampm;

    const totalMedia = state.mediaCount;

    // Total words
    let totalWords = 0;
    state.filteredMessages.forEach((m) => {
        if (m.type === "msg" && m.text) {
            totalWords += m.text.split(/\s+/).filter(Boolean).length;
        }
    });

    // Date range
    const dates = state.filteredMessages.filter((m) => m.type === "date");
    const firstDate = dates.length > 0 ? formatDateLabel(dates[0].rawDate || dates[0].content) : "Unknown Date";
    const lastDate = dates.length > 0 ? formatDateLabel(dates[dates.length - 1].rawDate || dates[dates.length - 1].content) : "Unknown Date";
    const dateRange = firstDate !== "Unknown Date" && firstDate !== lastDate ? `${firstDate} - ${lastDate}` : firstDate;

    // Emojis — top 6 in a 3-column grid
    const sortedEmojis = Object.entries(state.emojiStats).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const emojisHtml = sortedEmojis.length === 0
        ? "<span style='color:#555; font-size:13px;'>No emojis found</span>"
        : sortedEmojis.map((e) => `<div class="wg-emoji-cell"><span class="wg-emoji-char">${e[0]}</span><span class="wg-emoji-count">${e[1].toLocaleString()}</span></div>`).join("");

    // Top senders split
    const sortedSenders = Object.entries(state.senderStats).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let barHtml = "";
    let labelsHtml = "";

    sortedSenders.forEach(([name, count]) => {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
        const color = getColor(name);
        barHtml += `<div class="wg-split-segment" style="width: ${pct}%; background-color: ${color};"></div>`;
        labelsHtml += `<div class="wg-split-label"><span class="wg-split-dot" style="color: ${color}">●</span> <span class="wg-name">${escapeHtml(name)}</span> <span class="wg-pct">${pct}%</span></div>`;
    });

    graphic.innerHTML = `
        <div class="wg-header">
            <div class="wg-brand-tag">ChatLume Wrapped</div>
            <h2>${escapeHtml(chatTitle)}</h2>
            <p>${escapeHtml(dateRange)}</p>
        </div>

        <div class="wg-divider"></div>

        <div class="wg-stats-grid">
            <div class="wg-stat-card">
                <span>Messages</span>
                <h3>${total.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Words</span>
                <h3>${totalWords.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Media</span>
                <h3>${totalMedia.toLocaleString()}</h3>
            </div>
            <div class="wg-stat-card">
                <span>Peak Hour</span>
                <h3>${peakHour12}</h3>
            </div>
        </div>

        <div class="wg-section">
            <div class="wg-label">Most Used</div>
            <div class="wg-emoji-grid">${emojisHtml}</div>
        </div>

        <div class="wg-section">
            <div class="wg-label">Top Contributors</div>
            <div class="wg-split">
                <div class="wg-split-bar">${barHtml}</div>
                <div class="wg-split-labels">${labelsHtml}</div>
            </div>
        </div>

        <div class="wg-brand-footer">
            <div class="wg-logo"><img src="../assets/logo-64.png" alt=""> ChatLume</div>
            <div class="wg-url">${SITE_URL.replace(/^https?:\/\//, "")}</div>
        </div>
    `;
}

// ── PNG download ────────────────────────────────────────────────────────────

/** Loads html2canvas from the CDN the first time it is needed. */
function loadHtml2Canvas() {
    if (typeof html2canvas !== "undefined") return Promise.resolve();
    showToast("Loading image generator...", "info");
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = HTML2CANVAS_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load image generator"));
        document.head.appendChild(script);
    });
}

export async function downloadWrappedGraphic() {
    const element = $("wrapped-graphic");
    if (!element) return;

    const btn = $("download-wrapped");
    const oldText = btn.innerHTML;
    btn.innerHTML = `<i class="ph-fill ph-spinner-gap processing-spinner" style="font-size: 18px; margin-right: 8px;"></i> Generating...`;
    btn.disabled = true;

    try {
        await loadHtml2Canvas();

        // html2canvas rasterises whatever is decoded at call time — an undecoded
        // logo would come out blank in the downloaded PNG.
        await Promise.all(
            Array.from(element.querySelectorAll("img")).map((img) =>
                img.complete ? Promise.resolve() : img.decode().catch(() => {})
            )
        );

        const canvas = await html2canvas(element, {
            backgroundColor: "#000",
            scale: 2,
            useCORS: true,
            logging: false
        });

        const link = document.createElement("a");
        const safeTitle = state.chatTitle.replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_");
        link.download = `ChatLume_Wrapped_${safeTitle}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

        showToast("Image downloaded!");
    } catch (err) {
        console.error(err);
        showToast("Failed to download image.", "error");
    } finally {
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}
