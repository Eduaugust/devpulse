use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open DevPulse", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let icon_bytes = include_bytes!("../icons/tray-icon.png");
    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .expect("Failed to decode tray icon");

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("DevPulse")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => {
                // macOS: re-add to Dock before showing
                #[cfg(target_os = "macos")]
                let _ = app.set_dock_visibility(true);
                if let Some(window) = app.get_webview_window("main") {
                    // Windows/Linux: re-add to taskbar
                    #[cfg(not(target_os = "macos"))]
                    let _ = window.set_skip_taskbar(false);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(panel) = app.get_webview_window("tray-panel") {
                    if panel.is_visible().unwrap_or(false) {
                        let _ = panel.hide();
                    } else {
                        // Position panel relative to tray icon
                        if let Ok(Some(rect)) = tray.rect() {
                            let pos: tauri::PhysicalPosition<i32> = rect.position.to_physical(1.0);
                            let size: tauri::PhysicalSize<u32> = rect.size.to_physical(1.0);
                            let panel_width = 340;
                            let panel_height = 560;
                            let icon_width = size.width as i32;
                            // Center horizontally on the tray icon
                            let x = pos.x - (panel_width / 2) + (icon_width / 2);
                            // macOS: menu bar at top → open below
                            // Windows/Linux: taskbar at bottom → open above
                            let y = if cfg!(target_os = "macos") {
                                pos.y + size.height as i32
                            } else {
                                pos.y - panel_height
                            };
                            let _ = panel.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(x, y),
                            ));
                        }
                        let _ = panel.show();
                        let _ = panel.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
