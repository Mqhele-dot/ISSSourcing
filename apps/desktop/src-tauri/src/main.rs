#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

fn spawn_backend() -> Option<Child> {
    let cwd = std::env::current_dir().ok()?;
    let api_dir: PathBuf = cwd.join("../../services/api");

    if cfg!(debug_assertions) {
        Command::new("python")
            .arg("-m")
            .arg("uvicorn")
            .arg("app.main:app")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg("8000")
            .current_dir(api_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()
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
