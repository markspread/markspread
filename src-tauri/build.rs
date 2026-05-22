fn main() {
    // S-WIN-001: feed our custom manifest (longPathAware, UTF-8 ACP,
    // PerMonitorV2) into tauri-build's own resource pipeline. Calling
    // both `embed_manifest::embed_manifest_file` AND `tauri_build::build`
    // double-embeds the MANIFEST resource and the Windows linker fails
    // with `CVTRES CVT1100: duplicate resource`.
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app.manifest")),
    ))
    .expect("failed to run tauri-build");
}
