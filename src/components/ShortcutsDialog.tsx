import { useState, useEffect, useCallback, useRef } from "react";
import { saveShortcuts, DEFAULT_SHORTCUTS, type ShortcutsConfig } from "../api/commands";

interface ShortcutsDialogProps {
  shortcuts: ShortcutsConfig;
  onSaved: (shortcuts: ShortcutsConfig) => void;
  onClose: () => void;
}

type ShortcutKey = keyof ShortcutsConfig;

const SHORTCUT_LABELS: Record<ShortcutKey, string> = {
  command_palette: "Command Palette",
  new_prompt: "New Prompt",
  brain_selector: "Brain Selector",
  toggle_inspector: "Toggle Inspector",
  sync_panel: "Sync Panel",
  export: "Export Prompts",
  shortcuts: "Open Shortcuts",
};

const SHORTCUT_DESCRIPTIONS: Record<ShortcutKey, string> = {
  command_palette: "Open the search / command palette",
  new_prompt: "Create a new prompt",
  brain_selector: "Open the embedding engine selector",
  toggle_inspector: "Show or hide the inspector panel",
  sync_panel: "Open the Google Drive sync panel",
  export: "Export prompts as JSON or Markdown",
  shortcuts: "Open this shortcuts configuration dialog",
};

/** Format a KeyboardEvent into a shortcut string like "ctrl+shift+k". */
function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");

  const key = e.key.toLowerCase();
  // Skip modifier-only presses
  if (["control", "shift", "alt", "meta", "os"].includes(key)) {
    return "";
  }
  parts.push(key);
  return parts.join("+");
}

/** Format a shortcut string for display: "ctrl+shift+k" → "Ctrl+Shift+K" */
function formatShortcut(shortcut: string): string {
  if (!shortcut) return "—";
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "ctrl") return "Ctrl";
      if (part === "shift") return "Shift";
      if (part === "alt") return "Alt";
      return part.toUpperCase();
    })
    .join("+");
}

export default function ShortcutsDialog({ shortcuts, onSaved, onClose }: ShortcutsDialogProps) {
  const [current, setCurrent] = useState<ShortcutsConfig>({ ...shortcuts });
  const [recording, setRecording] = useState<ShortcutKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Capture keydown while recording
  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(null);
        return;
      }

      const shortcut = eventToShortcut(e);
      if (!shortcut) return; // modifier-only, keep waiting

      setCurrent((prev) => ({ ...prev, [recording]: shortcut }));
      setRecording(null);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording]);

  const handleReset = useCallback(() => {
    setCurrent({ ...DEFAULT_SHORTCUTS });
  }, []);

  const handleClear = useCallback((key: ShortcutKey) => {
    setCurrent((prev) => ({ ...prev, [key]: "" }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveShortcuts(current);
      onSaved(current);
      setSavedFlash(true);
      setTimeout(() => {
        setSavedFlash(false);
        onClose();
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [current, onSaved, onClose]);

  const orderedKeys = Object.keys(SHORTCUT_LABELS) as ShortcutKey[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        ref={dialogRef}
        className="relative w-full max-w-lg bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-darcula-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              ⌨ Keyboard Shortcuts
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Click "Record" then press your desired key combination.
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Recording banner */}
        {recording && (
          <div className="px-4 py-2.5 bg-darcula-warning/15 border-b border-darcula-warning/30 flex items-center gap-2 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-darcula-warning animate-pulse flex-shrink-0" />
            <span className="text-xs font-mono text-darcula-warning">
              Recording for <strong>{SHORTCUT_LABELS[recording]}</strong> — press your shortcut now (Esc to cancel)
            </span>
          </div>
        )}

        {/* Shortcuts List */}
        <div className="overflow-y-auto flex-1">
          <div className="divide-y divide-darcula-border">
            {orderedKeys.map((key) => {
              const isRecording = recording === key;
              const value = current[key];

              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    isRecording ? "bg-darcula-warning/10" : "hover:bg-darcula-bg-lighter"
                  }`}
                >
                  {/* Action info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-darcula-text-bright">
                      {SHORTCUT_LABELS[key]}
                    </div>
                    <div className="text-2xs font-mono text-darcula-text-muted mt-0.5">
                      {SHORTCUT_DESCRIPTIONS[key]}
                    </div>
                  </div>

                  {/* Current shortcut display */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isRecording ? (
                      <span className="text-2xs font-mono px-3 py-1 rounded-sm bg-darcula-warning/20 text-darcula-warning border border-darcula-warning/40 animate-pulse min-w-[80px] text-center">
                        press key…
                      </span>
                    ) : (
                      <span className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-bg text-darcula-text border border-darcula-border min-w-[80px] text-center">
                        {formatShortcut(value)}
                      </span>
                    )}

                    <button
                      className={`text-2xs font-mono px-2 py-1 rounded-sm border transition-colors ${
                        isRecording
                          ? "border-darcula-warning text-darcula-warning hover:bg-darcula-warning/10"
                          : "border-darcula-border text-darcula-accent-bright hover:border-darcula-accent"
                      }`}
                      onClick={() => setRecording(isRecording ? null : key)}
                      title={isRecording ? "Cancel recording" : "Record new shortcut"}
                    >
                      {isRecording ? "Cancel" : "Record"}
                    </button>

                    <button
                      className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-error transition-colors px-1"
                      onClick={() => handleClear(key)}
                      title="Clear shortcut"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 border-t border-darcula-border flex-shrink-0">
            <p className="text-2xs font-mono text-darcula-error">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-darcula-border flex-shrink-0">
          <button
            className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors"
            onClick={handleReset}
          >
            Reset to defaults
          </button>

          <div className="flex gap-2">
            <button
              className="text-xs font-mono px-3 py-1.5 rounded-sm text-darcula-text-muted hover:text-darcula-text transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className={`text-xs font-mono px-4 py-1.5 rounded-sm transition-colors disabled:opacity-50 ${
                savedFlash
                  ? "bg-darcula-success text-white"
                  : "bg-darcula-accent text-white hover:bg-darcula-accent-bright"
              }`}
              onClick={handleSave}
              disabled={saving}
            >
              {savedFlash ? "Saved ✓" : saving ? "Saving…" : "Save Shortcuts"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}