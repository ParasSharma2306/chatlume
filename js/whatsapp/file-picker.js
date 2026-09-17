/**
 * ============================================================================
 * File intake
 * ============================================================================
 * Everything between "the user has a file" and "the Load button is pressed":
 * the picker, the sidebar drop target, the full-window drop overlay, the
 * size check for browsers without streaming, and the "Ready to load" state
 * of the drop target.
 * ============================================================================
 */
import { $, q, escapeHtml } from "../shared/dom.js?v=1.6.2";
import { COMPAT_LIMIT_MESSAGE, exceedsCompatLimit } from "../shared/compat.js?v=1.6.2";
import { assignFileToInput, setupDropTarget, setupGlobalDropZone } from "../shared/drop-zone.js?v=1.6.2";
import { state } from "./state.js?v=1.6.2";
import { isMobileLayout, setSidebarState, setUploadPanelVisible, showToast } from "./ui.js?v=1.6.2";

/** Wires the picker, drop target and window-wide drop overlay. */
export function setupFileIntake() {
    const fileInput = $("file-input");
    $("drop-target")?.addEventListener("click", () => fileInput?.click());
    // Clearing the value lets the same file be picked twice in a row.
    fileInput?.addEventListener("click", (event) => {
        event.target.value = null;
        state.selectedFile = null;
        resetSelectedFileUI();
    });
    fileInput?.addEventListener("change", handleFileInputChange);

    setupDropTarget($("drop-target"), (files) => {
        const file = files[0];
        if (exceedsCompatLimit(file)) {
            showToast(COMPAT_LIMIT_MESSAGE, "error");
            return;
        }
        state.selectedFile = file;
        try {
            if (fileInput) fileInput.files = files;
        } catch (error) {
            console.warn("Unable to assign dropped files to input:", error);
        }
        reflectSelectedFile(file);
    });

    setupGlobalDropZone($("drag-overlay"), handleDroppedFile);
}

function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (exceedsCompatLimit(file)) {
        showToast(COMPAT_LIMIT_MESSAGE, "error");
        event.target.value = "";
        return;
    }
    state.selectedFile = file;
    reflectSelectedFile(file);
}

/** A file dropped anywhere on the page. */
function handleDroppedFile(file) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".zip")) {
        showToast("Please drop a WhatsApp .txt or .zip export", "error");
        return;
    }
    if (exceedsCompatLimit(file)) {
        showToast(COMPAT_LIMIT_MESSAGE, "error");
        return;
    }

    state.selectedFile = file;
    assignFileToInput($("file-input"), file);
    reflectSelectedFile(file);

    // If a chat is already open, the upload panel is hidden — let the user know
    // how to reach the file they just dropped.
    if ($("upload-panel")?.classList.contains("hidden")) {
        setUploadPanelVisible(true);
        if (isMobileLayout()) setSidebarState(true);
        showToast("File ready — tap Load Chat to open it", "info");
    }
}

/** Turns the drop target into a "Ready to load" confirmation. */
export function reflectSelectedFile(file) {
    const dropTarget = $("drop-target");
    if (!dropTarget) return;

    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);

    dropTarget.classList.add("ready");
    if (icon) {
        icon.className = "ph-fill ph-check-circle";
        icon.style.color = "#00a884";
    }
    if (label) {
        label.innerHTML = `<strong>${escapeHtml(file.name)}</strong><br><span style="font-size:12px;opacity:0.7">Ready to load</span>`;
    }
}

export function resetSelectedFileUI() {
    const dropTarget = $("drop-target");
    if (!dropTarget) return;

    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);

    dropTarget.classList.remove("ready");
    if (icon) {
        icon.className = "ph ph-file-arrow-up";
        icon.style.color = "";
    }
    if (label) {
        label.innerHTML = 'Drop <strong>.txt</strong> or <strong>.zip</strong>';
    }
}
