mod access_policy;
mod ai_auth;
mod ai_keys;
mod backup;
mod cli;
mod crash;
mod drive;
mod error;
mod export;
mod fs_cmd;
mod fs_lock;
mod logging;
mod misc;
mod ops;
mod os_integration;
mod path_norm;
mod plugin_runtime;
mod plugins;
mod portable;
mod search;
mod startup;
mod telemetry;
mod unmount_watcher;
mod updater;
mod watcher;
mod window_mgr;
mod workspace;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = startup::process_start();
    let _ = cli::parse_from_env();
    logging::init();

    tauri::Builder::default()
        .manage(updater::UpdaterState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // S-WS-011: another `markspread <path>` invocation arrived. Focus the
            // running window and forward the path so the front-end can route it.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let forwarded = cli::forwarded_from(args);
            let _ = app.emit("cli://forwarded", forwarded);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                portable = portable::is_portable(),
                "Markspread booting"
            );
            watcher::register(app.handle());
            search::register(app.handle());
            startup::register(app.handle());
            unmount_watcher::register(app.handle());
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            // S-PF-002: the cold-start probe spawns us with this flag to
            // measure boot-to-setup-complete and then expects a clean
            // exit. Without this, the GUI event loop keeps running and
            // the probe falls back to its 15s hard-kill timeout.
            if cli::parse_from_env().headless_cold_start {
                app.handle().exit(0);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_cmd::fs_read_file,
            fs_cmd::fs_read,
            fs_cmd::fs_read_chunk,
            fs_cmd::fs_write,
            fs_cmd::fs_create_file,
            fs_cmd::fs_create_dir,
            fs_cmd::fs_trash_file,
            fs_cmd::fs_trash_restore,
            fs_cmd::fs_remove_file,
            fs_cmd::fs_remove_dir,
            fs_cmd::fs_rename,
            fs_cmd::fs_move,
            fs_cmd::fs_copy,
            fs_cmd::fs_import_copy,
            fs_cmd::fs_stat,
            fs_cmd::fs_list,
            fs_cmd::fs_list_dir,
            fs_lock::fs_check_locked,
            watcher::fs_watch_start,
            watcher::fs_watch_stop,
            search::fs_search,
            search::fs_index_rebuild,
            search::fs_index_status,
            workspace::workspace_scaffold,
            workspace::workspace_inspect,
            workspace::workspace_settings_recover,
            workspace::workspace_settings_check,
            workspace::workspace_index_quarantine,
            workspace::workspace_layout_load,
            workspace::workspace_layout_save,
            startup::startup_mark_first_paint,
            startup::startup_metrics,
            portable::portable_is_active,
            cli::cli_flags,
            drive::drive_classify,
            window_mgr::window_new,
            window_mgr::window_info,
            unmount_watcher::unmount_watch_start,
            unmount_watcher::unmount_watch_stop,
            unmount_watcher::unmount_dump_orphan,
            os_integration::os_reveal_path,
            os_integration::os_open_with,
            os_integration::os_list_fonts,
            ops::ops_erase_all,
            ops::ops_erase_index,
            ops::ops_erase_ai_keys,
            ops::ops_export_diagnostics,
            ops::ops_settings_backup,
            ops::ops_settings_restore,
            ops::ops_data_dir_info,
            ops::ops_clean_cache,
            ops::ops_safe_mode_get,
            ops::ops_safe_mode_set,
            ops::ops_cleanup_plugin_data,
            ops::ops_update_prefs_get,
            ops::ops_update_prefs_set,
            ops::ops_telemetry_get,
            ops::ops_telemetry_set,
            ops::ops_telemetry_request_deletion,
            ops::ops_about_licenses,
            ops::ops_keybindings_load,
            ops::ops_keybindings_save,
            ops::ops_keybindings_backup,
            telemetry::telemetry_access_get,
            telemetry::telemetry_access_set,
            telemetry::telemetry_access_query,
            telemetry::telemetry_access_clear,
            ai_auth::ai_auth_begin_subscription,
            ai_auth::ai_auth_await_completion,
            ai_auth::ai_auth_cancel,
            ai_auth::ai_keys_get_subscription,
            ai_auth::ai_auth_refresh_subscription,
            ai_keys::ai_key_list,
            ai_keys::ai_key_save,
            ai_keys::ai_key_remove,
            ai_keys::ai_key_set_default,
            ai_keys::ai_key_resolve,
            ai_keys::ai_history_record,
            ai_keys::ai_history_list,
            ai_keys::ai_usage_record,
            ai_keys::ai_usage_query,
            ai_keys::ai_usage_reset,
            ai_keys::ai_keychain_probe,
            crash::error_record_crash,
            crash::error_session_beacon_write,
            crash::error_session_beacon_read,
            crash::error_session_beacon_clear,
            crash::error_recovery_list,
            backup::backup_snapshot_list,
            backup::backup_snapshot_restore,
            backup::backup_propose_recovery,
            backup::backup_workspace_export,
            backup::backup_workspace_import,
            backup::backup_settings_export,
            backup::backup_settings_import,
            backup::backup_keybindings_export,
            backup::backup_keybindings_import,
            updater::updater_check,
            updater::updater_download,
            updater::updater_cancel,
            updater::updater_install_and_restart,
            plugins::plugin_list,
            plugins::plugin_enable,
            plugins::plugin_disable,
            plugins::plugin_activate,
            plugins::plugin_uninstall,
            plugins::plugin_storage_get,
            plugins::plugin_storage_set,
            plugins::plugin_storage_remove,
            plugins::plugin_permission_audit,
            plugins::plugin_permission_audit_list,
            plugins::plugin_permission_prompt,
            plugins::plugin_marketplace_search,
            plugins::plugin_marketplace_get,
            plugins::plugin_marketplace_updates,
            plugins::plugin_marketplace_verify_signature,
            plugins::plugin_install,
            plugin_runtime::plugin_runtime_dir,
            plugin_runtime::plugin_runtime_list,
            plugin_runtime::plugin_runtime_read,
            export::export_document,
            export::export_print,
            export::export_batch,
            misc::fs_canonicalize,
            misc::fs_open_tab,
            misc::migration_run,
            misc::migrate_run,
            misc::logger_set_rotation,
            misc::logger_locations,
            misc::shell_open_external,
            misc::security_erase_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
