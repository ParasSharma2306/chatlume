/**
 * ============================================================================
 * "Which participant is you?"
 * ============================================================================
 * Both viewers let the reader say whose messages sit on the right after the
 * chat is open, instead of demanding an exact name up front.
 * ============================================================================
 */
import { escapeAttribute, escapeHtml } from "./dom.js?v=1.8.7";

/**
 * The export's owner, when it can be told from the chat alone: a one-to-one
 * chat is titled after the other person.
 */
export function inferOwner(senders, title) {
    if (senders.length !== 2) return "";
    const wanted = String(title || "").trim().toLowerCase();
    const other = senders.findIndex((sender) => sender.toLowerCase() === wanted);
    return other === -1 ? "" : senders[1 - other];
}

/** Fills the Settings select; the row stays hidden until a chat is open. */
export function renderIdentitySelect(row, select, senders, current) {
    if (!row || !select) return;
    row.hidden = senders.length === 0;
    const wanted = String(current || "").toLowerCase();
    select.innerHTML = `<option value="">Not set</option>` + senders.map((sender) =>
        `<option value="${escapeAttribute(sender)}"${sender.toLowerCase() === wanted ? " selected" : ""}>${escapeHtml(sender)}</option>`
    ).join("");
}
