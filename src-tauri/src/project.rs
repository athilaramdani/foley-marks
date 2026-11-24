use crate::storage::*;
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;

pub fn validate(project: &Value) -> Result<()> {
    let version = project
        .get("schema_version")
        .map(|v| v.as_u64().unwrap_or(0))
        .unwrap_or(1);
    if !project.is_object() || !(1..=3).contains(&version) {
        return Err("Unsupported project schema.".into());
    }
    if version >= 2 && !project["tracks"].is_array() {
        return Err("Missing tracks.".into());
    }
    Ok(())
}
pub fn parse(path: &Path) -> Result<Value> {
    let file = fs::File::open(path).map_err(err)?;
    let mut s = String::new();
    file.take(64 * 1024 * 1024 + 1)
        .read_to_string(&mut s)
        .map_err(err)?;
    if s.len() > 64 * 1024 * 1024 {
        return Err("Project exceeds size limit.".into());
    }
    let s = s.trim_start_matches('\u{feff}');
    if !ext(path, &["txt"]) {
        return serde_json::from_str(s).map_err(err);
    }
    let mut annotations = vec![];
    for line in s.lines().filter(|l| !l.trim().is_empty()) {
        let (stamp, reference) = line
            .split_once('\t')
            .ok_or("Expected a timestamp and sound separated by a tab.")?;
        let timestamp: f64 = stamp.parse().map_err(err)?;
        if !timestamp.is_finite() || timestamp < 0.0 {
            return Err("Invalid annotation timestamp.".into());
        }
        annotations
            .push(json!({"timestamp":timestamp,"sound_name":reference,"file_path":reference}));
    }
    Ok(json!({"schema_version":1,"annotations":annotations}))
}
fn contained(root: &Path, reference: &str) -> Option<PathBuf> {
    let relative = Path::new(reference);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    let path = canonical(&root.join(relative)).ok()?;
    (path.is_file() && path.starts_with(root)).then_some(path)
}
// A sibling raw video or a bundled sticker is part of a user-opened export. Resolve only
// relative files contained by that export, including after symlink resolution.
pub fn resolve_import(store: &mut Storage, project: &mut Value, source: &Path) -> Result<()> {
    let root = source.parent().ok_or("Missing project folder")?;
    let mut grants = store.grants.clone();
    for field in ["raw_file", "video_path", "original_video"] {
        if let Some(reference) = project[field].as_str() {
            let raw = Path::new(reference);
            let candidate = contained(root, reference)
                .filter(|p| ext(p, VIDEOS))
                .or_else(|| {
                    if raw.is_absolute() {
                        store.read_path(raw, VIDEOS).ok()
                    } else {
                        None
                    }
                });
            if let Some(p) = candidate {
                grants.files.insert(p.clone());
                project["video_path"] = json!(p);
                break;
            }
        }
    }
    let video = project["video_path"].clone();
    if let Some(tracks) = project.get_mut("tracks").and_then(Value::as_array_mut) {
        for track in tracks {
            if let Some(clips) = track.get_mut("clips").and_then(Value::as_array_mut) {
                for c in clips {
                    if c["media_type"] == "video" && video.is_string() {
                        c["file_path"] = video.clone();
                    }
                    if c["media_type"] == "visual" {
                        if let Some(p) = c["file_path"]
                            .as_str()
                            .and_then(|s| contained(root, s))
                            .filter(|p| ext(p, VISUALS))
                        {
                            grants.files.insert(p.clone());
                            c["file_path"] = json!(p);
                        }
                    }
                }
            }
        }
    }
    if store.grants.files != grants.files {
        atomic(&store.state_dir.join("grants.json"), &grants)?;
        store.grants = grants;
    }
    Ok(())
}

pub fn worker_request(app: &AppHandle, op: &str, mut project: Value) -> Result<Value> {
    validate(&project)?;
    let store = locked(app)?;
    let sound_dir = dir(&store.settings, "soundDir")?;
    project["sound_dir"] = json!(sound_dir);
    project["sounds_directory"] = json!(sound_dir);
    let mut files = BTreeSet::new();
    let refs = project["tracks"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|t| t["clips"].as_array().into_iter().flatten())
        .map(|c| &c["file_path"])
        .chain(
            project["annotations"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|a| &a["file_path"]),
        )
        .chain(std::iter::once(&project["video_path"]));
    for reference in refs.filter_map(Value::as_str).filter(|s| !s.is_empty()) {
        if let Ok(p) = store.media(Path::new(reference)) {
            files.insert(p);
        }
    }
    if matches!(op, "export" | "analyze") {
        let p = store.read_path(
            Path::new(
                project["video_path"]
                    .as_str()
                    .ok_or("Relink the source video first.")?,
            ),
            VIDEOS,
        )?;
        project["video_path"] = json!(p);
        files.insert(p);
    }
    Ok(json!({"op":op,"project":project,"soundDir":sound_dir,"allowedFiles":files}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn v1_import_does_not_insert_null_tracks() {
        let t = tempfile::tempdir().unwrap();
        let mut store = Storage {
            settings: json!({}),
            state_dir: t.path().into(),
            grants: Grants::default(),
        };
        let mut project = json!({"schema_version":1,"annotations":[]});
        resolve_import(&mut store, &mut project, &t.path().join("legacy.json")).unwrap();
        assert!(project.get("tracks").is_none());
    }
    #[test]
    fn references_cannot_escape() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("export");
        fs::create_dir(&root).unwrap();
        fs::write(t.path().join("private.mp4"), []).unwrap();
        assert!(contained(&root, "../private.mp4").is_none());
    }
    #[test]
    fn legacy_txt() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("metadata.txt");
        fs::write(&p, "0.25\té.wav\r\n").unwrap();
        assert_eq!(parse(&p).unwrap()["annotations"][0]["timestamp"], 0.25);
    }
    #[test]
    fn reject_future_schema() {
        assert!(validate(&json!({"schema_version":5})).is_err());
    }
}
