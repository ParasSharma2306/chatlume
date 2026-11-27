/**
 * ============================================================================
 * Instagram drop target
 * ============================================================================
 * The "Ready to load" state of the sidebar's drop target.
 * ============================================================================
 */
import { $, q, escapeHtml } from "../shared/dom.js?v=1.10.0";

/** Turns the drop target into a "Ready to load" confirmation. */
export function reflectSelectedFile(file) {
    const dropTarget = $("ig-drop-target");
    if (!dropTarget) return;
    dropTarget.classList.add("ready");
    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);
    if (icon) { icon.className = "ph-fill ph-check-circle"; }
    if (label) label.innerHTML = `<strong>${escapeHtml(file.name)}</strong><br><span style="font-size:12px;opacity:0.7">Ready to load</span>`;
}

export function resetDropTarget() {
    const dropTarget = $("ig-drop-target");
    if (!dropTarget) return;
    dropTarget.classList.remove("ready");
    const icon = q("i", dropTarget);
    const label = q("p", dropTarget);
    if (icon) { icon.className = "ph ph-file-zip"; }
    if (label) label.innerHTML = "Drop <strong>.zip</strong> export";
}
