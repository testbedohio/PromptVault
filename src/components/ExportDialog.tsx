import { useState } from "react";
import { getExportData } from "../api/commands";

interface ExportDialogProps {
  promptCount: number;
  onClose: () => void;
}

type ExportFormat = "json" | "markdown";

export default function ExportDialog({ promptCount, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      const data = await getExportData(format);

      // Build a Blob and trigger a browser-style download.
      // Works in both Tauri (webview) and browser dev mode.
      const mimeType = format === "json" ? "application/json" : "text/markdown";
      const extension = format === "json" ? "json" : "md";
      const filename = `promptvault_export_${new Date()
        .toISOString()
        .slice(0, 10)}.${extension}`;

      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      // Clean up the object URL after a short delay
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const formatInfo: Record<ExportFormat, { label: string; icon: string; description: string }> = {
    json: {
      label: "JSON",
      icon: "{}",
      description:
        "Structured export with all metadata — prompts, categories, tags, timestamps. " +
        "Ideal for importing into other tools or scripting.",
    },
    markdown: {
      label: "Markdown",
      icon: "##",
      description:
        "A single human-readable Markdown file with one section per prompt. " +
        "Ideal for sharing, reading, or archiving without PromptVault.",
    },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-darcula-border">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              ↓ Export Prompts
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              {promptCount} prompt{promptCount !== 1 ? "s" : ""} will be exported
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Format Selection */}
        <div className="px-4 py-4 space-y-2">
          <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-3">
            Export Format
          </label>

          {(Object.entries(formatInfo) as [ExportFormat, typeof formatInfo.json][]).map(
            ([key, info]) => (
              <button
                key={key}
                className={`w-full flex items-start gap-3 p-3 rounded-sm border text-left transition-colors ${
                  format === key
                    ? "border-darcula-accent bg-darcula-accent/10"
                    : "border-darcula-border hover:border-darcula-accent/40 hover:bg-darcula-bg-lighter"
                }`}
                onClick={() => setFormat(key)}
              >
                {/* Format icon */}
                <span
                  className={`flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center text-xs font-mono font-bold ${
                    format === key
                      ? "bg-darcula-accent text-white"
                      : "bg-darcula-bg text-darcula-text-muted"
                  }`}
                >
                  {info.icon}
                </span>

                <div className="min-w-0">
                  <div
                    className={`text-xs font-mono font-semibold ${
                      format === key ? "text-darcula-accent-bright" : "text-darcula-text"
                    }`}
                  >
                    {info.label}
                  </div>
                  <div className="text-2xs font-mono text-darcula-text-muted mt-0.5 leading-relaxed">
                    {info.description}
                  </div>
                </div>

                {/* Selected indicator */}
                {format === key && (
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-darcula-accent flex items-center justify-center ml-auto mt-1">
                    <span className="text-white text-xs">✓</span>
                  </span>
                )}
              </button>
            )
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 pb-2">
            <p className="text-2xs font-mono text-darcula-error bg-darcula-error/10 px-3 py-2 rounded-sm">
              {error}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-darcula-border">
          <p className="text-2xs font-mono text-darcula-text-muted">
            File will download automatically
          </p>
          <div className="flex gap-2">
            <button
              className="text-xs font-mono px-3 py-1.5 rounded-sm text-darcula-text-muted hover:text-darcula-text transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="text-xs font-mono px-4 py-1.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? "Exporting…" : `Export as ${formatInfo[format].label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
