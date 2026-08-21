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
        // The viewer pages own their own theme wiring (and their own
        // theme-color values); this only drives the marketing/content chrome.
        if (!document.querySelector("[data-theme-toggle]")) return;

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

    /**
     * Registers the service worker. Installability needs a SW with a fetch
     * handler in scope — without this the landing page never fires
     * `beforeinstallprompt`, so the install prompt below could never appear.
     */
    function setupServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        if (location.protocol !== "https:" && location.hostname !== "localhost") return;
        var depth = location.pathname.replace(/\/[^/]*$/, "").split("/").filter(Boolean).length;
        var path = new Array(depth + 1).join("../") + "sw.js";
        navigator.serviceWorker.register(path).catch(function () { /* offline support is optional */ });
    }

    var DISMISS_KEY = "chatlume-install-dismissed";

    /** Dismissible "Install ChatLume" card, shown only when the browser offers it. */
    function setupInstallPrompt() {
        var deferred = null;

        try {
            if (localStorage.getItem(DISMISS_KEY)) return;
        } catch (e) {}

        // Already running as an installed app — nothing to offer.
        if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return;
        if (navigator.standalone) return;

        window.addEventListener("beforeinstallprompt", function (event) {
            // Chrome's mini-infobar is replaced by our own card.
            event.preventDefault();
            deferred = event;
            show();
        });

        window.addEventListener("appinstalled", function () {
            try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
            var el = document.querySelector(".install-prompt");
            if (el) el.remove();
        });

        function show() {
            if (document.querySelector(".install-prompt")) return;

            var card = document.createElement("div");
            card.className = "install-prompt";
            card.setAttribute("role", "dialog");
            card.setAttribute("aria-label", "Install ChatLume");
            card.innerHTML =
                '<img src="' + iconPath() + '" alt="" class="install-prompt-icon">' +
                '<div class="install-prompt-text">' +
                    "<strong>Install ChatLume</strong>" +
                    "<span>Open your chats offline, straight from your home screen.</span>" +
                "</div>" +
                '<div class="install-prompt-actions">' +
                    '<button type="button" class="install-prompt-no">Not now</button>' +
                    '<button type="button" class="install-prompt-yes">Install</button>' +
                "</div>";
            document.body.appendChild(card);
            requestAnimationFrame(function () { card.classList.add("show"); });

            card.querySelector(".install-prompt-no").addEventListener("click", function () {
                dismiss(card, true);
            });
            card.querySelector(".install-prompt-yes").addEventListener("click", function () {
                if (!deferred) return dismiss(card, true);
                deferred.prompt();
                deferred.userChoice.then(function (choice) {
                    // A dismissed prompt can be re-offered later; an accepted one can't.
                    dismiss(card, choice && choice.outcome === "accepted");
                    deferred = null;
                });
            });
        }

        function dismiss(card, remember) {
            card.classList.remove("show");
            setTimeout(function () { card.remove(); }, 300);
            if (!remember) return;
            try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
        }

        function iconPath() {
            return location.pathname.indexOf("/public/") !== -1
                ? "../assets/logo-192.png"
                : "assets/logo-192.png";
        }
    }

    function init() {
        setupTheme();
        setupReveals();
        setupToTop();
        setupYear();
        setupActiveNav();
        setupServiceWorker();
        setupInstallPrompt();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
