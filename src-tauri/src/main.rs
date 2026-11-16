#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[allow(dead_code)]
mod data_paths;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running HospiAgenda")
}
