mod db;
mod sync;

use db::{Database, Prompt, PromptVersion, Category, Tag, StoredEmbedding, SimilarityResult};
use sync::{DriveSync, SyncConfig, SyncStatus};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, atomic::{AtomicBool, Ordering}};
use tokio::sync::{watch, Mutex as TokioMutex};
use tokio::time::{sleep, Duration};
use tauri::State;

// ─── Background Sync Worker ───────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct SyncWorkerCtl {
    enabled: bool,
    interval_secs: u64,
}

async fn run_sync_worker(
    sync: Arc<TokioMutex<DriveSync>>,
    db_path: String,
    mut ctl_rx: watch::Receiver<SyncWorkerCtl>,
) {
    loop {
        let ctl = ctl_rx.borrow().clone();

        if !ctl.enabled || ctl.interval_secs == 0 {
            if ctl_rx.changed().await.is_err() {
                break;
            }
            continue;
        }

        let sleep_fut = sleep(Duration::from_secs(ctl.interval_secs));
        tokio::select! {
            _ = sleep_fut => {
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
                continue;
            }
        }
    }
}

// ─── App State ────────────────────────────────────────────────────────────────

struct AppState {
    db: StdMutex<Database>,
    sync: Arc<TokioMutex<DriveSync>>,
    db_path: String,
    sync_worker_tx: Arc<watch::Sender<SyncWorkerCtl>>,
    db_locked: Arc<AtomicBool>,
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

fn salt_path() -> PathBuf {
    let mut p = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PromptVault");
    std::fs::create_dir_all(&p).ok();
    p.push("db.salt");
    p
}

fn is_encrypted_on_disk() -> bool {
    salt_path().exists()
}

fn bytes_to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn derive_key(password: &str, salt: &[u8]) -> Result<String, String> {
    use argon2::{Argon2, Algorithm, Version, Params};
    let params = Params::new(65536, 3, 4, Some(32))
        .map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(bytes_to_hex(&key))
}

fn load_salt() -> Result<Vec<u8>, String> {
    let hex = std::fs::read_to_string(salt_path()).map_err(|e| e.to_string())?;
    let clean = hex.trim();
    (0..clean.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&clean[i..i+2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn create_salt() -> Result<Vec<u8>, String> {
    let mut salt = vec![0u8; 32];
    getrandom::getrandom(&mut salt).map_err(|e| e.to_string())?;
    std::fs::write(salt_path(), bytes_to_hex(&salt)).map_err(|e| e.to_string())?;
    Ok(salt)
}

// ─── Shortcuts Config ─────────────────────────────────────────────────────────
//
// Persisted at <app_data>/PromptVault/shortcuts.json.
// All values are lowercase "modifier+key" strings, e.g. "ctrl+k".
// The frontend parses these strings and compares against KeyboardEvent
// properties; "ctrl" matches both ctrlKey and metaKey on macOS.

#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutsConfig {
    pub new_prompt: String,
    pub command_palette: String,
    pub brain_selector: String,
    pub toggle_inspector: String,
    pub sync_panel: String,
    pub settings: String,
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        ShortcutsConfig {
            new_prompt:       "ctrl+n".to_string(),
            command_palette:  "ctrl+k".to_string(),
            brain_selector:   "ctrl+b".to_string(),
            toggle_inspector: "ctrl+i".to_string(),
            sync_panel:       "ctrl+shift+s".to_string(),
            settings:         "ctrl+comma".to_string(),
        }
    }
}

fn shortcuts_path() -> PathBuf {
    let mut p = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PromptVault");
    std::fs::create_dir_all(&p).ok();
    p.push("shortcuts.json");
    p
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

// ─── SQL Similarity Search (Phase 6) ─────────────────────────────────────────
//
// Accepts a pre-computed query embedding from the frontend (generated by
// whichever Brain provider is active) and runs it through the
// vec_cosine_distance() SQL function registered at startup.
//
// This offloads the ranking computation to SQLite, which is more efficient
// than the previous approach of shipping all stored vectors to JavaScript
// and computing distances there.
//
// The frontend still generates the query embedding (calling the embedding
// provider API) — only the ranking step moves into SQL.

#[tauri::command]
fn sql_similarity_search(
    query_vector: Vec<f32>,
    provider: String,
    limit: i64,
    state: State<AppState>,
) -> ApiResult<Vec<SimilarityResult>> {
    let limit = limit.max(1).min(100);
    match state.db.lock().unwrap().similarity_search(&query_vector, &provider, limit) {
        Ok(results) => ok(results),
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

#[tauri::command]
fn get_all_embeddings(provider: String, state: State<AppState>) -> ApiResult<Vec<StoredEmbedding>> {
    let filter = if provider.is_empty() { None } else { Some(provider.as_str()) };
    match state.db.lock().unwrap().get_all_embeddings(filter) {
        Ok(embeddings) => ok(embeddings),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn delete_embeddings_by_provider(provider: String, state: State<AppState>) -> ApiResult<usize> {
    match state.db.lock().unwrap().delete_embeddings_by_provider(&provider) {
        Ok(count) => ok(count),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Export Commands ──────────────────────────────────────────────────────────
//
// Returns the serialized vault content as a String so the frontend can
// trigger a file-download without needing tauri-plugin-fs.
//
// Formats:
//   "json"     — structured JSON with full metadata and version history
//   "markdown" — human-readable Markdown document, one section per prompt

#[derive(Deserialize)]
struct ExportOptions {
    /// "json" | "markdown"
    format: String,
    /// Specific prompt IDs to export.  null / omitted = export all.
    ids: Option<Vec<i64>>,
}

#[tauri::command]
fn export_prompts(options: ExportOptions, state: State<AppState>) -> ApiResult<String> {
    let db = state.db.lock().unwrap();

    let all_prompts = match db.get_prompts() {
        Ok(p) => p,
        Err(e) => return err(&e.to_string()),
    };

    let prompts: Vec<Prompt> = if let Some(ids) = &options.ids {
        all_prompts.into_iter().filter(|p| ids.contains(&p.id)).collect()
    } else {
        all_prompts
    };

    match options.format.as_str() {
        // ── JSON export ──────────────────────────────────────────
        "json" => {
            #[derive(Serialize)]
            struct ExportVersion {
                version_number: i32,
                content: String,
                created_at: String,
            }

            #[derive(Serialize)]
            struct ExportPrompt {
                id: i64,
                title: String,
                content: String,
                category_id: Option<i64>,
                tags: Vec<String>,
                created_at: String,
                updated_at: String,
                versions: Vec<ExportVersion>,
            }

            #[derive(Serialize)]
            struct ExportPayload {
                schema_version: u32,
                exported_at: String,
                prompt_count: usize,
                prompts: Vec<ExportPrompt>,
            }

            let mut export_prompts: Vec<ExportPrompt> = Vec::new();
            for p in &prompts {
                let versions = match db.get_prompt_versions(p.id) {
                    Ok(v) => v,
                    Err(_) => vec![],
                };
                export_prompts.push(ExportPrompt {
                    id: p.id,
                    title: p.title.clone(),
                    content: p.content.clone(),
                    category_id: p.category_id,
                    tags: p.tags.clone(),
                    created_at: p.created_at.clone(),
                    updated_at: p.updated_at.clone(),
                    versions: versions.into_iter().map(|v| ExportVersion {
                        version_number: v.version_number,
                        content: v.content_text,
                        created_at: v.created_at,
                    }).collect(),
                });
            }

            let payload = ExportPayload {
                schema_version: 1,
                exported_at: chrono::Utc::now().to_rfc3339(),
                prompt_count: export_prompts.len(),
                prompts: export_prompts,
            };

            match serde_json::to_string_pretty(&payload) {
                Ok(json) => ok(json),
                Err(e) => err(&e.to_string()),
            }
        }

        // ── Markdown export ──────────────────────────────────────
        "markdown" => {
            let mut out = String::new();
            out.push_str("# PromptVault Export\n\n");
            out.push_str(&format!(
                "> **Exported:** {}  \n> **Prompts:** {}\n\n",
                chrono::Utc::now().format("%Y-%m-%d %H:%M UTC"),
                prompts.len()
            ));

            for p in &prompts {
                out.push_str("---\n\n");
                out.push_str(&format!("## {}\n\n", p.title));

                // Frontmatter-style metadata block
                let date_created = p.created_at.split('T').next().unwrap_or(&p.created_at);
                let date_updated = p.updated_at.split('T').next().unwrap_or(&p.updated_at);
                out.push_str(&format!(
                    "> **Created:** {}  \n> **Updated:** {}  \n",
                    date_created, date_updated
                ));
                if !p.tags.is_empty() {
                    let tags = p.tags.iter().map(|t| format!("`#{}`", t)).collect::<Vec<_>>().join(" ");
                    out.push_str(&format!("> **Tags:** {}  \n", tags));
                }
                out.push('\n');
                out.push_str(&p.content);
                out.push_str("\n\n");
            }

            ok(out)
        }

        _ => err(&format!(
            "Unknown export format '{}'. Valid options: 'json', 'markdown'.",
            options.format
        )),
    }
}

// ─── Keyboard Shortcuts Commands ─────────────────────────────────────────────

#[tauri::command]
fn get_shortcuts() -> ApiResult<ShortcutsConfig> {
    let path = shortcuts_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<ShortcutsConfig>(&data) {
                Ok(cfg) => ok(cfg),
                Err(_)  => ok(ShortcutsConfig::default()),
            },
            Err(_) => ok(ShortcutsConfig::default()),
        }
    } else {
        ok(ShortcutsConfig::default())
    }
}

#[tauri::command]
fn save_shortcuts(config: ShortcutsConfig) -> ApiResult<bool> {
    let path = shortcuts_path();
    match serde_json::to_string_pretty(&config) {
        Ok(data) => match std::fs::write(&path, data) {
            Ok(_)  => ok(true),
            Err(e) => err(&e.to_string()),
        },
        Err(e) => err(&e.to_string()),
    }
}

// ─── Sync Commands ───────────────────────────────────────────────

#[tauri::command]
async fn start_oauth_flow(
    client_id: String,
    client_secret: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<String>, ()> {
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

#[tauri::command]
async fn set_auto_sync(
    enabled: bool,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ApiResult<bool>, ()> {
    let interval_mins = interval_mins.max(1).min(60);

    {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.auto_sync_enabled = enabled;
        config.auto_sync_interval_mins = interval_mins;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
    }

    let _ = state.sync_worker_tx.send(SyncWorkerCtl {
        enabled,
        interval_secs: (interval_mins as u64) * 60,
    });

    Ok(ok(true))
}

// ─── Team Sync Commands ───────────────────────────────────────────────────────
//
// Team sync allows multiple users (or multiple devices of the same user)
// to share a prompt vault via a regular Drive file rather than the per-user
// appDataFolder.  This requires the drive.file OAuth scope; users are
// prompted to re-authenticate when switching to team mode.

/// Start the OAuth flow for team mode (drive.file scope).
///
/// After the user consents, PromptVault can create/update a Drive file that
/// can be shared with teammates.  The caller should poll `get_sync_config`
/// until sync_status changes.
#[tauri::command]
async fn start_team_oauth_flow(
    client_id: String,
    client_secret: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<String>, ()> {
    let auth_url = {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.client_id = client_id;
        config.client_secret = client_secret;
        config.team_mode = true;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
        match sync.get_team_auth_url() {
            Ok(url) => url,
            Err(e) => return Ok(err(&e)),
        }
    };

    let sync_arc = Arc::clone(&state.sync);

    tokio::spawn(async move {
        match sync::await_oauth_callback().await {
            Ok(code) => {
                let mut sync = sync_arc.lock().await;
                if let Err(e) = sync.exchange_code(&code).await {
                    let mut config = sync.get_config().clone();
                    config.sync_status = SyncStatus::Error(e.clone());
                    sync.update_config(config).ok();
                }
            }
            Err(e) => {
                let mut sync = sync_arc.lock().await;
                let mut config = sync.get_config().clone();
                config.sync_status = SyncStatus::Error(e.clone());
                sync.update_config(config).ok();
            }
        }
    });

    Ok(ok(auth_url))
}

/// Connect to an existing shared vault using a team file ID provided by a
/// teammate.  Immediately downloads the remote DB and restores it locally.
#[tauri::command]
async fn connect_team_vault(
    team_file_id: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<bool>, ()> {
    let db_path = state.db_path.clone();

    // Save the team file ID
    {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.team_file_id = Some(team_file_id);
        config.team_mode = true;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
    }

    // Download the remote vault into a temp file and restore into live DB
    let incoming = db_path.replace("prompt_vault.db", "prompt_vault_team_incoming.db");
    {
        let mut sync = state.sync.lock().await;
        if let Err(e) = sync.download_db(&incoming).await {
            return Ok(err(&format!("Download failed: {}", e)));
        }
    }

    {
        let mut db = state.db.lock().unwrap();
        if let Err(e) = db.restore_from(&incoming) {
            let _ = std::fs::remove_file(&incoming);
            return Ok(err(&format!("Restore failed: {}", e)));
        }
    }

    let _ = std::fs::remove_file(&incoming);

    // Mark as synced
    {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.sync_status = SyncStatus::Synced;
        config.last_sync = Some(chrono::Utc::now().to_rfc3339());
        sync.update_config(config).ok();
    }

    Ok(ok(true))
}

// ─── Conflict Resolution Commands ────────────────────────────────────────────

#[derive(Serialize)]
struct ConflictInfo {
    remote_modified: String,
    local_last_sync: Option<String>,
    remote_is_newer: bool,
}

#[tauri::command]
async fn get_conflict_info(state: State<'_, AppState>) -> Result<ApiResult<Option<ConflictInfo>>, ()> {
    let sync = state.sync.lock().await;
    let config = sync.get_config();

    if config.remote_file_id.is_none() && config.team_file_id.is_none() {
        return Ok(ok(None));
    }
    if !matches!(config.sync_status, SyncStatus::Connected | SyncStatus::Synced | SyncStatus::Conflict) {
        return Ok(ok(None));
    }

    let remote_modified = match sync.check_remote_status().await {
        Ok(Some(t)) => t,
        Ok(None) => return Ok(ok(None)),
        Err(_) => return Ok(ok(None)),
    };

    let local_last_sync = config.last_sync.clone();

    let remote_is_newer = match &local_last_sync {
        None => true,
        Some(last) => {
            let remote_ts = DateTime::parse_from_rfc3339(&remote_modified).ok();
            let local_ts  = DateTime::parse_from_rfc3339(last).ok();
            match (remote_ts, local_ts) {
                (Some(r), Some(l)) => r > l,
                _ => false,
            }
        }
    };

    if !remote_is_newer {
        return Ok(ok(None));
    }

    Ok(ok(Some(ConflictInfo {
        remote_modified,
        local_last_sync,
        remote_is_newer,
    })))
}

#[derive(Serialize)]
struct ResolveResult {
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
            let remote_modified = {
                let sync = state.sync.lock().await;
                match sync.check_remote_status().await {
                    Ok(Some(t)) => t,
                    Ok(None) => return Ok(err("No remote file found")),
                    Err(e) => return Ok(err(&e)),
                }
            };

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
                let incoming_path = db_path.replace("prompt_vault.db", "prompt_vault_incoming.db");

                {
                    let mut sync = state.sync.lock().await;
                    if let Err(e) = sync.download_db(&incoming_path).await {
                        return Ok(err(&e));
                    }
                }

                {
                    let mut db = state.db.lock().unwrap();
                    if let Err(e) = db.restore_from(&incoming_path) {
                        let _ = std::fs::remove_file(&incoming_path);
                        return Ok(err(&format!("Restore failed: {}", e)));
                    }
                }

                let _ = std::fs::remove_file(&incoming_path);

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

// ─── Encryption Commands ─────────────────────────────────────────────────────

#[derive(Serialize)]
struct DbLockStatus {
    encrypted: bool,
    unlocked: bool,
}

#[tauri::command]
fn get_db_lock_status(state: State<AppState>) -> ApiResult<DbLockStatus> {
    let encrypted = is_encrypted_on_disk();
    let unlocked  = !state.db_locked.load(Ordering::SeqCst);
    ok(DbLockStatus { encrypted, unlocked })
}

#[tauri::command]
fn unlock_database(password: String, state: State<AppState>) -> ApiResult<bool> {
    let salt = match load_salt() {
        Ok(s) => s,
        Err(_) => {
            state.db_locked.store(false, Ordering::SeqCst);
            return ok(true);
        }
    };

    let key_hex = match derive_key(&password, &salt) {
        Ok(k) => k,
        Err(e) => return err(&e),
    };

    let db = state.db.lock().unwrap();
    match db.apply_key(&key_hex) {
        Ok(_) => {
            state.db_locked.store(false, Ordering::SeqCst);
            ok(true)
        }
        Err(_) => err("Incorrect password"),
    }
}

#[tauri::command]
fn set_db_password(
    current: Option<String>,
    new_password: Option<String>,
    state: State<AppState>,
) -> ApiResult<bool> {
    let db = state.db.lock().unwrap();

    if is_encrypted_on_disk() {
        let old_pw = match &current {
            Some(pw) => pw,
            None => return err("Current password required to change or remove encryption"),
        };
        let salt = match load_salt() {
            Ok(s) => s,
            Err(e) => return err(&e),
        };
        let old_key = match derive_key(old_pw, &salt) {
            Ok(k) => k,
            Err(e) => return err(&e),
        };
        if db.apply_key(&old_key).is_err() {
            return err("Incorrect current password");
        }
    }

    match &new_password {
        Some(new_pw) => {
            let new_salt = match create_salt() {
                Ok(s) => s,
                Err(e) => return err(&e),
            };
            let new_key = match derive_key(new_pw, &new_salt) {
                Ok(k) => k,
                Err(e) => {
                    let _ = std::fs::remove_file(salt_path());
                    return err(&e);
                }
            };
            if let Err(e) = db.rekey(Some(&new_key)) {
                let _ = std::fs::remove_file(salt_path());
                return err(&e.to_string());
            }
            state.db_locked.store(false, Ordering::SeqCst);
            ok(true)
        }
        None => {
            if let Err(e) = db.rekey(None) {
                return err(&e.to_string());
            }
            let _ = std::fs::remove_file(salt_path());
            state.db_locked.store(false, Ordering::SeqCst);
            ok(true)
        }
    }
}

// ─── App Entry ───────────────────────────────────────────────────

pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let db_path = db.get_db_path();
    let sync = DriveSync::new();

    let saved_cfg = sync.get_config().clone();
    let initial_ctl = SyncWorkerCtl {
        enabled: saved_cfg.auto_sync_enabled,
        interval_secs: (saved_cfg.auto_sync_interval_mins.max(1) as u64) * 60,
    };

    let (worker_tx, worker_rx) = watch::channel(initial_ctl);
    let sync_arc = Arc::new(TokioMutex::new(sync));

    let db_locked = Arc::new(AtomicBool::new(is_encrypted_on_disk()));

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
            db_locked,
        })
        .invoke_handler(tauri::generate_handler![
            // Categories
            get_categories,
            create_category,
            // Prompts
            get_prompts,
            get_prompt_by_id,
            create_prompt,
            update_prompt,
            delete_prompt,
            // Versions
            get_prompt_versions,
            // Tags
            get_all_tags,
            // Search
            search_prompts,
            sql_similarity_search,
            // Embeddings
            save_embedding,
            get_all_embeddings,
            delete_embeddings_by_provider,
            // Export
            export_prompts,
            // Shortcuts
            get_shortcuts,
            save_shortcuts,
            // Sync (personal)
            start_oauth_flow,
            get_sync_config,
            update_sync_config,
            get_auth_url,
            exchange_auth_code,
            sync_to_drive,
            check_sync_status,
            set_auto_sync,
            // Sync (team)
            start_team_oauth_flow,
            connect_team_vault,
            // Conflict
            get_conflict_info,
            resolve_conflict,
            // Encryption
            get_db_lock_status,
            unlock_database,
            set_db_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptVault");
}