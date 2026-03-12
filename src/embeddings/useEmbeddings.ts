import { useState, useCallback, useRef } from "react";
import {
  embed,
  cosineSimilarity,
  getProviderInfo,
  type EmbeddingConfig,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "./service";
import { saveEmbedding, getAllEmbeddings } from "../api/commands";
import type { Prompt } from "../types";

interface EmbeddingState {
  provider: EmbeddingProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  isIndexing: boolean;
  indexProgress: { current: number; total: number } | null;
  lastError: string | null;
  /** True once restoreIndex has been called (even if it found nothing). */
  restoreAttempted: boolean;
}

/**
 * Manages the embedding index and provides semantic search.
 *
 * Phase 5 additions:
 * - `restoreIndex`: loads persisted embeddings from SQLite on startup so the
 *   index survives app restarts without a full re-embed.
 * - `indexPrompts` / `indexSinglePrompt` now call `saveEmbedding` after each
 *   successful embed so vectors are immediately persisted to SQLite.
 */
export function useEmbeddings() {
  const [state, setState] = useState<EmbeddingState>({
    provider: "local",
    geminiApiKey: "",
    claudeApiKey: "",
    isIndexing: false,
    indexProgress: null,
    lastError: null,
    restoreAttempted: false,
  });

  // In-memory embedding index: promptId → { vector, model }
  const indexRef = useRef<Map<number, { vector: number[]; model: string }>>(
    new Map()
  );

  const getConfig = useCallback((): EmbeddingConfig => {
    return {
      provider: state.provider,
      geminiApiKey: state.geminiApiKey || undefined,
      claudeApiKey: state.claudeApiKey || undefined,
    };
  }, [state.provider, state.geminiApiKey, state.claudeApiKey]);

  // ── Provider Settings ──────────────────────────────────────────

  const setProvider = useCallback((provider: EmbeddingProvider) => {
    setState((s) => ({ ...s, provider, lastError: null, restoreAttempted: false }));
    // Clear in-memory index when switching providers (different dimensions).
    // restoreIndex will reload the matching stored embeddings if they exist.
    indexRef.current.clear();
  }, []);

  const setApiKey = useCallback(
    (provider: "gemini" | "claude", key: string) => {
      setState((s) => ({
        ...s,
        ...(provider === "gemini"
          ? { geminiApiKey: key }
          : { claudeApiKey: key }),
        lastError: null,
      }));
    },
    []
  );

  // ── Index Restoration (startup) ────────────────────────────────

  /**
   * Restore the in-memory index from SQLite.
   *
   * Call this once after prompts have loaded (or after switching providers).
   * Filters stored embeddings to the current provider's model so vectors from
   * a different model/dimension are never mixed into the index.
   *
   * Returns the number of embeddings successfully restored.
   * Silently no-ops in browser mode (when Tauri isn't available).
   */
  const restoreIndex = useCallback(
    async (): Promise<number> => {
      // Mark restore as attempted regardless of outcome
      setState((s) => ({ ...s, restoreAttempted: true }));

      try {
        const providerInfo = getProviderInfo(state.provider);
        const stored = await getAllEmbeddings(providerInfo.model);

        let count = 0;
        for (const entry of stored) {
          if (entry.vector.length > 0) {
            indexRef.current.set(entry.prompt_id, {
              vector: entry.vector,
              model: entry.model,
            });
            count++;
          }
        }

        return count;
      } catch {
        // In browser mode (no Tauri), getAllEmbeddings will throw — that's fine.
        // The index simply starts empty and the user can build it via BrainSelector.
        return 0;
      }
    },
    [state.provider]
  );

  // ── Indexing ───────────────────────────────────────────────────

  const indexPrompts = useCallback(
    async (prompts: Prompt[]) => {
      setState((s) => ({
        ...s,
        isIndexing: true,
        indexProgress: { current: 0, total: prompts.length },
        lastError: null,
      }));

      const config = getConfig();
      let indexed = 0;

      for (const prompt of prompts) {
        try {
          const text = `${prompt.title}\n${prompt.content}`;
          const result: EmbeddingResult = await embed(text, config);

          // Update in-memory index
          indexRef.current.set(prompt.id, {
            vector: result.vector,
            model: result.model,
          });

          // Persist to SQLite (fire-and-forget; don't block indexing on DB write)
          saveEmbedding(prompt.id, result.vector, result.model, result.provider).catch(
            (e) => console.warn(`Failed to persist embedding for prompt ${prompt.id}:`, e)
          );

          indexed++;
          setState((s) => ({
            ...s,
            indexProgress: { current: indexed, total: prompts.length },
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`Failed to embed prompt ${prompt.id}:`, msg);
          setState((s) => ({ ...s, lastError: msg }));
          break;
        }
      }

      setState((s) => ({
        ...s,
        isIndexing: false,
        indexProgress: null,
      }));

      return indexed;
    },
    [getConfig]
  );

  // ── Semantic Search ────────────────────────────────────────────

  const semanticSearch = useCallback(
    async (
      query: string,
      prompts: Prompt[],
      topK: number = 10
    ): Promise<{ prompt: Prompt; score: number }[]> => {
      if (indexRef.current.size === 0) {
        return [];
      }

      const config = getConfig();

      try {
        const queryResult = await embed(query, config);

        const scored: { prompt: Prompt; score: number }[] = [];

        for (const prompt of prompts) {
          const entry = indexRef.current.get(prompt.id);
          if (!entry) continue;

          // Only compare vectors of the same dimensionality
          if (entry.vector.length !== queryResult.vector.length) continue;

          const score = cosineSimilarity(queryResult.vector, entry.vector);
          scored.push({ prompt, score });
        }

        // Sort by similarity descending
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, lastError: msg }));
        return [];
      }
    },
    [getConfig]
  );

  // ── Index a single prompt (incremental updates) ────────────────

  const indexSinglePrompt = useCallback(
    async (prompt: Prompt) => {
      const config = getConfig();
      try {
        const text = `${prompt.title}\n${prompt.content}`;
        const result = await embed(text, config);

        // Update in-memory index
        indexRef.current.set(prompt.id, {
          vector: result.vector,
          model: result.model,
        });

        // Persist to SQLite
        saveEmbedding(prompt.id, result.vector, result.model, result.provider).catch(
          (e) => console.warn(`Failed to persist embedding for prompt ${prompt.id}:`, e)
        );
      } catch (e) {
        console.error(`Failed to embed prompt ${prompt.id}:`, e);
      }
    },
    [getConfig]
  );

  const removeFromIndex = useCallback((promptId: number) => {
    indexRef.current.delete(promptId);
    // Note: the DB row is cleaned up automatically via ON DELETE CASCADE
    // when the prompt is deleted, so no explicit delete call needed here.
  }, []);

  return {
    provider: state.provider,
    geminiApiKey: state.geminiApiKey,
    claudeApiKey: state.claudeApiKey,
    isIndexing: state.isIndexing,
    indexProgress: state.indexProgress,
    lastError: state.lastError,
    restoreAttempted: state.restoreAttempted,
    indexSize: indexRef.current.size,
    setProvider,
    setApiKey,
    restoreIndex,
    indexPrompts,
    semanticSearch,
    indexSinglePrompt,
    removeFromIndex,
  };
}