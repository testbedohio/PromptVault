import { useState, useCallback, useRef } from "react";
import {
  embed,
  cosineSimilarity,
  type EmbeddingConfig,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "./service";
import {
  saveEmbedding,
  getAllEmbeddings,
  deleteEmbeddingsByProvider,
  vectorSearch,
} from "../api/commands";
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
  /** True when sqlite-vec SQL search is available (set after first successful call). */
  sqlSearchAvailable: boolean;
}

/**
 * Manages the per-provider embedding index and provides semantic search.
 *
 * Search strategy (Phase 6):
 * - Primary: SQL-level cosine similarity via `vector_search` (sqlite-vec).
 *   Runs entirely in Rust/SQLite — no JS round-trip for scoring.
 * - Fallback: JS-side cosine similarity over the in-memory index.
 *   Used in browser mode or if sqlite-vec failed to load.
 *
 * Option B persistence model:
 * - Each provider ("local", "gemini", "voyage") stores its own rows in the
 *   `embeddings` table, keyed by (prompt_id, provider).
 * - On startup (or provider switch), `restoreIndex` loads only the rows for
 *   the active provider, so the in-memory index is always dimensionally
 *   consistent.
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
    sqlSearchAvailable: false,
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
    setState((s) => ({
      ...s,
      provider,
      lastError: null,
      restoreAttempted: false,
      sqlSearchAvailable: false,
    }));
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

  // ── Index Restoration (startup / provider switch) ──────────────

  const restoreIndex = useCallback(
    async (): Promise<number> => {
      setState((s) => ({ ...s, restoreAttempted: true }));

      try {
        const stored = await getAllEmbeddings(state.provider);

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

          indexRef.current.set(prompt.id, {
            vector: result.vector,
            model: result.model,
          });

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

  /**
   * Rebuild the index for the active provider from scratch.
   *
   * Wipes all stored vectors for the current provider, then re-embeds every
   * prompt.  Rows for other providers are not affected (Option B guarantee).
   */
  const rebuildIndex = useCallback(
    async (prompts: Prompt[]) => {
      try {
        await deleteEmbeddingsByProvider(state.provider);
      } catch (e) {
        console.warn("Failed to clear old embeddings before rebuild:", e);
      }
      indexRef.current.clear();
      setState((s) => ({ ...s, sqlSearchAvailable: false }));
      return indexPrompts(prompts);
    },
    [state.provider, indexPrompts]
  );

  // ── Semantic Search ────────────────────────────────────────────

  /**
   * Search for semantically similar prompts.
   *
   * Phase 6 upgrade: tries SQL-level vector search first (sqlite-vec).
   * If the extension isn't loaded or returns an error, falls back to the
   * in-memory JS cosine similarity that was used in earlier phases.
   */
  const semanticSearch = useCallback(
    async (
      query: string,
      prompts: Prompt[],
      topK: number = 10
    ): Promise<{ prompt: Prompt; score: number }[]> => {
      const config = getConfig();
      const indexSize = indexRef.current.size;

      // Need at least some embeddings stored to search
      if (indexSize === 0) {
        return [];
      }

      try {
        const queryResult = await embed(query, config);

        // ── Primary: SQL vector search ─────────────────────────
        if (state.sqlSearchAvailable || indexSize > 0) {
          try {
            const sqlResults = await vectorSearch(
              queryResult.vector,
              state.provider,
              topK
            );

            if (sqlResults.length > 0) {
              // Mark SQL search as confirmed available
              setState((s) => ({ ...s, sqlSearchAvailable: true }));

              // Map prompt_ids back to Prompt objects
              const promptMap = new Map(prompts.map((p) => [p.id, p]));
              return sqlResults
                .map((r) => ({
                  prompt: promptMap.get(r.prompt_id)!,
                  score: r.similarity,
                }))
                .filter((r) => r.prompt != null);
            }
          } catch (sqlErr) {
            // sqlite-vec not available — fall through to JS fallback
            console.debug("[PromptVault] SQL vector search unavailable, using JS fallback:", sqlErr);
            setState((s) => ({ ...s, sqlSearchAvailable: false }));
          }
        }

        // ── Fallback: JS-side cosine similarity ────────────────
        const scored: { prompt: Prompt; score: number }[] = [];

        for (const prompt of prompts) {
          const entry = indexRef.current.get(prompt.id);
          if (!entry) continue;
          if (entry.vector.length !== queryResult.vector.length) continue;

          const score = cosineSimilarity(queryResult.vector, entry.vector);
          scored.push({ prompt, score });
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, lastError: msg }));
        return [];
      }
    },
    [getConfig, state.provider, state.sqlSearchAvailable]
  );

  // ── Index a single prompt (incremental updates) ────────────────

  const indexSinglePrompt = useCallback(
    async (prompt: Prompt) => {
      const config = getConfig();
      try {
        const text = `${prompt.title}\n${prompt.content}`;
        const result = await embed(text, config);

        indexRef.current.set(prompt.id, {
          vector: result.vector,
          model: result.model,
        });

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
    // DB row cleaned up automatically via ON DELETE CASCADE
  }, []);

  return {
    provider: state.provider,
    geminiApiKey: state.geminiApiKey,
    claudeApiKey: state.claudeApiKey,
    isIndexing: state.isIndexing,
    indexProgress: state.indexProgress,
    lastError: state.lastError,
    restoreAttempted: state.restoreAttempted,
    sqlSearchAvailable: state.sqlSearchAvailable,
    indexSize: indexRef.current.size,
    setProvider,
    setApiKey,
    restoreIndex,
    indexPrompts,
    rebuildIndex,
    semanticSearch,
    indexSinglePrompt,
    removeFromIndex,
  };
}
