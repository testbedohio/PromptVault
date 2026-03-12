import { useState } from "react";
import {
  type EmbeddingProvider,
  getProviderInfo,
} from "../embeddings/service";

interface BrainSelectorProps {
  provider: EmbeddingProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  isIndexing: boolean;
  indexProgress: { current: number; total: number } | null;
  indexSize: number;
  lastError: string | null;
  totalPrompts: number;
  onSetProvider: (provider: EmbeddingProvider) => void;
  onSetApiKey: (provider: "gemini" | "claude", key: string) => void;
  onReindex: () => void;
  onClose: () => void;
}

const PROVIDERS: EmbeddingProvider[] = ["local", "gemini", "claude"];

export default function BrainSelector({
  provider,
  geminiApiKey,
  claudeApiKey,
  isIndexing,
  indexProgress,
  indexSize,
  lastError,
  totalPrompts,
  onSetProvider,
  onSetApiKey,
  onReindex,
  onClose,
}: BrainSelectorProps) {
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              🧠 Brain Selector
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Choose how PromptVault generates embeddings for semantic search
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Provider Cards */}
        <div className="p-4 space-y-2">
          {PROVIDERS.map((p) => {
            const info = getProviderInfo(p);
            const isActive = provider === p;

            return (
              <div
                key={p}
                className={`p-3 rounded-md border cursor-pointer transition-all ${
                  isActive
                    ? "border-darcula-accent bg-darcula-accent/10"
                    : "border-darcula-border hover:border-darcula-border-light hover:bg-darcula-bg-lighter"
                }`}
                onClick={() => onSetProvider(p)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isActive ? "bg-darcula-accent-bright" : "bg-darcula-text-muted"
                      }`}
                    />
                    <span className="text-sm font-mono text-darcula-text-bright">
                      {info.name}
                    </span>
                  </div>
                  <span className="text-2xs font-mono text-darcula-text-muted">
                    {info.dimensions}d
                  </span>
                </div>
                <p className="text-2xs font-mono text-darcula-text-muted mt-1 ml-4">
                  {info.description}
                </p>
                <div className="text-2xs font-mono text-darcula-number mt-1 ml-4">
                  Model: {info.model}
                </div>

                {/* API Key input for cloud providers */}
                {isActive && p === "gemini" && (
                  <div className="mt-2 ml-4">
                    <div className="flex items-center gap-2">
                      <input
                        type={showGeminiKey ? "text" : "password"}
                        placeholder="Gemini API Key"
                        className="flex-1 bg-darcula-bg text-darcula-text text-2xs font-mono px-2 py-1 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                        value={geminiApiKey}
                        onChange={(e) => onSetApiKey("gemini", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowGeminiKey(!showGeminiKey);
                        }}
                      >
                        {showGeminiKey ? "hide" : "show"}
                      </button>
                    </div>
                  </div>
                )}

                {isActive && p === "claude" && (
                  <div className="mt-2 ml-4">
                    <div className="flex items-center gap-2">
                      <input
                        type={showClaudeKey ? "text" : "password"}
                        placeholder="Voyage AI API Key"
                        className="flex-1 bg-darcula-bg text-darcula-text text-2xs font-mono px-2 py-1 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                        value={claudeApiKey}
                        onChange={(e) => onSetApiKey("claude", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowClaudeKey(!showClaudeKey);
                        }}
                      >
                        {showClaudeKey ? "hide" : "show"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Index Status */}
        <div className="px-4 py-3 border-t border-darcula-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xs font-mono text-darcula-text-muted">
              Index: {indexSize}/{totalPrompts} prompts embedded
            </span>
            <button
              className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
              onClick={(e) => {
                e.stopPropagation();
                onReindex();
              }}
              disabled={isIndexing}
            >
              {isIndexing ? "Indexing..." : "Rebuild Index"}
            </button>
          </div>

          {/* Progress bar */}
          {indexProgress && (
            <div className="w-full bg-darcula-bg rounded-full h-1.5 mt-2">
              <div
                className="bg-darcula-accent-bright h-1.5 rounded-full transition-all"
                style={{
                  width: `${(indexProgress.current / indexProgress.total) * 100}%`,
                }}
              />
            </div>
          )}

          {lastError && (
            <div className="text-2xs font-mono text-darcula-error mt-2">
              Error: {lastError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}