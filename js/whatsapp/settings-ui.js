/**
 * ============================================================================
 * Settings drawer behaviour
 * ============================================================================
 * Reacts to a control change: validates, saves, and re-renders whatever the
 * setting affects. The persistent-storage toggle has its own side effects
 * and is routed to persistence.js.
 * ============================================================================
 */
import { DEFAULT_SETTINGS, sanitizeSettings } from "../settings.js?v=1.7.0";
import { state } from "./state.js?v=1.7.0";
import { reinferDateOrder } from "./format.js?v=1.7.0";
import { handlePersistentStorageToggle, refreshStorageSettingsUI } from "./persistence.js?v=1.7.0";
import { renderChatList } from "./render.js?v=1.7.0";
import { saveSettings, syncSettingsControls } from "./settings-store.js?v=1.7.0";
import { generateStats } from "./stats.js?v=1.7.0";
import { showToast } from "./ui.js?v=1.7.0";

export function handleSettingChange(event) {
    const control = event.currentTarget;
    const key = control.dataset.setting;
    if (!(key in state.settings)) return;

    state.settings[key] = control.type === "checkbox" ? control.checked : control.value;
    state.settings = sanitizeSettings(state.settings);
    saveSettings();
    syncSettingsControls();
    if (key === "persistentStorage") {
        handlePersistentStorageToggle();
        return;
    }
    rerenderAfterSettingsChange();
}

export function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    syncSettingsControls();
    refreshStorageSettingsUI();
    rerenderAfterSettingsChange();
    showToast("Settings reset");
}

function rerenderAfterSettingsChange() {
    if (state.filteredMessages.length) {
        // The calendar setting changes which day/month orders are valid, so
        // the inferred order is recomputed from the (cheap) date labels.
        reinferDateOrder();
        renderChatList();
        generateStats();
    }
}
