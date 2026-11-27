/**
 * ============================================================================
 * Long-press and context menu
 * ============================================================================
 * One "more options" gesture for touch, mouse and keyboard:
 *
 *   - touch / pen: hold ~400ms without moving. Moving more than a few pixels
 *     (a scroll), lifting early, a second finger or a scroll of the list
 *     cancels it, so scrolling a gallery never opens a menu;
 *   - mouse: right-click;
 *   - keyboard: the Menu key or Shift+F10 on a focused item.
 *
 * The browser's own context menu, link preview and text-selection callout
 * are suppressed on matching items, and the tap that ends a long-press is
 * swallowed so it doesn't also open the item.
 *
 *   const press = createLongPress(listElement, {
 *       selector: ".gallery-item",
 *       onMenu: (item, { x, y }) => showMenu(item, x, y)
 *   });
 *   press.destroy();
 * ============================================================================
 */

export const LONG_PRESS_MS = 400;
/** How far (px) a finger may drift before the press counts as a scroll. */
export const LONG_PRESS_TOLERANCE = 10;

/**
 * @param {HTMLElement} root
 * @param {Object}      options
 * @param {string}      options.selector   Items that get the gesture.
 * @param {Function}    options.onMenu     (item, { x, y, source }) → void
 * @param {number}      [options.delay]
 * @param {number}      [options.tolerance]
 */
export function createLongPress(root, { selector, onMenu, delay = LONG_PRESS_MS, tolerance = LONG_PRESS_TOLERANCE }) {
    let timer = 0;
    let start = null;
    let pointerId = null;
    // After a long-press fires, the click (and Android's own contextmenu)
    // that follow the same touch must not act again.
    let swallowUntil = 0;
    let lastKeyboardOpen = 0;

    const itemFrom = (target) => {
        const item = target?.closest?.(selector);
        return item && root.contains(item) ? item : null;
    };

    function cancel() {
        window.clearTimeout(timer);
        timer = 0;
        start = null;
        pointerId = null;
    }

    function onPointerDown(event) {
        if (event.pointerType === "mouse") return;
        // A second finger is a pinch, not a press.
        if (!event.isPrimary || timer) {
            cancel();
            return;
        }
        const item = itemFrom(event.target);
        if (!item) return;
        start = { x: event.clientX, y: event.clientY };
        pointerId = event.pointerId;
        timer = window.setTimeout(() => {
            const point = start;
            cancel();
            if (!item.isConnected) return;
            swallowUntil = Date.now() + 1200;
            navigator.vibrate?.(8);
            onMenu(item, { x: point.x, y: point.y, source: "touch" });
        }, delay);
    }

    function onPointerMove(event) {
        if (!timer || event.pointerId !== pointerId || !start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > tolerance) cancel();
    }

    function onPointerEnd(event) {
        if (event.pointerId === pointerId) cancel();
    }

    function onClick(event) {
        if (Date.now() > swallowUntil || !itemFrom(event.target)) return;
        swallowUntil = 0;
        event.preventDefault();
        event.stopPropagation();
    }

    function onContextMenu(event) {
        const item = itemFrom(event.target);
        if (!item) return;
        event.preventDefault();
        // The touch long-press already opened the menu; Android follows it
        // with its own contextmenu event.
        if (Date.now() < swallowUntil) return;
        // The Menu key fires keydown (handled below) and then contextmenu.
        if (Date.now() - lastKeyboardOpen < 400) return;
        const fromKeyboard = event.button !== 2 && !event.clientX && !event.clientY;
        onMenu(item, fromKeyboard ? pointFor(item) : { x: event.clientX, y: event.clientY, source: "mouse" });
    }

    function onKeyDown(event) {
        const isMenuKey = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
        if (!isMenuKey) return;
        const item = itemFrom(event.target);
        if (!item) return;
        event.preventDefault();
        lastKeyboardOpen = Date.now();
        onMenu(item, pointFor(item));
    }

    const listeners = [
        ["pointerdown", onPointerDown, { passive: true }],
        ["pointermove", onPointerMove, { passive: true }],
        ["pointerup", onPointerEnd, { passive: true }],
        ["pointercancel", onPointerEnd, { passive: true }],
        ["scroll", cancel, { passive: true, capture: true }],
        ["click", onClick, { capture: true }],
        ["contextmenu", onContextMenu, false],
        ["keydown", onKeyDown, false],
        // Desktop: a drag that starts on a thumbnail or link would otherwise
        // pick up a ghost image instead of scrolling or selecting.
        ["dragstart", (event) => { if (itemFrom(event.target)) event.preventDefault(); }, false]
    ];
    listeners.forEach(([type, handler, options]) => root.addEventListener(type, handler, options));

    return {
        cancel,
        destroy() {
            cancel();
            listeners.forEach(([type, handler, options]) => root.removeEventListener(type, handler, options));
        }
    };
}

/** Where a keyboard-opened menu appears: just under the focused item. */
function pointFor(item) {
    const rect = item.getBoundingClientRect();
    return { x: rect.left + Math.min(rect.width / 2, 48), y: rect.bottom - 4, source: "keyboard" };
}
