#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    let alt_p = Shortcut::new(Some(Modifiers::ALT), Code::KeyP);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &alt_p && event.state() == ShortcutState::Pressed {
                        let _ = app.emit("toggle", ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.global_shortcut().register(alt_p)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Whisper Flow");
}
