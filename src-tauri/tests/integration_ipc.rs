// S-TST-004: IPC integration tests.
//
// PARKED: depends on `tauri::test` (only available behind the `test` feature
// of the tauri crate, which is not currently enabled here) and on
// `markspread_lib::ipc`, a module that has not been exposed yet.
// `#![cfg(any())]` compiles the file out so the build stays green; remove
// the cfg once both dependencies are in place.
#![cfg(any())]

// We exercise the Tauri command surface from Rust directly, without
// driving the webview. `tauri::test::mock_app` (re-exported as
// `MockBuilder`) gives us a runtime that registers our handlers and
// dispatches `__TAURI_INTERNAL__` invocations the same way the renderer
// would, so we get end-to-end coverage of: argument deserialisation,
// permission gating, command body, error → IpcError translation, and
// JSON serialisation of the response — without paying for webview
// startup.
//
// Each test case names the IPC command it covers so when one fails the
// failure points straight at the surface that broke.

use serde_json::json;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn boot() -> tauri::App<MockRuntime> {
    let app = mock_builder()
        .invoke_handler(markspread_lib::ipc::handlers())
        .build(mock_context(noop_assets()))
        .expect("mock app boot");
    let _window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("main window");
    app
}

fn invoke(app: &tauri::App<MockRuntime>, cmd: &str, payload: serde_json::Value) -> serde_json::Value {
    let window = app.get_webview_window("main").expect("main window present");
    tauri::test::get_ipc_response(
        &window,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(payload),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|r| r.deserialize().unwrap_or(serde_json::Value::Null))
    .unwrap_or_else(|err| json!({ "error": err.to_string() }))
}

#[test]
fn fs_read_outside_workspace_is_rejected() {
    let app = boot();
    let resp = invoke(
        &app,
        "fs_read_text",
        json!({ "path": "/etc/passwd", "workspace": "/tmp/ms-ws-doesnt-exist" }),
    );
    let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        err.contains("E5101") || err.to_lowercase().contains("workspace"),
        "expected workspace-traversal rejection, got: {err}"
    );
}

#[test]
fn workspace_open_returns_id_and_path() {
    let app = boot();
    let tmp = tempfile::tempdir().unwrap();
    let resp = invoke(&app, "workspace_open", json!({ "path": tmp.path() }));
    assert!(resp.get("id").is_some(), "expected id field, got {resp}");
    assert_eq!(resp.get("path").and_then(|v| v.as_str()), Some(tmp.path().to_str().unwrap()));
}

#[test]
fn ai_key_save_round_trips_alias() {
    let app = boot();
    let resp = invoke(
        &app,
        "ai_key_save",
        json!({ "alias": "test-alias", "provider": "anthropic", "key": "sk-ant-test" }),
    );
    assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));

    let listed = invoke(&app, "ai_key_list", json!({}));
    let entries = listed.as_array().expect("list returns array");
    assert!(entries.iter().any(|e| e.get("alias").and_then(|v| v.as_str()) == Some("test-alias")));
}

#[test]
fn unknown_ipc_command_returns_structured_error() {
    let app = boot();
    let resp = invoke(&app, "this_command_does_not_exist", json!({}));
    let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("");
    assert!(!err.is_empty(), "expected an error for an unknown command");
}
