#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

fn write_dev_log(message: &str) {
    let log_dir = PathBuf::from("logs");
    let _ = create_dir_all(&log_dir);
    let log_path = log_dir.join("backend-dev.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "{}", message);
    }
}

fn resolve_api_dir() -> PathBuf {
    if let Ok(dir) = env::var("SCT_API_DIR") {
        return PathBuf::from(dir);
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join("../../../services/api");
            if candidate.exists() {
                return candidate;
            }
        }
    }

    Path::new("../../services/api").to_path_buf()
}

fn spawn_backend() -> Option<Child> {
    let api_dir = resolve_api_dir();

    if cfg!(debug_assertions) {
        let log_dir = PathBuf::from("logs");
        let _ = create_dir_all(&log_dir);
        let log_path = log_dir.join("backend-dev.log");
        let stdout = OpenOptions::new().create(true).append(true).open(&log_path).ok()?;
        let stderr = OpenOptions::new().create(true).append(true).open(&log_path).ok()?;

        match Command::new("python")
            .arg("-m")
            .arg("uvicorn")
            .arg("app.main:app")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg("8000")
            .current_dir(&api_dir)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
        {
            Ok(child) => Some(child),
            Err(err) => {
                write_dev_log(&format!(
                    "Failed to spawn backend from {}: {}",
                    api_dir.display(),
                    err
                ));
                None
            }
        }
    } else {
        Command::new("./bin/control-tower-api")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()
    }
}

fn main() {
    let backend = Arc::new(Mutex::new(None::<Child>));
    let backend_for_setup = backend.clone();
    let backend_for_exit = backend.clone();

    tauri::Builder::default()
        .setup(move |_app| {
            let child = spawn_backend();
            *backend_for_setup.lock().expect("backend mutex poisoned") = child;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit { .. }) {
                if let Some(mut child) = backend_for_exit.lock().expect("backend mutex poisoned").take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
