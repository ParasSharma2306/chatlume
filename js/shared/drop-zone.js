/**
 * ============================================================================
 * Drag-and-drop file intake
 * ============================================================================
 * Two surfaces: the drop target inside the sidebar form, and a full-window
 * overlay so a file can be dropped anywhere on the page.
 * ============================================================================
 */

/**
 * Highlights the sidebar drop target while dragging. The drop itself bubbles to
 * the window handler below, which validates the file — handling it here too
 * processed every drop twice, and accepted files the window handler rejected.
 */
export function setupDropTarget(dropTarget) {
    if (!dropTarget) return;

    ["dragenter", "dragover"].forEach((eventName) => {
        dropTarget.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropTarget.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropTarget.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropTarget.classList.remove("dragover");
        });
    });
}

/**
 * Full-window drag-and-drop overlay. Uses a dragenter/dragleave depth counter
 * so the overlay doesn't flicker when the cursor crosses child elements.
 */
export function setupGlobalDropZone(overlay, onFile) {
    if (!overlay) return;

    let depth = 0;
    const dragHasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    const show = () => overlay.classList.add("active");
    const hide = () => { overlay.classList.remove("active"); overlay.classList.remove("error"); };

    window.addEventListener("dragenter", (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        depth += 1;
        show();
    });

    window.addEventListener("dragover", (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
    });

    window.addEventListener("dragleave", (event) => {
        if (!dragHasFiles(event)) return;
        depth -= 1;
        if (depth <= 0) {
            depth = 0;
            hide();
        }
    });

    window.addEventListener("drop", (event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        depth = 0;
        hide();
        const file = event.dataTransfer?.files?.[0];
        if (file) onFile(file);
    });
}

/**
 * Mirrors a dropped file into the hidden <input type="file"> so the rest of
 * the form (and the Load button) sees it like a picked file. Some browsers
 * refuse the assignment; the viewer keeps its own `selectedFile` as backup.
 */
export function assignFileToInput(input, file) {
    if (!input) return;
    try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
    } catch (error) {
        console.warn("Unable to assign dropped file to input:", error);
    }
}
