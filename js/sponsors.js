/**
 * Sponsor rendering shared by the landing marquee and the sponsors page.
 *
 * Sponsor records come from sponsors.json and are treated as untrusted text:
 * every field is escaped before it reaches innerHTML (the previous inline
 * versions interpolated `name`/`message`/`avatar` raw).
 */
(function () {
    "use strict";

    var DEFAULT_SRC = "sponsors.json";
    var SPONSOR_URL = "https://github.com/sponsors/ParasSharma2306";
    var FALLBACK_AVATAR_ICON = '<i class="ph-fill ph-user" aria-hidden="true"></i>';

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /** Only allow avatar/profile URLs we can safely put in an attribute. */
    function safeUrl(value) {
        if (!value) return "";
        var raw = String(value).trim();
        if (!/^https?:\/\//i.test(raw)) return "";
        return esc(raw);
    }

    /** "$25", "25 USD", "₹500" → 25 / 500. Returns 0 when unparseable. */
    function amountValue(amount) {
        if (typeof amount === "number") return isFinite(amount) ? amount : 0;
        var match = String(amount || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
        return match ? parseFloat(match[0]) : 0;
    }

    function tierFor(sponsor) {
        var explicit = String(sponsor.tier || "").toLowerCase();
        if (explicit === "gold" || explicit === "silver" || explicit === "bronze") return explicit;
        var value = amountValue(sponsor.amount);
        if (value >= 50) return "gold";
        if (value >= 15) return "silver";
        return "bronze";
    }

    var TIER_META = {
        gold: { label: "Gold", icon: "ph-fill ph-crown-simple" },
        silver: { label: "Silver", icon: "ph-fill ph-star" },
        bronze: { label: "Supporter", icon: "ph-fill ph-heart" }
    };

    function normalize(sponsor) {
        var record = sponsor && typeof sponsor === "object" ? sponsor : {};
        return {
            name: String(record.name || "").trim() || "Anonymous",
            amount: String(record.amount == null ? "" : record.amount).trim(),
            message: String(record.message || "").trim(),
            avatar: safeUrl(record.avatar),
            url: safeUrl(record.url || record.link || record.profile),
            tier: tierFor(record),
            value: amountValue(record.amount)
        };
    }

    function avatarMarkup(sponsor) {
        if (!sponsor.avatar) return FALLBACK_AVATAR_ICON;
        // data-fallback lets one delegated error handler swap in the icon
        // instead of an inline onerror with nested quote escaping.
        return '<img src="' + sponsor.avatar + '" alt="" loading="lazy" decoding="async" data-avatar-fallback>';
    }

    /** Swap broken avatars for the placeholder icon (capture phase: `error` doesn't bubble). */
    document.addEventListener("error", function (event) {
        var target = event.target;
        if (!target || target.tagName !== "IMG" || !target.hasAttribute("data-avatar-fallback")) return;
        var parent = target.parentNode;
        if (parent) parent.innerHTML = FALLBACK_AVATAR_ICON;
    }, true);

    function fetchSponsors(src) {
        return fetch(src, { cache: "no-cache" })
            .then(function (response) {
                if (!response.ok) throw new Error("Request failed (" + response.status + ")");
                return response.json();
            })
            .then(function (data) {
                if (!Array.isArray(data)) throw new Error("sponsors.json must contain an array");
                return data.map(normalize).sort(function (a, b) { return b.value - a.value; });
            });
    }

    /* ── Marquee ─────────────────────────────────────────────────────────── */

    function marqueeItem(sponsor) {
        return '<div class="sponsors-marquee-item">' +
            '<div class="sponsors-marquee-avatar">' + avatarMarkup(sponsor) + "</div>" +
            esc(sponsor.name) +
            (sponsor.amount ? '<span class="sponsors-marquee-amount">' + esc(sponsor.amount) + "</span>" : "") +
            "</div>";
    }

    function marqueeCta(text, emoji) {
        return '<div class="sponsors-marquee-item is-cta">' +
            '<div class="sponsors-marquee-avatar"><i class="ph-fill ph-heart" aria-hidden="true"></i></div>' +
            esc(text) + ' <span class="sponsors-marquee-amount">' + esc(emoji) + "</span></div>";
    }

    function marqueeSkeleton(count) {
        var html = "";
        for (var i = 0; i < count; i += 1) {
            html += '<div class="sponsors-marquee-item is-skeleton" aria-hidden="true">' +
                '<div class="sponsors-marquee-avatar"></div></div>';
        }
        return html;
    }

    /**
     * Fills `track` with two identical halves so the -50% keyframe loops
     * seamlessly, and scales the duration to the content so a 1-sponsor strip
     * doesn't crawl at the same speed as a 30-sponsor one.
     */
    function paintMarquee(track, itemsHtml, itemCount) {
        var half = itemsHtml;
        var repeats = 1;
        while (itemCount * repeats < 10) {
            half += itemsHtml;
            repeats += 1;
        }
        track.innerHTML = half + half;
        track.style.setProperty("--marquee-duration", Math.max(18, itemCount * repeats * 3.2) + "s");
    }

    function initMarquee(container) {
        var track = container.querySelector(".sponsors-marquee");
        if (!track) return;

        track.innerHTML = marqueeSkeleton(10);
        track.style.setProperty("--marquee-duration", "38s");

        fetchSponsors(container.getAttribute("data-sponsors-src") || DEFAULT_SRC)
            .then(function (sponsors) {
                if (!sponsors.length) {
                    paintMarquee(track, marqueeCta("Become our first sponsor", "✨"), 1);
                    return;
                }
                paintMarquee(track, sponsors.map(marqueeItem).join(""), sponsors.length);
            })
            .catch(function (error) {
                console.warn("Sponsors marquee unavailable:", error);
                paintMarquee(track, marqueeCta("Support ChatLume", "💖"), 1);
            });
    }

    /* ── Sponsors page grid ──────────────────────────────────────────────── */

    function sponsorCard(sponsor) {
        var meta = TIER_META[sponsor.tier];
        var message = sponsor.message
            ? '<div class="sponsor-message">' + esc(sponsor.message) + "</div>"
            : '<div class="sponsor-message"><em>Thanks for keeping ChatLume free.</em></div>';
        var amount = sponsor.amount
            ? '<div class="sponsor-amount">' + esc(sponsor.amount) + "</div>"
            : "";
        var link = sponsor.url
            ? '<a class="sponsor-link" href="' + sponsor.url + '" target="_blank" rel="noopener noreferrer">' +
              '<i class="ph ph-arrow-square-out" aria-hidden="true"></i> Profile</a>'
            : "";

        return '<article class="sponsor-card tier-' + sponsor.tier + '">' +
            '<span class="sponsor-tier-badge"><i class="' + meta.icon + '" aria-hidden="true"></i>' + meta.label + "</span>" +
            '<div class="sponsor-avatar">' + avatarMarkup(sponsor) + "</div>" +
            '<div class="sponsor-name">' + esc(sponsor.name) + "</div>" +
            message + amount + link +
            "</article>";
    }

    function gridSkeleton(count) {
        var html = "";
        for (var i = 0; i < count; i += 1) {
            html += '<div class="sponsor-card is-skeleton" aria-hidden="true">' +
                '<div class="skel-circle"></div>' +
                '<div class="skel-line"></div>' +
                '<div class="skel-line short"></div>' +
                '<div class="skel-line pill"></div>' +
                "</div>";
        }
        return html;
    }

    function emptyState() {
        return '<div class="state-panel">' +
            '<div class="state-icon"><i class="ph-duotone ph-hand-heart" aria-hidden="true"></i></div>' +
            "<h3>No sponsors yet</h3>" +
            "<p>ChatLume is free, ad-free and runs entirely in your browser. " +
            "Sponsorship is what keeps it that way — you could be the first name on this page.</p>" +
            '<div class="state-actions">' +
            '<a class="btn-primary btn-large" href="' + SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">' +
            '<i class="ph-fill ph-heart" aria-hidden="true"></i> Become the first sponsor</a>' +
            "</div></div>";
    }

    function errorState(message) {
        return '<div class="state-panel is-error">' +
            '<div class="state-icon"><i class="ph-duotone ph-cloud-warning" aria-hidden="true"></i></div>' +
            "<h3>Couldn't load sponsors</h3>" +
            "<p>" + esc(message || "Check your connection and try again.") + "</p>" +
            '<div class="state-actions">' +
            '<button type="button" class="btn-primary btn-large" data-sponsors-retry>' +
            '<i class="ph ph-arrow-clockwise" aria-hidden="true"></i> Try again</button>' +
            "</div></div>";
    }

    function renderSummary(node, sponsors) {
        if (!node) return;
        if (!sponsors.length) {
            node.hidden = true;
            return;
        }
        var total = sponsors.reduce(function (sum, s) { return sum + s.value; }, 0);
        var tiers = sponsors.filter(function (s) { return s.tier !== "bronze"; }).length;

        node.hidden = false;
        node.innerHTML =
            '<div class="sponsor-summary-item"><span class="val">' + sponsors.length +
                '</span><span class="label">Sponsor' + (sponsors.length === 1 ? "" : "s") + "</span></div>" +
            (total > 0
                ? '<div class="sponsor-summary-item"><span class="val">$' + total.toLocaleString() +
                  '</span><span class="label">Contributed</span></div>'
                : "") +
            (tiers > 0
                ? '<div class="sponsor-summary-item"><span class="val">' + tiers +
                  '</span><span class="label">Top tier</span></div>'
                : "") +
            '<div class="sponsor-summary-item"><span class="val">$0</span><span class="label">Cost to you</span></div>';
    }

    function initGrid(grid) {
        var summary = document.querySelector("[data-sponsor-summary]");
        var src = grid.getAttribute("data-sponsors-src") || DEFAULT_SRC;

        function load() {
            grid.style.display = "grid";
            grid.innerHTML = gridSkeleton(6);
            if (summary) summary.hidden = true;

            fetchSponsors(src)
                .then(function (sponsors) {
                    renderSummary(summary, sponsors);
                    grid.innerHTML = sponsors.length ? sponsors.map(sponsorCard).join("") : emptyState();
                    if (!sponsors.length) return;
                    // Stagger the cards in without blocking first paint.
                    Array.prototype.forEach.call(grid.children, function (card, i) {
                        card.classList.add("cl-reveal");
                        card.style.setProperty("--cl-delay", Math.min(i, 7) * 60 + "ms");
                        window.requestAnimationFrame(function () { card.classList.add("cl-revealed"); });
                    });
                })
                .catch(function (error) {
                    console.error("Error loading sponsors:", error);
                    grid.innerHTML = errorState(error.message);
                });
        }

        grid.addEventListener("click", function (event) {
            if (event.target.closest("[data-sponsors-retry]")) load();
        });

        load();
    }

    function init() {
        document.querySelectorAll("[data-sponsors-marquee]").forEach(initMarquee);
        var grid = document.querySelector("[data-sponsors-grid]");
        if (grid) initGrid(grid);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
