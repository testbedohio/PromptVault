import { invoke } from "@tauri-apps/api/core";
import type {
  ApiResult,
  Category,
  Prompt,
  PromptVersion,
  Tag,
  CreatePromptInput,
  UpdatePromptInput,
} from "../types";

// ─── Helpers ─────────────────────────────────────────────────────

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await invoke<ApiResult<T>>(command, args);
  if (!result.success || result.data === null) {
    throw new Error(result.error ?? `Command "${command}" failed`);
  }
  return result.data;
}

// ─── Categories ──────────────────────────────────────────────────

export async function getCategories(): Promise<Category[]> {
  return call<Category[]>("get_categories");
}

export async function createCategory(
  name: string,
  parentId: number | null = null
): Promise<Category> {
  return call<Category>("create_category", { name, parentId });
}

// ─── Prompts ─────────────────────────────────────────────────────

export async function getPrompts(): Promise<Prompt[]> {
  return call<Prompt[]>("get_prompts");
}

export async function getPromptById(id: number): Promise<Prompt> {
  return call<Prompt>("get_prompt_by_id", { id });
}

export async function createPrompt(input: CreatePromptInput): Promise<Prompt> {
  return call<Prompt>("create_prompt", { input });
}

export async function updatePrompt(input: UpdatePromptInput): Promise<Prompt> {
  return call<Prompt>("update_prompt", { input });
}

export async function deletePrompt(id: number): Promise<boolean> {
  return call<boolean>("delete_prompt", { id });
}

// ─── Versions ────────────────────────────────────────────────────

export async function getPromptVersions(promptId: number): Promise<PromptVersion[]> {
  return call<PromptVersion[]>("get_prompt_versions", { promptId });
}

// ─── Tags ────────────────────────────────────────────────────────

export async function getAllTags(): Promise<Tag[]> {
  return call<Tag[]>("get_all_tags");
}

// ─── Search ──────────────────────────────────────────────────────

export async function searchPrompts(query: string): Promise<Prompt[]> {
  return call<Prompt[]>("search_prompts", { query });
}

// ─── Embeddings ──────────────────────────────────────────────────

export interface StoredEmbedding {
  prompt_id: number;
  vector: number[];
  model: string;
  provider: string;
}

export async function saveEmbedding(
  promptId: number,
  vector: number[],
  model: string,
  provider: string
): Promise<boolean> {
  return call<boolean>("save_embedding", { promptId, vector, model, provider });
}

export async function getAllEmbeddings(provider: string = ""): Promise<StoredEmbedding[]> {
  return call<StoredEmbedding[]>("get_all_embeddings", { provider });
}

export async function deleteEmbeddingsByProvider(provider: string): Promise<number> {
  return call<number>("delete_embeddings_by_provider", { provider });
}

// ─── Vector Search (Phase 6) ─────────────────────────────────────

export interface VectorSearchResult {
  /** ID of the matching prompt. */
  prompt_id: number;
  /** Cosine similarity in [0, 1] — higher is more similar. */
  similarity: number;
}

/**
 * Rust-side cosine similarity search over stored embeddings.
 *
 * Scoring runs entirely in Rust (no JS round-trip for each vector),
 * scoped to `provider` so dimension-mismatched vectors are never compared.
 *
 * Returns up to `topK` results sorted by similarity descending.
 * Returns an empty array (not an error) when no embeddings are stored.
 */
export async function vectorSearch(
  vector: number[],
  provider: string,
  topK: number = 10
): Promise<VectorSearchResult[]> {
  return call<VectorSearchResult[]>("vector_search", { vector, provider, topK });
}

// ─── Export ──────────────────────────────────────────────────────

/**
 * Export a single prompt as a Markdown string with YAML front-matter.
 *
 * The returned string is ready to write to a `.md` file. The caller is
 * responsible for triggering the browser download (e.g. via a Blob URL).
 */
export async function exportPromptMarkdown(id: number): Promise<string> {
  return call<string>("export_prompt_markdown", { id });
}

/**
 * Export prompts as a JSON array string.
 *
 * Pass an empty array to export every prompt, or a list of IDs to export
 * a specific subset. The caller triggers the download.
 */
export async function exportPromptsJson(ids: number[] = []): Promise<string> {
  return call<string>("export_prompts_json", { ids });
}

/**
 * Trigger a browser file download with the given content and filename.
 * Works in both Tauri (via Blob) and browser-mode.
 */
export function downloadFile(content: string, filename: string, mimeType: string = "text/plain"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sync ────────────────────────────────────────────────────────

export interface SyncConfig {
  enabled: boolean;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: number | null;
  remote_file_id: string | null;
  last_sync: string | null;
  sync_status: string | { Error: string };
  auto_sync_enabled: boolean;
  auto_sync_interval_mins: number;
}

export function isSyncConnected(config: SyncConfig): boolean {
  return config.sync_status === "Connected" || config.sync_status === "Synced";
}

export function isSyncError(config: SyncConfig): boolean {
  return (
    typeof config.sync_status === "object" && "Error" in config.sync_status
  );
}

export function getSyncStatusLabel(config: SyncConfig): string {
  if (typeof config.sync_status === "object" && "Error" in config.sync_status) {
    return `Error: ${config.sync_status.Error}`;
  }
  return String(config.sync_status);
}

export async function startOAuthFlow(
  clientId: string,
  clientSecret: string
): Promise<string> {
  return call<string>("start_oauth_flow", { clientId, clientSecret });
}

export async function getSyncConfig(): Promise<SyncConfig> {
  return call<SyncConfig>("get_sync_config");
}

export async function updateSyncConfig(config: SyncConfig): Promise<boolean> {
  return call<boolean>("update_sync_config", { config });
}

export async function getAuthUrl(): Promise<string> {
  return call<string>("get_auth_url");
}

export async function exchangeAuthCode(code: string): Promise<boolean> {
  return call<boolean>("exchange_auth_code", { code });
}

export async function syncToDrive(): Promise<boolean> {
  return call<boolean>("sync_to_drive");
}

export async function checkSyncStatus(): Promise<string | null> {
  return call<string | null>("check_sync_status");
}

export async function setAutoSync(
  enabled: boolean,
  intervalMins: number
): Promise<boolean> {
  return call<boolean>("set_auto_sync", { enabled, intervalMins });
}

// ─── Conflict Resolution ─────────────────────────────────────────

export interface ConflictInfo {
  remote_modified: string;
  local_last_sync: string | null;
  remote_is_newer: boolean;
}

export interface ResolveResult {
  data_replaced: boolean;
}

export async function getConflictInfo(): Promise<ConflictInfo | null> {
  return call<ConflictInfo | null>("get_conflict_info");
}

export async function resolveConflict(
  strategy: "accept_newest" | "keep_local"
): Promise<ResolveResult> {
  return call<ResolveResult>("resolve_conflict", { strategy });
}

// ─── Encryption ──────────────────────────────────────────────────

export interface DbLockStatus {
  encrypted: boolean;
  unlocked: boolean;
}

export async function getDbLockStatus(): Promise<DbLockStatus> {
  return call<DbLockStatus>("get_db_lock_status");
}

export async function unlockDatabase(password: string): Promise<boolean> {
  return call<boolean>("unlock_database", { password });
}

export async function setDbPassword(
  current: string | null,
  newPassword: string | null
): Promise<boolean> {
  return call<boolean>("set_db_password", { current, newPassword });
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────

/**
 * The set of configurable keyboard shortcut action keys.
 *
 * Values are human-readable accelerator strings like "Ctrl+K".
 * Defaults mirror the original hardcoded values so no user action is needed.
 */
export interface ShortcutMap {
  commandPalette: string;
  newPrompt: string;
  brainSelector: string;
  syncPanel: string;
  shortcuts: string;
}

/** Fetch the current shortcut map from disk (merges saved + defaults). */
export async function getShortcuts(): Promise<ShortcutMap> {
  return call<ShortcutMap>("get_shortcuts");
}

/**
 * Update a single shortcut.
 *
 * Pass an empty string for `accelerator` to reset the action to its default.
 */
export async function setShortcut(
  action: keyof ShortcutMap,
  accelerator: string
): Promise<boolean> {
  return call<boolean>("set_shortcut", { action, accelerator });
}

/** Reset all shortcuts to their defaults and return the new map. */
export async function resetShortcuts(): Promise<ShortcutMap> {
  return call<ShortcutMap>("reset_shortcuts");
}