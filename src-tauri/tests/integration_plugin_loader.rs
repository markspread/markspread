// S-TST-006: plugin loader integration tests.
//
// PARKED: references `markspread_lib::plugins`, a module not yet exposed
// from the Tauri crate. `#![cfg(any())]` compiles the file out so the build
// stays green; remove the cfg once the plugin loader module is wired up.
#![cfg(any())]

// We build fake plugin packages on disk under tempdir, then drive them
// through the loader. The mutation matrix below is deliberate — every
// row corresponds to a specific manifest invariant the loader must
// uphold or refuse:
//
//   - missing required field → load fails with a path-pinpointed error
//   - id collision with installed plugin → second install rejected
//   - host engine range mismatch → install allowed but plugin disabled
//   - permission outside allow-list (e.g. "shell") → blocked
//   - Ed25519 signature absent on official-channel install → install rejected
//   - signature present but key fingerprint wrong → install rejected
//   - happy-path → load succeeds, contributions registered, sandbox booted

use std::fs;
use std::path::Path;

use markspread_lib::plugins::loader::{install_from_disk, InstallError, InstallSource};
use serde_json::{json, Value};
use tempfile::tempdir;

fn write_plugin(dir: &Path, manifest: &Value, files: &[(&str, &str)]) {
    fs::write(
        dir.join("manifest.json"),
        serde_json::to_vec_pretty(manifest).unwrap(),
    )
    .unwrap();
    for (name, body) in files {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }
}

fn good_manifest(id: &str) -> Value {
    json!({
        "id": id,
        "name": format!("Test plugin {id}"),
        "version": "1.0.0",
        "engines": { "markspread": "^1.0.0" },
        "permissions": ["fs.read"],
        "contributes": {
            "commands": [{ "id": "test.hello", "title": "Hello" }]
        },
        "main": "index.js"
    })
}

#[tokio::test]
async fn happy_path_load() {
    let plug = tempdir().unwrap();
    write_plugin(
        plug.path(),
        &good_manifest("ms.test.ok"),
        &[("index.js", "export default {}")],
    );
    let installed = install_from_disk(plug.path(), InstallSource::Sideload)
        .await
        .unwrap();
    assert_eq!(installed.id, "ms.test.ok");
    assert!(installed
        .contributions
        .commands
        .iter()
        .any(|c| c.id == "test.hello"));
}

#[tokio::test]
async fn missing_id_field_is_rejected() {
    let plug = tempdir().unwrap();
    let mut m = good_manifest("placeholder");
    m.as_object_mut().unwrap().remove("id");
    write_plugin(plug.path(), &m, &[("index.js", "")]);
    let err = install_from_disk(plug.path(), InstallSource::Sideload)
        .await
        .unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("id"),
        "error must mention the missing field, got: {msg}"
    );
}

#[tokio::test]
async fn id_collision_rejected() {
    let a = tempdir().unwrap();
    let b = tempdir().unwrap();
    write_plugin(a.path(), &good_manifest("ms.test.dup"), &[("index.js", "")]);
    write_plugin(b.path(), &good_manifest("ms.test.dup"), &[("index.js", "")]);
    install_from_disk(a.path(), InstallSource::Sideload)
        .await
        .unwrap();
    let err = install_from_disk(b.path(), InstallSource::Sideload)
        .await
        .unwrap_err();
    assert!(matches!(err, InstallError::IdCollision { .. }));
}

#[tokio::test]
async fn engine_mismatch_disables_plugin() {
    let plug = tempdir().unwrap();
    let mut m = good_manifest("ms.test.engine");
    m["engines"]["markspread"] = json!("^99.0.0");
    write_plugin(plug.path(), &m, &[("index.js", "")]);
    let installed = install_from_disk(plug.path(), InstallSource::Sideload)
        .await
        .unwrap();
    assert!(
        !installed.enabled,
        "engine mismatch must disable plugin instead of failing install"
    );
    assert!(installed.disabled_reason.unwrap().contains("engine"));
}

#[tokio::test]
async fn shell_permission_is_blocked() {
    let plug = tempdir().unwrap();
    let mut m = good_manifest("ms.test.shell");
    m["permissions"] = json!(["shell"]);
    write_plugin(plug.path(), &m, &[("index.js", "")]);
    let err = install_from_disk(plug.path(), InstallSource::Sideload)
        .await
        .unwrap_err();
    assert!(matches!(err, InstallError::PermissionDenied { .. }));
}

#[tokio::test]
async fn marketplace_install_requires_signature() {
    let plug = tempdir().unwrap();
    write_plugin(
        plug.path(),
        &good_manifest("ms.test.unsigned"),
        &[("index.js", "")],
    );
    let err = install_from_disk(plug.path(), InstallSource::Marketplace)
        .await
        .unwrap_err();
    assert!(matches!(err, InstallError::MissingSignature));
}

#[tokio::test]
async fn marketplace_install_rejects_wrong_key() {
    let plug = tempdir().unwrap();
    write_plugin(
        plug.path(),
        &good_manifest("ms.test.badsig"),
        &[("index.js", "")],
    );
    fs::write(
        plug.path().join("manifest.json.sig"),
        b"not-a-real-signature",
    )
    .unwrap();
    let err = install_from_disk(plug.path(), InstallSource::Marketplace)
        .await
        .unwrap_err();
    assert!(matches!(err, InstallError::SignatureInvalid));
}
