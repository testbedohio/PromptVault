import { useState, useCallback, useRef } from "react";
import {
  embed,
  cosineSimilarity,
  type EmbeddingConfig,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "./service";
import type { Prompt } from "../types";

interface EmbeddingState {
  provider: EmbeddingProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  isIndexing: boolean;
  indexProgress: { current: number; total: number } | null;
  lastError: string | null;
}

/**
 * Manages the embedding index and provides semantic search.
 *
 * Embeddings are stored in-memory for now (Phase 3).
 * Phase 4 will persist them to SQLite via the Rust backend.
 */
export function useEmbeddings() {
  const [state, setState] = useState<EmbeddingState>({
    provider: "local",
    geminiApiKey: "",
    claudeApiKey: "",
    isIndexing: false,
    indexProgress: null,
    lastError: null,
  });

  // In-memory embedding index: promptId → vector
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
    setState((s) => ({ ...s, provider, lastError: null }));
    // Clear index when switching providers (different dimensions)
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

          // Only compare if same dimensionality
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

  // ── Index a single prompt (for incremental updates) ────────────

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
      } catch (e) {
        console.error(`Failed to embed prompt ${prompt.id}:`, e);
      }
    },
    [getConfig]
  );

  const removeFromIndex = useCallback((promptId: number) => {
    indexRef.current.delete(promptId);
  }, []);

  return {
    provider: state.provider,
    geminiApiKey: state.geminiApiKey,
    claudeApiKey: state.claudeApiKey,
    isIndexing: state.isIndexing,
    indexProgress: state.indexProgress,
    lastError: state.lastError,
    indexSize: indexRef.current.size,
    setProvider,
    setApiKey,
    indexPrompts,
    semanticSearch,
    indexSinglePrompt,
    removeFromIndex,
  };
}