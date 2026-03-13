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

/**
 * Load all stored embeddings for a specific provider.
 *
 * Pass the provider name ("local", "gemini", or "voyage") to retrieve only
 * that provider's vectors.  Pass an empty string to retrieve every row.
 */
export async function getAllEmbeddings(provider: string = ""): Promise<StoredEmbedding[]> {
  return call<StoredEmbedding[]>("get_all_embeddings", { provider });
}

/**
 * Delete all stored embeddings for a specific provider.
 * Returns the number of rows deleted.
 */
export async function deleteEmbeddingsByProvider(provider: string): Promise<number> {
  return call<number>("delete_embeddings_by_provider", { provider });
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
  /** Whether the periodic background sync worker should run. */
  auto_sync_enabled: boolean;
  /** How often the worker uploads, in minutes (5 / 15 / 30 / 60). */
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

/**
 * Start the Google Drive OAuth 2.0 flow.
 *
 * Saves credentials, spawns a one-shot localhost:8741 callback listener,
 * and returns the Google authorization URL to open in the system browser.
 *
 * After calling this, poll `getSyncConfig()` until sync_status is "Connected".
 */
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

/**
 * Enable or disable the periodic background sync worker.
 *
 * @param enabled       Whether to run the worker.
 * @param intervalMins  Upload interval in minutes (5 / 15 / 30 / 60).
 */
export async function setAutoSync(
  enabled: boolean,
  intervalMins: number
): Promise<boolean> {
  return call<boolean>("set_auto_sync", { enabled, intervalMins });
}

// ─── Conflict Resolution ─────────────────────────────────────────

/** Returned by `getConflictInfo` when the remote DB is newer than local. */
export interface ConflictInfo {
  /** ISO 8601 timestamp of the remote file's last modification. */
  remote_modified: string;
  /** ISO 8601 timestamp of our last sync, or null if we've never synced. */
  local_last_sync: string | null;
  /** Always true when this object is returned (remote has unseen changes). */
  remote_is_newer: boolean;
}

/** Returned by `resolveConflict`. `data_replaced: true` means the local DB
 *  was overwritten with the remote and the frontend must reload all data. */
export interface ResolveResult {
  data_replaced: boolean;
}

/**
 * Check whether the remote database is newer than the local one.
 *
 * Returns `ConflictInfo` when a conflict exists, `null` when local is
 * up-to-date (or the user is not connected to Drive).
 *
 * Call this on app startup after confirming the user is connected.
 */
export async function getConflictInfo(): Promise<ConflictInfo | null> {
  return call<ConflictInfo | null>("get_conflict_info");
}

/**
 * Resolve a sync conflict.
 *
 * @param strategy
 *   - `"accept_newest"` — last-write-wins: pulls remote if it's newer,
 *     pushes local if local is newer.
 *   - `"keep_local"` — unconditionally push local, overwriting the remote.
 *
 * When `result.data_replaced` is `true`, the frontend must reload all data
 * (prompts, categories, tags) because the in-memory state is stale.
 */
export async function resolveConflict(
  strategy: "accept_newest" | "keep_local"
): Promise<ResolveResult> {
  return call<ResolveResult>("resolve_conflict", { strategy });
}