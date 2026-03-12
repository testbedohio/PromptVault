mod db;
mod sync;

use db::{Database, Prompt, PromptVersion, Category, Tag, StoredEmbedding};
use sync::{DriveSync, SyncConfig};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex as TokioMutex;
use tauri::State;

/// Shared application state managed by Tauri.
///
/// `db`   — std::sync::Mutex  (synchronous commands only, never held across .await)
/// `sync` — Arc<tokio::sync::Mutex> so the Arc can be cloned into spawned tasks
///          (e.g. the OAuth background listener) without requiring 'static lifetime tricks.
struct AppState {
    db: StdMutex<Database>,
    sync: Arc<TokioMutex<DriveSync>>,
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

#[tauri::command]
fn get_all_embeddings(model: String, state: State<AppState>) -> ApiResult<Vec<StoredEmbedding>> {
    let filter = if model.is_empty() { None } else { Some(model.as_str()) };
    match state.db.lock().unwrap().get_all_embeddings(filter) {
        Ok(embeddings) => ok(embeddings),
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
                    // Persist error state so the frontend poll sees it
                    let mut config = sync.get_config().clone();
                    config.sync_status = sync::SyncStatus::Error(e.clone());
                    sync.update_config(config).ok();
                    eprintln!("[PromptVault] OAuth exchange failed: {}", e);
                }
            }
            Err(e) => {
                let mut sync = sync_arc.lock().await;
                let mut config = sync.get_config().clone();
                config.sync_status = sync::SyncStatus::Error(e.clone());
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
    let db_path = {
        let db = state.db.lock().unwrap();
        db.get_db_path()
    };
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

// ─── App Entry ───────────────────────────────────────────────────

pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let sync = DriveSync::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: StdMutex::new(db),
            sync: Arc::new(TokioMutex::new(sync)),
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
            start_oauth_flow,
            get_sync_config,
            update_sync_config,
            get_auth_url,
            exchange_auth_code,
            sync_to_drive,
            check_sync_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptVault");
}