import { useState } from "react";

export interface EditorSettings {
  stripedLines: boolean;
  stripeColor: string;
  minimap: boolean;
}

/** Available stripe color presets — each is a CSS background-color value. */
export const STRIPE_PRESETS: { key: string; label: string; value: string }[] = [
  { key: "subtle",  label: "Subtle",        value: "rgba(255,255,255,0.025)" },
  { key: "warm",    label: "Warm Amber",     value: "rgba(204,120,50,0.08)" },
  { key: "cool",    label: "Cool Blue",      value: "rgba(75,110,175,0.10)" },
  { key: "green",   label: "Soft Green",     value: "rgba(73,156,84,0.10)" },
  { key: "purple",  label: "Muted Purple",   value: "rgba(150,110,200,0.10)" },
  { key: "high",    label: "High Contrast",  value: "rgba(255,255,255,0.06)" },
];

export function getStripeColor(key: string): string {
  return STRIPE_PRESETS.find((p) => p.key === key)?.value ?? STRIPE_PRESETS[0].value;
}

interface SettingsDialogProps {
  settings: EditorSettings;
  onUpdate: (settings: EditorSettings) => void;
  onClose: () => void;
}

export default function SettingsDialog({ settings, onUpdate, onClose }: SettingsDialogProps) {
  const [local, setLocal] = useState<EditorSettings>({ ...settings });

  const apply = (patch: Partial<EditorSettings>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onUpdate(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between">
          <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
            Settings
          </h2>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-5">
          {/* Section: Editor */}
          <div>
            <h3 className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider mb-3">
              Editor
            </h3>

            {/* Striped Lines Toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-xs font-mono text-darcula-text-bright">
                  Alternating Line Colors
                </div>
                <div className="text-2xs font-mono text-darcula-text-muted mt-0.5">
                  Shade every other line for readability
                </div>
              </div>
              <button
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  local.stripedLines ? "bg-darcula-accent" : "bg-darcula-border"
                }`}
                onClick={() => apply({ stripedLines: !local.stripedLines })}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    local.stripedLines ? "left-[22px]" : "left-[2px]"
                  }`}
                />
              </button>
            </div>

            {/* Stripe Color Picker */}
            {local.stripedLines && (
              <div className="pt-2 pb-1">
                <div className="text-2xs font-mono text-darcula-text-muted mb-2">
                  Stripe Color
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {STRIPE_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-sm border transition-colors ${
                        local.stripeColor === preset.key
                          ? "border-darcula-accent bg-darcula-accent/10"
                          : "border-darcula-border hover:border-darcula-border-light"
                      }`}
                      onClick={() => apply({ stripeColor: preset.key })}
                    >
                      <span
                        className="w-4 h-4 rounded-sm border border-darcula-border flex-shrink-0"
                        style={{ backgroundColor: preset.value }}
                      />
                      <span className="text-2xs font-mono text-darcula-text truncate">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Live preview */}
                <div className="mt-3 rounded-sm overflow-hidden border border-darcula-border text-2xs font-mono">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="px-2 py-0.5 flex gap-2"
                      style={{
                        backgroundColor: n % 2 === 0
                          ? getStripeColor(local.stripeColor)
                          : "transparent",
                      }}
                    >
                      <span className="text-darcula-gutter w-4 text-right">{n}</span>
                      <span className="text-darcula-text-muted">
                        {n === 1 ? "# Example prompt" : n === 3 ? "You are a helpful assistant." : n === 5 ? "## Guidelines" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Minimap Toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-xs font-mono text-darcula-text-bright">
                  Minimap
                </div>
                <div className="text-2xs font-mono text-darcula-text-muted mt-0.5">
                  Show code overview on the right side
                </div>
              </div>
              <button
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  local.minimap ? "bg-darcula-accent" : "bg-darcula-border"
                }`}
                onClick={() => apply({ minimap: !local.minimap })}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    local.minimap ? "left-[22px]" : "left-[2px]"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-darcula-border flex justify-end">
          <button
            className="text-xs font-mono px-3 py-1.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
