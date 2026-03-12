/**
 * Embeddings Service — Phase 3
 *
 * Provides a unified interface for generating text embeddings via:
 * - Local: Transformers.js (ONNX/Wasm, runs entirely in-browser)
 * - Cloud/Gemini: Google Gemini Embedding API
 * - Cloud/Claude: Anthropic Voyage embeddings (Claude ecosystem)
 *
 * The "Brain" selector in the UI toggles between providers.
 */

export type EmbeddingProvider = "local" | "gemini" | "claude";

export interface EmbeddingResult {
  vector: number[];
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  geminiApiKey?: string;
  claudeApiKey?: string;
}

// ─── Local Embeddings (Transformers.js) ──────────────────────────

let localPipeline: any = null;
let localLoading = false;

async function getLocalPipeline() {
  if (localPipeline) return localPipeline;
  if (localLoading) {
    // Wait for existing load
    while (localLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return localPipeline;
  }

  localLoading = true;
  try {
    // Dynamic import — Transformers.js is loaded on demand
    const { pipeline } = await import("@xenova/transformers");
    localPipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { quantized: true }
    );
    return localPipeline;
  } finally {
    localLoading = false;
  }
}

async function embedLocal(text: string): Promise<EmbeddingResult> {
  const pipe = await getLocalPipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  const vector = Array.from(result.data as Float32Array);

  return {
    vector,
    provider: "local",
    model: "all-MiniLM-L6-v2",
    dimensions: vector.length, // 384
  };
}

// ─── Gemini Embeddings ───────────────────────────────────────────

async function embedGemini(
  text: string,
  apiKey: string
): Promise<EmbeddingResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini embedding failed: ${err}`);
  }

  const data = await response.json();
  const vector: number[] = data.embedding.values;

  return {
    vector,
    provider: "gemini",
    model: "text-embedding-004",
    dimensions: vector.length, // 768
  };
}

// ─── Claude/Voyage Embeddings ────────────────────────────────────

async function embedClaude(
  text: string,
  apiKey: string
): Promise<EmbeddingResult> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "voyage-3-lite",
      input: [text],
      input_type: "document",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage embedding failed: ${err}`);
  }

  const data = await response.json();
  const vector: number[] = data.data[0].embedding;

  return {
    vector,
    provider: "claude",
    model: "voyage-3-lite",
    dimensions: vector.length, // 512
  };
}

// ─── Unified Embed Function ─────────────────────────────────────

export async function embed(
  text: string,
  config: EmbeddingConfig
): Promise<EmbeddingResult> {
  // Truncate very long texts (embedding models have token limits)
  const truncated = text.slice(0, 8000);

  switch (config.provider) {
    case "local":
      return embedLocal(truncated);

    case "gemini":
      if (!config.geminiApiKey) {
        throw new Error("Gemini API key not configured");
      }
      return embedGemini(truncated, config.geminiApiKey);

    case "claude":
      if (!config.claudeApiKey) {
        throw new Error("Voyage API key not configured");
      }
      return embedClaude(truncated, config.claudeApiKey);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// ─── Cosine Similarity ──────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ─── Check Provider Availability ─────────────────────────────────

export function isProviderAvailable(config: EmbeddingConfig): boolean {
  switch (config.provider) {
    case "local":
      return true; // Always available (Wasm)
    case "gemini":
      return !!config.geminiApiKey;
    case "claude":
      return !!config.claudeApiKey;
    default:
      return false;
  }
}

export function getProviderInfo(provider: EmbeddingProvider) {
  const info = {
    local: {
      name: "Local (Offline)",
      model: "all-MiniLM-L6-v2",
      dimensions: 384,
      description: "Runs entirely in your browser via WebAssembly. No data leaves your machine.",
      requiresKey: false,
    },
    gemini: {
      name: "Google Gemini",
      model: "text-embedding-004",
      dimensions: 768,
      description: "Google's latest embedding model. Requires API key.",
      requiresKey: true,
    },
    claude: {
      name: "Voyage AI (Claude)",
      model: "voyage-3-lite",
      dimensions: 512,
      description: "Anthropic ecosystem embeddings via Voyage AI. Requires API key.",
      requiresKey: true,
    },
  };
  return info[provider];
}