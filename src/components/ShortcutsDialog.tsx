import { useState, useEffect, useCallback } from "react";
import { getShortcuts, setShortcut, resetShortcuts, type ShortcutMap } from "../api/commands";

interface ShortcutsDialogProps {
  onClose: () => void;
  onSaved: (shortcuts: ShortcutMap) => void;
}

const ACTION_LABELS: Record<keyof ShortcutMap, string> = {
  commandPalette: "Command Palette",
  newPrompt:      "New Prompt",
  brainSelector:  "Brain Selector",
  syncPanel:      "Sync Panel",
  shortcuts:      "Keyboard Shortcuts",
};

const ACTION_KEYS = Object.keys(ACTION_LABELS) as (keyof ShortcutMap)[];

function eventToAccelerator(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  const normalized =
    key === " " ? "Space" :
    key.length === 1 ? key.toUpperCase() :
    key;
  parts.push(normalized);
  return parts.join("+");
}

export default function ShortcutsDialog({ onClose, onSaved }: ShortcutsDialogProps) {
  const [shortcuts, setShortcuts]   = useState<ShortcutMap | null>(null);
  const [recording, setRecording]   = useState<keyof ShortcutMap | null>(null);
  const [recorded, setRecorded]     = useState<Partial<ShortcutMap>>({});
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    getShortcuts()
      .then((map) => { setShortcuts(map); setRecorded({}); })
      .catch(() => setError("Could not load shortcuts (Tauri unavailable in browser mode)."));
  }, []);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); return; }
      const accel = eventToAccelerator(e);
      if (!accel) return;
      setRecorded((prev) => ({ ...prev, [recording]: accel }));
      setRecording(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording]);

  const handleSave = useCallback(async () => {
    if (!shortcuts) return;
    setSaving(true);
    setError(null);
    try {
      for (const [action, accel] of Object.entries(recorded)) {
        await setShortcut(action as keyof ShortcutMap, accel);
      }
      const updated = await getShortcuts();
      setShortcuts(updated);
      setRecorded({});
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [shortcuts, recorded, onSaved]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const defaults = await resetShortcuts();
      setShortcuts(defaults);
      setRecorded({});
      onSaved(defaults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }, [onSaved]);

  const pendingCount = Object.keys(recorded).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-darcula-bg-light border border-darcula-border rounded-md shadow-2xl w-[480px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-darcula-border">
          <span className="text-sm font-mono font-semibold text-darcula-text">
            Keyboard Shortcuts
          </span>
          <button className="text-darcula-text-muted hover:text-darcula-text text-lg leading-none" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <div className="mb-3 text-2xs font-mono text-darcula-error bg-darcula-error/10 px-3 py-2 rounded-sm">
              {error}
            </div>
          )}
          {!shortcuts ? (
            <div className="text-2xs font-mono text-darcula-text-muted animate-pulse py-4 text-center">
              Loading shortcuts…
            </div>
          ) : (
            <table className="w-full text-2xs font-mono">
              <thead>
                <tr className="border-b border-darcula-border">
                  <th className="text-left text-darcula-text-muted pb-2 font-normal">Action</th>
                  <th className="text-right text-darcula-text-muted pb-2 font-normal">Shortcut</th>
                </tr>
              </thead>
              <tbody>
                {ACTION_KEYS.map((action) => {
                  const current = recorded[action] ?? shortcuts[action];
                  const isRecording = recording === action;
                  const isDirty = action in recorded;
                  return (
                    <tr key={action} className="border-b border-darcula-border/50">
                      <td className="py-2.5 text-darcula-text">{ACTION_LABELS[action]}</td>
                      <td className="py-2.5 text-right">
                        <button
                          className={[
                            "px-2.5 py-1 rounded-sm border font-mono text-2xs transition-colors min-w-[110px] text-center",
                            isRecording
                              ? "border-darcula-accent text-darcula-accent animate-pulse bg-darcula-accent/10"
                              : isDirty
                              ? "border-darcula-accent-bright text-darcula-accent-bright bg-darcula-accent-bright/10"
                              : "border-darcula-border text-darcula-text hover:border-darcula-accent",
                          ].join(" ")}
                          onClick={() => setRecording(isRecording ? null : action)}
                        >
                          {isRecording ? "Press keys…" : current}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-2xs font-mono text-darcula-text-muted">
            Click a shortcut to record a new key combination. Press Escape to cancel.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-darcula-border">
          <button
            className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors"
            onClick={handleReset}
            disabled={saving}
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              className="text-2xs font-mono px-3 py-1.5 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="text-2xs font-mono px-3 py-1.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent/80 transition-colors disabled:opacity-40"
              onClick={handleSave}
              disabled={saving || pendingCount === 0}
            >
              {saving ? "Saving…" : pendingCount > 0 ? `Save (${pendingCount})` : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
