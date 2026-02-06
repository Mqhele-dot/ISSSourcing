#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // In MVP this is where the backend process is spawned on app start.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
