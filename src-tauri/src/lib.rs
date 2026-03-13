mod db;
mod sync;

use db::{Database, Prompt, PromptVersion, Category, Tag, StoredEmbedding};
use sync::{DriveSync, SyncConfig, SyncStatus};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::{watch, Mutex as TokioMutex};
use tokio::time::{sleep, Duration};
use tauri::State;

// ─── Background Sync Worker ───────────────────────────────────────────────────

/// Controls sent to the background sync worker via a watch channel.
/// Cloning is cheap — it's just two primitives.
#[derive(Clone, Debug)]
struct SyncWorkerCtl {
    /// Mirror of SyncConfig.auto_sync_enabled — when false the worker idles.
    enabled: bool,
    /// Mirror of SyncConfig.auto_sync_interval_mins converted to seconds.
    interval_secs: u64,
}

/// Long-lived background task that periodically uploads the database to Drive.
///
/// Design:
///   - Runs for the entire lifetime of the app (never exits unless the channel
///     drops, which only happens on app shutdown).
///   - Uses `tokio::select!` so config changes (via the watch channel) wake it
///     immediately, even while sleeping between sync cycles.
///   - Only uploads when both:
///       1. The worker is `enabled` (user toggled auto-sync on), AND
///       2. The DriveSync config shows Connected or Synced status.
///   - Errors are logged to stderr but never crash the worker loop.
async fn run_sync_worker(
    sync: Arc<TokioMutex<DriveSync>>,
    db_path: String,
    mut ctl_rx: watch::Receiver<SyncWorkerCtl>,
) {
    loop {
        // Take a snapshot of the current control values
        let ctl = ctl_rx.borrow().clone();

        if !ctl.enabled || ctl.interval_secs == 0 {
            // Idle: wait until the config changes before re-evaluating
            if ctl_rx.changed().await.is_err() {
                break; // Channel dropped → app shutting down
            }
            continue;
        }

        // Active: sleep for the configured interval, but wake early on config change
        let sleep_fut = sleep(Duration::from_secs(ctl.interval_secs));
        tokio::select! {
            _ = sleep_fut => {
                // Interval elapsed — attempt a sync if the conditions are right
                let mut sync_guard = sync.lock().await;
                let status = sync_guard.get_config().sync_status.clone();
                let is_ready = matches!(status, SyncStatus::Connected | SyncStatus::Synced);

                if is_ready {
                    if let Err(e) = sync_guard.upload_db(&db_path).await {
                        eprintln!("[PromptVault] Background sync failed: {}", e);
                    }
                }
            }
            _ = ctl_rx.changed() => {
                // Config changed mid-sleep — loop back to re-read the new values
                // without syncing (the timer resets)
                continue;
            }
        }
    }
}

// ─── App State ────────────────────────────────────────────────────────────────

/// Shared application state managed by Tauri.
///
/// `db`   — std::sync::Mutex  (synchronous commands only, never held across .await)
/// `sync` — Arc<tokio::sync::Mutex> so the Arc can be cloned into spawned tasks
/// `db_path` — captured once at startup to avoid re-locking `db` in the worker
/// `sync_worker_tx` — watch sender for updating the background worker's config
///                    without stopping/restarting it
struct AppState {
    db: StdMutex<Database>,
    sync: Arc<TokioMutex<DriveSync>>,
    db_path: String,
    sync_worker_tx: Arc<watch::Sender<SyncWorkerCtl>>,
}

// ─── Response Wrappers ───────────────────────────────────────────

#[derive(Serialize)]
struct ApiResult<T: Serialize> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

fn ok<T: Serialize>(data: T) -> ApiResult<T> {
    ApiResult { success: true, data: Some(data), error: None }
}

fn err<T: Serialize>(msg: &str) -> ApiResult<T> {
    ApiResult { success: false, data: None, error: Some(msg.to_string()) }
}

// ─── Tauri Commands ──────────────────────────────────────────────

// -- Categories --

#[tauri::command]
fn get_categories(state: State<AppState>) -> ApiResult<Vec<Category>> {
    match state.db.lock().unwrap().get_categories() {
        Ok(cats) => ok(cats),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn create_category(name: String, parent_id: Option<i64>, state: State<AppState>) -> ApiResult<Category> {
    match state.db.lock().unwrap().create_category(&name, parent_id) {
        Ok(cat) => ok(cat),
        Err(e) => err(&e.to_string()),
    }
}

// -- Prompts --

#[tauri::command]
fn get_prompts(state: State<AppState>) -> ApiResult<Vec<Prompt>> {
    match state.db.lock().unwrap().get_prompts() {
        Ok(prompts) => ok(prompts),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn get_prompt_by_id(id: i64, state: State<AppState>) -> ApiResult<Prompt> {
    match state.db.lock().unwrap().get_prompt_by_id(id) {
        Ok(prompt) => ok(prompt),
        Err(e) => err(&e.to_string()),
    }
}

#[derive(Deserialize)]
struct CreatePromptInput {
    title: String,
    content: String,
    category_id: Option<i64>,
    tags: Vec<String>,
}

#[tauri::command]
fn create_prompt(input: CreatePromptInput, state: State<AppState>) -> ApiResult<Prompt> {
    let db = state.db.lock().unwrap();
    match db.create_prompt(&input.title, &input.content, input.category_id, &input.tags) {
        Ok(prompt) => ok(prompt),
        Err(e) => err(&e.to_string()),
    }
}

#[derive(Deserialize)]
struct UpdatePromptInput {
    id: i64,
    title: Option<String>,
    content: Option<String>,
    category_id: Option<i64>,
    tags: Option<Vec<String>>,
}

#[tauri::command]
fn update_prompt(input: UpdatePromptInput, state: State<AppState>) -> ApiResult<Prompt> {
    let db = state.db.lock().unwrap();
    match db.update_prompt(input.id, input.title.as_deref(), input.content.as_deref(), input.category_id, input.tags.as_deref()) {
        Ok(prompt) => ok(prompt),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn delete_prompt(id: i64, state: State<AppState>) -> ApiResult<bool> {
    match state.db.lock().unwrap().delete_prompt(id) {
        Ok(_) => ok(true),
        Err(e) => err(&e.to_string()),
    }
}

// -- Version History --

#[tauri::command]
fn get_prompt_versions(prompt_id: i64, state: State<AppState>) -> ApiResult<Vec<PromptVersion>> {
    match state.db.lock().unwrap().get_prompt_versions(prompt_id) {
        Ok(versions) => ok(versions),
        Err(e) => err(&e.to_string()),
    }
}

// -- Tags --

#[tauri::command]
fn get_all_tags(state: State<AppState>) -> ApiResult<Vec<Tag>> {
    match state.db.lock().unwrap().get_all_tags() {
        Ok(tags) => ok(tags),
        Err(e) => err(&e.to_string()),
    }
}

// -- Search --

#[tauri::command]
fn search_prompts(query: String, state: State<AppState>) -> ApiResult<Vec<Prompt>> {
    match state.db.lock().unwrap().search_prompts(&query) {
        Ok(prompts) => ok(prompts),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Embedding Commands ──────────────────────────────────────────

#[tauri::command]
fn save_embedding(
    prompt_id: i64,
    vector: Vec<f32>,
    model: String,
    provider: String,
    state: State<AppState>,
) -> ApiResult<bool> {
    match state.db.lock().unwrap().save_embedding(prompt_id, &vector, &model, &provider) {
        Ok(_) => ok(true),
        Err(e) => err(&e.to_string()),
    }
}

/// Load all stored embeddings for a specific provider.
///
/// Pass the provider name ("local", "gemini", or "voyage") to retrieve only
/// that provider's vectors.  Pass an empty string to retrieve every row.
#[tauri::command]
fn get_all_embeddings(provider: String, state: State<AppState>) -> ApiResult<Vec<StoredEmbedding>> {
    let filter = if provider.is_empty() { None } else { Some(provider.as_str()) };
    match state.db.lock().unwrap().get_all_embeddings(filter) {
        Ok(embeddings) => ok(embeddings),
        Err(e) => err(&e.to_string()),
    }
}

/// Delete all stored embeddings for a specific provider.
///
/// Called by the BrainSelector "Rebuild Index" button to wipe stale vectors
/// for the active provider before re-indexing.  Other providers are untouched.
#[tauri::command]
fn delete_embeddings_by_provider(provider: String, state: State<AppState>) -> ApiResult<usize> {
    match state.db.lock().unwrap().delete_embeddings_by_provider(&provider) {
        Ok(count) => ok(count),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Sync Commands ───────────────────────────────────────────────

/// Start the full Google Drive OAuth 2.0 flow.
///
/// 1. Saves the provided credentials to disk.
/// 2. Builds and returns the Google authorization URL (so the frontend can open
///    it in the system browser).
/// 3. Spawns a background task that binds localhost:8741, waits for the Google
///    redirect (up to 3 minutes), extracts the code, exchanges it for tokens,
///    and persists the Connected state — all without any further frontend input.
///
/// The frontend should poll `get_sync_config` after calling this command until
/// `sync_status` changes from Disconnected to Connected (or Error).
#[tauri::command]
async fn start_oauth_flow(
    client_id: String,
    client_secret: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<String>, ()> {
    // Save credentials and build auth URL
    let auth_url = {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.client_id = client_id;
        config.client_secret = client_secret;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
        match sync.get_auth_url() {
            Ok(url) => url,
            Err(e) => return Ok(err(&e)),
        }
    };

    // Clone the Arc so the spawned task can access DriveSync independently
    let sync_arc = Arc::clone(&state.sync);

    tokio::spawn(async move {
        match sync::await_oauth_callback().await {
            Ok(code) => {
                let mut sync = sync_arc.lock().await;
                if let Err(e) = sync.exchange_code(&code).await {
                    let mut config = sync.get_config().clone();
                    config.sync_status = SyncStatus::Error(e.clone());
                    sync.update_config(config).ok();
                    eprintln!("[PromptVault] OAuth exchange failed: {}", e);
                }
            }
            Err(e) => {
                let mut sync = sync_arc.lock().await;
                let mut config = sync.get_config().clone();
                config.sync_status = SyncStatus::Error(e.clone());
                sync.update_config(config).ok();
                eprintln!("[PromptVault] OAuth callback error: {}", e);
            }
        }
    });

    Ok(ok(auth_url))
}

#[tauri::command]
async fn get_sync_config(state: State<'_, AppState>) -> Result<ApiResult<SyncConfig>, ()> {
    let sync = state.sync.lock().await;
    Ok(ok(sync.get_config().clone()))
}

#[tauri::command]
async fn update_sync_config(config: SyncConfig, state: State<'_, AppState>) -> Result<ApiResult<bool>, ()> {
    let mut sync = state.sync.lock().await;
    match sync.update_config(config) {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn get_auth_url(state: State<'_, AppState>) -> Result<ApiResult<String>, ()> {
    let sync = state.sync.lock().await;
    match sync.get_auth_url() {
        Ok(url) => Ok(ok(url)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn exchange_auth_code(code: String, state: State<'_, AppState>) -> Result<ApiResult<bool>, ()> {
    let mut sync = state.sync.lock().await;
    match sync.exchange_code(&code).await {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn sync_to_drive(state: State<'_, AppState>) -> Result<ApiResult<bool>, ()> {
    let db_path = state.db_path.clone();
    let mut sync = state.sync.lock().await;
    match sync.upload_db(&db_path).await {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn check_sync_status(state: State<'_, AppState>) -> Result<ApiResult<Option<String>>, ()> {
    let sync = state.sync.lock().await;
    match sync.check_remote_status().await {
        Ok(modified) => Ok(ok(modified)),
        Err(e) => Ok(err(&e)),
    }
}

/// Enable or disable the periodic background sync worker.
///
/// This command:
///   1. Updates `auto_sync_enabled` and `auto_sync_interval_mins` in the
///      persisted SyncConfig (so the setting survives restarts).
///   2. Sends the updated control values through the watch channel so the
///      already-running worker reacts immediately — no restart required.
///
/// `interval_mins` must be one of [5, 15, 30, 60].  Values outside this
/// range are clamped to 5 on the worker side (the frontend enforces the
/// allowed values, but we defensively clamp here as well).
#[tauri::command]
async fn set_auto_sync(
    enabled: bool,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ApiResult<bool>, ()> {
    // Clamp interval to a sane range
    let interval_mins = interval_mins.max(1).min(60);

    // Persist the setting
    {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.auto_sync_enabled = enabled;
        config.auto_sync_interval_mins = interval_mins;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
    }

    // Signal the live worker (non-blocking — watch::Sender::send always succeeds
    // as long as at least one Receiver exists, which the worker holds for the
    // app lifetime)
    let _ = state.sync_worker_tx.send(SyncWorkerCtl {
        enabled,
        interval_secs: (interval_mins as u64) * 60,
    });

    Ok(ok(true))
}

// ─── Conflict Resolution Commands ────────────────────────────────────────────

/// Describes the sync state when the remote database may be newer than local.
/// Returned by `get_conflict_info`; `None` means no conflict (or not connected).
#[derive(Serialize)]
struct ConflictInfo {
    /// ISO 8601 timestamp of the remote file's last modification.
    remote_modified: String,
    /// ISO 8601 timestamp of the last successful local→remote sync (`last_sync`).
    /// `None` if this device has never synced.
    local_last_sync: Option<String>,
    /// True when `remote_modified > local_last_sync` (remote has changes we haven't seen).
    remote_is_newer: bool,
}

/// Check whether the remote database is newer than the local one.
///
/// Returns `Some(ConflictInfo)` when:
///   - The user is connected to Google Drive, AND
///   - A remote file ID is stored, AND
///   - The remote `modifiedTime` is newer than `last_sync`
///
/// Returns `None` in all other cases (not connected, first sync, network error).
/// The frontend should call this on startup when Drive is connected.
#[tauri::command]
async fn get_conflict_info(state: State<'_, AppState>) -> Result<ApiResult<Option<ConflictInfo>>, ()> {
    let sync = state.sync.lock().await;
    let config = sync.get_config();

    // Only relevant when connected and a remote file exists
    if config.remote_file_id.is_none() {
        return Ok(ok(None));
    }
    if !matches!(config.sync_status, SyncStatus::Connected | SyncStatus::Synced | SyncStatus::Conflict) {
        return Ok(ok(None));
    }

    let remote_modified = match sync.check_remote_status().await {
        Ok(Some(t)) => t,
        Ok(None) => return Ok(ok(None)),
        Err(_) => return Ok(ok(None)), // Network error — skip silently on startup
    };

    let local_last_sync = config.last_sync.clone();

    // Parse both timestamps and compare.  If we've never synced, the remote is
    // always considered newer (the user should decide whether to pull it down).
    let remote_is_newer = match &local_last_sync {
        None => true,
        Some(last) => {
            let remote_ts = DateTime::parse_from_rfc3339(&remote_modified).ok();
            let local_ts  = DateTime::parse_from_rfc3339(last).ok();
            match (remote_ts, local_ts) {
                (Some(r), Some(l)) => r > l,
                _ => false, // Unparseable timestamps — don't force a conflict
            }
        }
    };

    if !remote_is_newer {
        return Ok(ok(None)); // Local is up-to-date; no conflict
    }

    Ok(ok(Some(ConflictInfo {
        remote_modified,
        local_last_sync,
        remote_is_newer,
    })))
}

/// Resolve a sync conflict.
///
/// `strategy` must be one of:
///   - `"accept_newest"` — download remote and restore it into the live
///     connection if it is newer; otherwise upload local.  Implements the
///     last-write-wins policy the user requested.
///   - `"keep_local"` — unconditionally upload local, overwriting the remote.
///
/// After a successful "accept_newest" where the remote was pulled down, the
/// frontend should reload all data (`getPrompts`, `getCategories`, etc.) because
/// the in-memory state is now stale.  The return value includes a
/// `data_replaced` flag that signals when a reload is required.
#[derive(Serialize)]
struct ResolveResult {
    /// True when the local DB was replaced with the remote — frontend must reload.
    data_replaced: bool,
}

#[tauri::command]
async fn resolve_conflict(
    strategy: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<ResolveResult>, ()> {
    let db_path = state.db_path.clone();

    match strategy.as_str() {
        "accept_newest" => {
            // 1. Fetch remote modifiedTime
            let remote_modified = {
                let sync = state.sync.lock().await;
                match sync.check_remote_status().await {
                    Ok(Some(t)) => t,
                    Ok(None) => return Ok(err("No remote file found")),
                    Err(e) => return Ok(err(&e)),
                }
            };

            // 2. Compare against local last_sync
            let local_last_sync = {
                let sync = state.sync.lock().await;
                sync.get_config().last_sync.clone()
            };

            let remote_is_newer = match &local_last_sync {
                None => true,
                Some(last) => {
                    let r = DateTime::parse_from_rfc3339(&remote_modified).ok();
                    let l = DateTime::parse_from_rfc3339(last).ok();
                    matches!((r, l), (Some(rv), Some(lv)) if rv > lv)
                }
            };

            if remote_is_newer {
                // 3a. Download remote to a temp file
                let incoming_path = db_path.replace("prompt_vault.db", "prompt_vault_incoming.db");

                {
                    let mut sync = state.sync.lock().await;
                    if let Err(e) = sync.download_db(&incoming_path).await {
                        return Ok(err(&e));
                    }
                }

                // 3b. Restore into the live connection (backup API, no re-open needed)
                {
                    let mut db = state.db.lock().unwrap();
                    if let Err(e) = db.restore_from(&incoming_path) {
                        // Clean up temp file even on failure
                        let _ = std::fs::remove_file(&incoming_path);
                        return Ok(err(&format!("Restore failed: {}", e)));
                    }
                }

                // 3c. Clean up temp file
                let _ = std::fs::remove_file(&incoming_path);

                // 3d. Update last_sync and status so we don't re-trigger the conflict
                {
                    let mut sync = state.sync.lock().await;
                    let mut config = sync.get_config().clone();
                    config.last_sync = Some(remote_modified);
                    config.sync_status = SyncStatus::Synced;
                    if let Err(e) = sync.update_config(config) {
                        return Ok(err(&e));
                    }
                }

                Ok(ok(ResolveResult { data_replaced: true }))
            } else {
                // Local is newer — upload it
                let mut sync = state.sync.lock().await;
                match sync.upload_db(&db_path).await {
                    Ok(_) => Ok(ok(ResolveResult { data_replaced: false })),
                    Err(e) => Ok(err(&e)),
                }
            }
        }

        "keep_local" => {
            let mut sync = state.sync.lock().await;
            match sync.upload_db(&db_path).await {
                Ok(_) => Ok(ok(ResolveResult { data_replaced: false })),
                Err(e) => Ok(err(&e)),
            }
        }

        _ => Ok(err(&format!("Unknown strategy: '{}'. Use 'accept_newest' or 'keep_local'.", strategy))),
    }
}

// ─── App Entry ───────────────────────────────────────────────────

pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let db_path = db.get_db_path();
    let sync = DriveSync::new();

    // Read the saved auto-sync settings so the worker starts in the right state
    let saved_cfg = sync.get_config().clone();
    let initial_ctl = SyncWorkerCtl {
        enabled: saved_cfg.auto_sync_enabled,
        interval_secs: (saved_cfg.auto_sync_interval_mins.max(1) as u64) * 60,
    };

    let (worker_tx, worker_rx) = watch::channel(initial_ctl);
    let sync_arc = Arc::new(TokioMutex::new(sync));

    // Spawn the background sync worker — it runs for the entire app lifetime.
    // The worker idles until auto_sync_enabled is true.
    let worker_sync = Arc::clone(&sync_arc);
    let worker_db_path = db_path.clone();
    tokio::spawn(run_sync_worker(worker_sync, worker_db_path, worker_rx));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: StdMutex::new(db),
            sync: sync_arc,
            db_path,
            sync_worker_tx: Arc::new(worker_tx),
        })
        .invoke_handler(tauri::generate_handler![
            get_categories,
            create_category,
            get_prompts,
            get_prompt_by_id,
            create_prompt,
            update_prompt,
            delete_prompt,
            get_prompt_versions,
            get_all_tags,
            search_prompts,
            save_embedding,
            get_all_embeddings,
            delete_embeddings_by_provider,
            start_oauth_flow,
            get_sync_config,
            update_sync_config,
            get_auth_url,
            exchange_auth_code,
            sync_to_drive,
            check_sync_status,
            set_auto_sync,
            get_conflict_info,
            resolve_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptVault");
}