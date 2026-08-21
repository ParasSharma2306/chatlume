/**
 * Shared chrome for the static (non-app) pages: theme sync, scroll reveals,
 * back-to-top and the dynamic year. The viewer pages have their own copies of
 * the theme logic, so this only owns the pages that previously had none.
 */
(function () {
    "use strict";

    var THEME_KEY = "chatlume-theme";
    var reduceMotion = typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function readTheme() {
        try {
            return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
        } catch (e) {
            return "dark";
        }
    }

    function paintTheme(theme) {
        document.body.classList.toggle("light-theme", theme === "light");
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0b141a");
        document.querySelectorAll("[data-theme-toggle] i").forEach(function (icon) {
            icon.className = theme === "light" ? "ph ph-sun-dim" : "ph ph-moon-stars";
        });
        document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
            btn.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
        });
    }

    function setupTheme() {
        paintTheme(readTheme());
        document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var next = readTheme() === "light" ? "dark" : "light";
                try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
                paintTheme(next);
            });
        });
    }

    /** Reveal elements as they scroll in; falls back to "always visible". */
    function setupReveals() {
        var targets = document.querySelectorAll(".cl-reveal");
        if (!targets.length) return;

        if (reduceMotion || typeof IntersectionObserver === "undefined") {
            targets.forEach(function (el) { el.classList.add("cl-revealed"); });
            return;
        }

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("cl-revealed");
                observer.unobserve(entry.target);
            });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

        targets.forEach(function (el, i) {
            // Stagger siblings that didn't declare their own delay.
            if (!el.style.getPropertyValue("--cl-delay")) {
                var group = el.parentElement;
                var index = group ? Array.prototype.indexOf.call(group.children, el) : i;
                el.style.setProperty("--cl-delay", Math.min(index, 5) * 70 + "ms");
            }
            observer.observe(el);
        });
    }

    function setupToTop() {
        var btn = document.querySelector("[data-to-top]");
        if (!btn) return;

        var ticking = false;
        function sync() {
            btn.classList.toggle("show", window.scrollY > 520);
            ticking = false;
        }
        window.addEventListener("scroll", function () {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(sync);
        }, { passive: true });
        sync();

        btn.addEventListener("click", function () {
            window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
        });
    }

    function setupYear() {
        var year = String(new Date().getFullYear());
        document.querySelectorAll(".dynamic-year").forEach(function (el) { el.textContent = year; });
    }

    /** Marks the nav link matching the current page. */
    function setupActiveNav() {
        var here = window.location.pathname.replace(/\/index\.html$/, "/").replace(/\/+$/, "/") || "/";
        document.querySelectorAll(".landing-nav .nav-links a[href]").forEach(function (a) {
            var target = a.getAttribute("href");
            if (!target || target.charAt(0) === "#") return;
            var resolved = new URL(target, window.location.href).pathname
                .replace(/\/index\.html$/, "/").replace(/\/+$/, "/") || "/";
            if (resolved === here) a.setAttribute("aria-current", "page");
        });
    }

    function init() {
        setupTheme();
        setupReveals();
        setupToTop();
        setupYear();
        setupActiveNav();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
