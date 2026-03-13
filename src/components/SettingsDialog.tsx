import { useState, useEffect, useCallback } from "react";
import { getShortcuts, saveShortcuts, type ShortcutsConfig } from "../api/commands";

interface SettingsDialogProps {
  onClose: () => void;
  onShortcutsChanged: (shortcuts: ShortcutsConfig) => void;
}

type ShortcutKey = keyof ShortcutsConfig;

const SHORTCUT_LABELS: Record<ShortcutKey, string> = {
  new_prompt:       "New Prompt",
  command_palette:  "Command Palette",
  brain_selector:   "Brain Selector",
  toggle_inspector: "Toggle Inspector",
  sync_panel:       "Sync Panel",
  settings:         "Settings",
};

const SHORTCUT_DESCRIPTIONS: Record<ShortcutKey, string> = {
  new_prompt:       "Open the new prompt dialog",
  command_palette:  "Open the command / search palette",
  brain_selector:   "Open embedding provider selector",
  toggle_inspector: "Show / hide the right inspector panel",
  sync_panel:       "Open Google Drive sync panel",
  settings:         "Open this settings dialog",
};

function formatShortcut(raw: string): string {
  return raw
    .split("+")
    .map((part) => {
      switch (part.toLowerCase()) {
        case "ctrl":   return "Ctrl";
        case "shift":  return "Shift";
        case "alt":    return "Alt";
        case "meta":   return "⌘";
        case "comma":  return ",";
        case "period": return ".";
        case "slash":  return "/";
        default: return part.toUpperCase();
      }
    })
    .join(" + ");
}

/** Converts a KeyboardEvent into our normalized shortcut string format */
function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey)   parts.push("alt");

  const key = e.key.toLowerCase();
  // Skip modifier-only presses
  if (["control", "shift", "alt", "meta"].includes(key)) return "";

  const keyMap: Record<string, string> = {
    ",": "comma",
    ".": "period",
    "/": "slash",
    " ": "space",
  };
  parts.push(keyMap[e.key] ?? key);
  return parts.join("+");
}

export default function SettingsDialog({ onClose, onShortcutsChanged }: SettingsDialogProps) {
  const [shortcuts, setShortcuts]     = useState<ShortcutsConfig | null>(null);
  const [recording, setRecording]     = useState<ShortcutKey | null>(null);
  const [pendingKey, setPendingKey]   = useState<string>("");
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Load persisted shortcuts on mount
  useEffect(() => {
    getShortcuts()
      .then(setShortcuts)
      .catch(() => {
        // Browser / Tauri unavailable — use defaults
        setShortcuts({
          new_prompt:       "ctrl+n",
          command_palette:  "ctrl+k",
          brain_selector:   "ctrl+b",
          toggle_inspector: "ctrl+i",
          sync_panel:       "ctrl+shift+s",
          settings:         "ctrl+comma",
        });
      });
  }, []);

  // Capture key presses while recording
  const handleKeyCapture = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(null);
        setPendingKey("");
        return;
      }

      const combo = eventToShortcut(e);
      if (combo) {
        setPendingKey(combo);
      }
    },
    [recording]
  );

  useEffect(() => {
    if (recording) {
      window.addEventListener("keydown", handleKeyCapture, true);
    }
    return () => window.removeEventListener("keydown", handleKeyCapture, true);
  }, [recording, handleKeyCapture]);

  const startRecording = (key: ShortcutKey) => {
    setRecording(key);
    setPendingKey("");
  };

  const confirmRecording = () => {
    if (!recording || !pendingKey || !shortcuts) return;

    const updated = { ...shortcuts, [recording]: pendingKey };
    setShortcuts(updated);
    setRecording(null);
    setPendingKey("");
  };

  const cancelRecording = () => {
    setRecording(null);
    setPendingKey("");
  };

  const resetDefaults = () => {
    setShortcuts({
      new_prompt:       "ctrl+n",
      command_palette:  "ctrl+k",
      brain_selector:   "ctrl+b",
      toggle_inspector: "ctrl+i",
      sync_panel:       "ctrl+shift+s",
      settings:         "ctrl+comma",
    });
    setRecording(null);
    setPendingKey("");
  };

  const handleSave = async () => {
    if (!shortcuts) return;
    setSaving(true);
    setError(null);
    try {
      await saveShortcuts(shortcuts);
      onShortcutsChanged(shortcuts);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!shortcuts) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]">
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl p-8 flex items-center justify-center">
          <div className="text-darcula-text-muted font-mono text-sm animate-pulse">Loading…</div>
        </div>
      </div>
    );
  }

  const shortcutKeys = Object.keys(shortcuts) as ShortcutKey[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-lg bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              ⚙ Settings — Keyboard Shortcuts
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Click a shortcut to record a new one. Press Escape to cancel.
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Shortcut rows */}
        <div className="divide-y divide-darcula-border max-h-[60vh] overflow-y-auto">
          {shortcutKeys.map((key) => {
            const isRecording = recording === key;
            const currentValue = shortcuts[key];

            return (
              <div
                key={key}
                className="flex items-center justify-between px-4 py-3 hover:bg-darcula-bg-lighter transition-colors"
              >
                {/* Label */}
                <div className="flex-1 min-w-0 mr-4">
                  <div className="text-xs font-mono text-darcula-text-bright">
                    {SHORTCUT_LABELS[key]}
                  </div>
                  <div className="text-2xs font-mono text-darcula-text-muted mt-0.5">
                    {SHORTCUT_DESCRIPTIONS[key]}
                  </div>
                </div>

                {/* Shortcut badge / recorder */}
                {isRecording ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="font-mono text-xs px-3 py-1.5 rounded-sm border border-darcula-accent bg-darcula-accent/10 text-darcula-accent-bright min-w-[120px] text-center animate-pulse cursor-default select-none"
                    >
                      {pendingKey ? formatShortcut(pendingKey) : "Press keys…"}
                    </div>
                    {pendingKey && (
                      <button
                        className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors"
                        onClick={confirmRecording}
                      >
                        ✓
                      </button>
                    )}
                    <button
                      className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors"
                      onClick={cancelRecording}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    className="font-mono text-xs px-3 py-1.5 rounded-sm border border-darcula-border bg-darcula-bg text-darcula-text hover:border-darcula-accent/60 hover:text-darcula-accent-bright transition-colors min-w-[120px] text-center"
                    onClick={() => startRecording(key)}
                    title="Click to change shortcut"
                  >
                    {formatShortcut(currentValue)}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-darcula-border flex items-center justify-between">
          <button
            className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors"
            onClick={resetDefaults}
          >
            Reset to defaults
          </button>

          <div className="flex items-center gap-2">
            {error && (
              <span className="text-2xs font-mono text-darcula-error">{error}</span>
            )}
            {saved && (
              <span className="text-2xs font-mono text-darcula-success">Saved ✓</span>
            )}
            <button
              className="text-xs font-mono px-3 py-1.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}