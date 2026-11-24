mod dataset;
mod project;
mod storage;
mod worker;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use storage::*;
use tauri::{AppHandle, Manager};

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Value> {
    Ok(locked(&app)?.settings.clone())
}
#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<Value> {
    let mut store = locked(&app)?;
    let updated = update_preferences(&store.settings, &settings)?;
    store.prefs(updated)
}
#[tauri::command]
async fn set_directory(app: AppHandle, key: String) -> Result<Option<Value>> {
    if !DIRS.contains(&key.as_str()) {
        return Err("Unknown folder setting".into());
    }
    let current = dir(&locked(&app)?.settings, &key)?;
    let selection = tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new();
        let dialog = if current.is_dir() {
            dialog.set_directory(current)
        } else {
            dialog
        };
        dialog.pick_folder()
    })
    .await
    .map_err(err)?;
    let Some(path) = selection else {
        return Ok(None);
    };
    let path = canonical(&path)?;
    let install = std::env::current_exe().map_err(err)?;
    if install.parent().is_some_and(|p| path.starts_with(p)) {
        return Err("Select a folder outside the application installation.".into());
    }
    let mut store = locked(&app)?;
    let mut settings = store.settings.clone();
    if key == "datasetRoot" {
        discover(&path, &mut settings);
        for child in ["exportDir", "annotationDir"] {
            let folder = dir(&settings, child)?;
            if folder.starts_with(&path) && !folder.exists() {
                fs::create_dir_all(folder).map_err(err)?;
            }
        }
    } else {
        settings[&key] = json!(path);
    }
    Ok(Some(store.prefs(settings)?))
}
#[tauri::command]
async fn pick_path(app: AppHandle, kind: String) -> Result<Option<PathBuf>> {
    let (types, save, key) = match kind.as_str() {
        "video" => (VIDEOS, false, "videoDir"),
        "audio" => (SOUNDS, false, "soundDir"),
        "visual" => (VISUALS, false, "projectDir"),
        "project" => (PROJECTS, false, "projectDir"),
        "saveProject" => (&["foleymarks", "json"][..], true, "projectDir"),
        "directory" => (&[][..], false, "datasetRoot"),
        _ => return Err("Unknown picker".into()),
    };
    let initial = dir(&locked(&app)?.settings, key)?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new();
        let dialog = if initial.is_dir() {
            dialog.set_directory(initial)
        } else {
            dialog
        };
        if types.is_empty() {
            dialog.pick_folder()
        } else {
            let dialog = dialog.add_filter("FoleyMarks", types);
            if save {
                dialog.set_file_name("project.foleymarks").save_file()
            } else {
                dialog.pick_file()
            }
        }
    })
    .await
    .map_err(err)?;
    let Some(p) = path else { return Ok(None) };
    if types.is_empty() {
        return Ok(Some(canonical(&p)?));
    }
    let p = target(&p)?;
    if !ext(&p, types) {
        return Err("Unsupported file type".into());
    }
    let mut store = locked(&app)?;
    store.grant(
        p.clone(),
        save || (kind == "project" && ext(&p, &["json", "foleymarks"])),
    )?;
    Ok(Some(p))
}
#[tauri::command]
async fn scan_dataset(app: AppHandle) -> Result<dataset::Dataset> {
    let settings = locked(&app)?.settings.clone();
    tauri::async_runtime::spawn_blocking(move || dataset::scan(&settings))
        .await
        .map_err(err)?
}
#[tauri::command]
fn authorize_media(app: AppHandle, path: PathBuf) -> Result<PathBuf> {
    let p = locked(&app)?.media(&path)?;
    app.asset_protocol_scope().allow_file(&p).map_err(err)?;
    Ok(p)
}
#[tauri::command]
async fn load_project(app: AppHandle, path: PathBuf) -> Result<Value> {
    let local = app.clone();
    let data = tauri::async_runtime::spawn_blocking(move || {
        let mut store = locked(&local)?;
        let path = store.read_path(&path, PROJECTS)?;
        let mut data = project::parse(&path)?;
        project::validate(&data)?;
        project::resolve_import(&mut store, &mut data, &path)?;
        Ok::<_, String>(data)
    })
    .await
    .map_err(err)??;
    worker::call(
        &app,
        project::worker_request(&app, "normalize", data)?,
        false,
    )
    .await
}
#[tauri::command]
async fn save_project(app: AppHandle, path: PathBuf, project: Value) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        project::validate(&project)?;
        let store = locked(&app)?;
        let p = target(&path)?;
        if !ext(&p, &["foleymarks", "json"]) || !store.grants.writes.contains(&p) {
            return Err("Choose a destination with Save As.".into());
        }
        if p.exists() {
            let mut previous = fs::File::open(&p).map_err(err)?;
            let folder = p.parent().ok_or("Invalid project destination")?;
            let mut backup = tempfile::NamedTempFile::new_in(folder).map_err(err)?;
            std::io::copy(&mut previous, &mut backup).map_err(err)?;
            backup.flush().map_err(err)?;
            backup.as_file().sync_all().map_err(err)?;
            backup
                .persist(p.with_file_name(format!(
                    "{}.backup.json",
                    p.file_name().unwrap_or_default().to_string_lossy()
                )))
                .map_err(err)?;
        }
        atomic(&p, &project)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_annotation(app: AppHandle, project: Value) -> Result<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        project::validate(&project)?;
        let settings = locked(&app)?.settings.clone();
        let root = canonical(&dir(&settings, "annotationDir")?)?;
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos();
        let path = root.join(format!("annotation-{t}.json"));
        atomic(&path, &project)?;
        Ok(path)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_recovery(app: AppHandle, project: Value) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        project::validate(&project)?;
        let store = locked(&app)?;
        atomic(&store.state_dir.join("recovery.json"), &project)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn load_recovery(app: AppHandle) -> Result<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = locked(&app)?;
        let p = store.state_dir.join("recovery.json");
        if p.exists() {
            let project = read_json(&p)?;
            project::validate(&project)?;
            Ok(Some(project))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn clear_recovery(app: AppHandle) -> Result<()> {
    let store = locked(&app)?;
    let path = store.state_dir.join("recovery.json");
    if path.is_file() {
        fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
async fn probe_media(app: AppHandle, path: PathBuf) -> Result<Value> {
    let p = locked(&app)?.media(&path)?;
    worker::call(&app, json!({"op":"probe","path":p}), false).await
}
#[tauri::command]
async fn waveform(app: AppHandle, path: PathBuf) -> Result<Value> {
    let (p, cache) = {
        let store = locked(&app)?;
        let p = store.media(&path)?;
        let cache = if store.settings["waveformCache"] == true {
            let stat = fs::metadata(&p).map_err(err)?;
            let mut h = Sha256::new();
            h.update(p.as_os_str().as_encoded_bytes());
            h.update(stat.len().to_le_bytes());
            h.update(
                stat.modified()
                    .map_err(err)?
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
                    .to_le_bytes(),
            );
            dataset::wave_cache_dir(&store.settings)
                .ok()
                .map(|c| c.join(format!("{:x}.json", h.finalize())))
        } else {
            None
        };
        (p, cache)
    };
    if let Some(hit) = cache
        .as_deref()
        .filter(|p| p.exists())
        .and_then(|p| read_json(p).ok())
        .filter(|v| v.is_array())
    {
        return Ok(hit);
    }
    let result = worker::call(&app, json!({"op":"waveform","path":p,"bins":512}), false).await?;
    let peaks = result
        .get("peaks")
        .filter(|v| v.is_array())
        .ok_or("Invalid waveform response")?;
    if let Some(path) = cache {
        let _ = atomic(&path, peaks);
    }
    Ok(peaks.clone())
}
#[tauri::command]
async fn clear_waveform_cache(app: AppHandle) -> Result<usize> {
    let settings = locked(&app)?.settings.clone();
    tauri::async_runtime::spawn_blocking(move || dataset::clear_cache(&settings))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn edit_video(
    app: AppHandle,
    project: Value,
    action: String,
    clip_id: String,
    time: Option<f64>,
) -> Result<Value> {
    if !matches!(action.as_str(), "split" | "reorder" | "delete") {
        return Err("Unknown video edit".into());
    }
    let mut body = project::worker_request(&app, "edit", project)?;
    body["action"] = json!(action);
    body["clipId"] = json!(clip_id);
    body["time"] = json!(time.unwrap_or(0.0));
    worker::call(&app, body, false).await
}
#[tauri::command]
async fn run_analysis(
    app: AppHandle,
    project: Value,
    settings: Option<Value>,
    strategy: Option<String>,
    segment: Option<Value>,
    selected_ids: Option<Vec<String>>,
) -> Result<Value> {
    let mut body = project::worker_request(&app, "analyze", project)?;
    if let Some(v) = settings {
        if !v.is_object()
            || ["pose_model", "model_path"]
                .iter()
                .any(|k| v[k].as_str().is_some_and(|p| !p.is_empty()))
        {
            return Err("Unsupported analysis settings".into());
        }
        body["settings"] = v;
    }
    if let Some(v) = strategy {
        body["strategy"] = json!(v);
    }
    if let Some(v) = segment {
        body["segment"] = v;
    }
    if let Some(v) = selected_ids {
        body["selectedIds"] = json!(v);
    }
    worker::call(&app, body, true).await
}
#[tauri::command]
async fn export_project(app: AppHandle, project: Value) -> Result<Value> {
    let mut body = project::worker_request(&app, "export", project)?;
    let folder = dir(&locked(&app)?.settings, "exportDir")?;
    if !folder.is_dir() {
        return Err("Export folder missing. Select its new location in Settings.".into());
    }
    body["outputDir"] = json!(canonical(&folder)?);
    let output = worker::call(&app, body, true).await?;
    output
        .get("directory")
        .filter(|v| v.is_string())
        .cloned()
        .ok_or_else(|| "Export returned no output location.".into())
}
#[tauri::command]
fn cancel_job(app: AppHandle) -> Result<()> {
    worker::cancel(&app)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(worker::Jobs::default())
        .setup(|app| {
            app.manage(AppState(Mutex::new(
                Storage::open(app.handle()).map_err(std::io::Error::other)?,
            )));
            worker::log(app.handle(), "Editor started.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            set_directory,
            pick_path,
            scan_dataset,
            authorize_media,
            load_project,
            save_project,
            save_annotation,
            save_recovery,
            load_recovery,
            clear_recovery,
            probe_media,
            waveform,
            clear_waveform_cache,
            edit_video,
            run_analysis,
            export_project,
            cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("FoleyMarks failed to initialize");
}
