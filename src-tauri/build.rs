fn main() {
    #[cfg(windows)]
    {
        // Embed our custom manifest so the exe advertises longPathAware=true,
        // UTF-8 active code page, and PerMonitorV2 DPI awareness. Tauri's
        // default manifest does not include longPathAware, which is required
        // for paths >260 chars on Windows 10+ (when the OS-side reg key is
        // set as well).
        embed_manifest::embed_manifest_file("windows-app.manifest")
            .expect("embed Windows manifest");
    }
    tauri_build::build()
}
