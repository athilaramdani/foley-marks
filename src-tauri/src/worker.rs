use crate::storage::{err, Result};
use serde_json::Value;
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct Jobs(Mutex<Option<Arc<AtomicBool>>>);
pub struct Ticket(AppHandle);
impl Drop for Ticket {
    fn drop(&mut self) {
        if let Ok(mut job) = self.0.state::<Jobs>().0.lock() {
            *job = None;
        }
    }
}
pub fn cancel(app: &AppHandle) -> Result<()> {
    if let Some(active) = app.state::<Jobs>().0.lock().map_err(err)?.as_ref() {
        active.store(true, Ordering::Release);
    }
    Ok(())
}
fn begin(app: &AppHandle) -> Result<(Ticket, Arc<AtomicBool>)> {
    let jobs = app.state::<Jobs>();
    let mut slot = jobs.0.lock().map_err(err)?;
    if slot.is_some() {
        return Err("A media job is already running.".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    *slot = Some(flag.clone());
    Ok((Ticket(app.clone()), flag))
}
pub fn log(app: &AppHandle, message: &str) {
    if let Ok(folder) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&folder);
        let path = folder.join("editor.log");
        if path
            .metadata()
            .map(|m| m.len() > 1024 * 1024)
            .unwrap_or(false)
        {
            let _ = std::fs::rename(&path, folder.join("editor.previous.log"));
        }
        if let Ok(mut f) = OpenOptions::new().append(true).create(true).open(path) {
            let stamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let _ = writeln!(f, "{stamp} {message}");
        }
    }
}
fn runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf)> {
    let resources = app.path().resource_dir().map_err(err)?;
    let media = resources.join("media-runtime");
    let tools = std::env::current_exe()
        .map_err(err)?
        .parent()
        .ok_or("Missing executable directory")?
        .to_owned();
    if !media.join("python.exe").is_file()
        || !media.join("worker.py").is_file()
        || !tools.join("ffprobe.exe").is_file()
    {
        return Err(
            "Media runtime is missing. Prepare development resources or repair the installation."
                .into(),
        );
    }
    Ok((media, tools))
}

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl ProcessTree {
    fn attach(child: &std::process::Child) -> Result<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        // The job owns all descendants (including FFmpeg). Closing its handle terminates them
        // after cancellation, a crash or an app exit.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(err(std::io::Error::last_os_error()));
            }
            let tree = Self(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle()) == 0
            {
                return Err(err(std::io::Error::last_os_error()));
            }
            Ok(tree)
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

fn execute(
    media: &Path,
    tools: &Path,
    temp: &Path,
    body: Value,
    flag: Option<Arc<AtomicBool>>,
) -> Result<Value> {
    let mut command = Command::new(media.join("python.exe"));
    command
        .args(["-I", "-B", "-X", "utf8"])
        .arg(media.join("worker.py"))
        .current_dir(media)
        .env("FOLEYMARKS_TOOL_DIR", tools)
        .env("TEMP", temp)
        .env("TMP", temp)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(err)?;
    #[cfg(windows)]
    let tree = match ProcessTree::attach(&child) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    let write_result = child
        .stdin
        .take()
        .ok_or("Missing worker input")
        .and_then(|stdin| {
            serde_json::to_writer(stdin, &body).map_err(|_| "Cannot send media request")
        });
    if let Err(error) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.into());
    }
    let stdout = child.stdout.take().ok_or("No worker output")?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
        Ok::<_, std::io::Error>(bytes)
    });
    loop {
        if flag.as_ref().is_some_and(|f| f.load(Ordering::Acquire)) {
            #[cfg(windows)]
            drop(tree);
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("Job cancelled.".into());
        }
        if child.try_wait().map_err(err)?.is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(35));
    }
    let bytes = reader
        .join()
        .map_err(|_| "Media worker read interrupted")?
        .map_err(err)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Media worker response exceeds size limit".into());
    }
    let output: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Media worker exited without a valid response.")?;
    if output["ok"] == true {
        Ok(output["result"].clone())
    } else {
        Err(output["error"]
            .as_str()
            .unwrap_or("Media processing failed")
            .to_string())
    }
}
pub async fn call(app: &AppHandle, body: Value, exclusive: bool) -> Result<Value> {
    // Keep a large visible timeline from spawning a decoder for every waveform at once.
    static PREVIEW_SLOTS: [tauri::async_runtime::Mutex<()>; 2] = [
        tauri::async_runtime::Mutex::const_new(()),
        tauri::async_runtime::Mutex::const_new(()),
    ];
    static NEXT_SLOT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let _preview_slot = if exclusive {
        None
    } else {
        let slot = NEXT_SLOT.fetch_add(1, Ordering::Relaxed) % PREVIEW_SLOTS.len();
        Some(PREVIEW_SLOTS[slot].lock().await)
    };
    let (media, tools) = runtime(app)?;
    let temp = crate::storage::dir(&crate::storage::locked(app)?.settings, "tempDir")?;
    if !temp.is_dir() {
        return Err("Temporary folder missing. Choose its new location in Settings.".into());
    }
    let task = if exclusive { Some(begin(app)?) } else { None };
    let flag = task.as_ref().map(|(_, f)| f.clone());
    let result =
        tauri::async_runtime::spawn_blocking(move || execute(&media, &tools, &temp, body, flag))
            .await
            .map_err(err)?;
    if result.is_err() {
        log(app, "Media worker returned an error.");
    }
    result
}
