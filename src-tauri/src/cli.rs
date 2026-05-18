use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Default, Serialize)]
pub struct CliFlags {
    pub no_restore: bool,
    pub headless_cold_start: bool,
    pub path_arg: Option<String>,
}

static FLAGS: OnceLock<CliFlags> = OnceLock::new();

fn parse_args(args: &[String]) -> CliFlags {
    let mut flags = CliFlags::default();
    for a in args {
        match a.as_str() {
            "--no-restore" => flags.no_restore = true,
            "--headless-cold-start" => flags.headless_cold_start = true,
            s if s.starts_with("--") => {
                // Unknown long flag; ignore so future flags don't get treated as a path.
            }
            s if flags.path_arg.is_none() => {
                flags.path_arg = Some(s.to_string());
            }
            _ => {}
        }
    }
    flags
}

pub fn parse_from_env() -> &'static CliFlags {
    FLAGS.get_or_init(|| {
        let args: Vec<String> = std::env::args().skip(1).collect();
        parse_args(&args)
    })
}

/// Path argument received from a *secondary* invocation forwarded via the
/// single-instance plugin. We keep this separate from the boot-time CliFlags
/// so the front-end can react via an event.
#[derive(Debug, Clone, Serialize)]
pub struct ForwardedArgs {
    pub path_arg: Option<String>,
}

pub fn forwarded_from(args: Vec<String>) -> ForwardedArgs {
    // The plugin includes argv[0] (the executable path) on every platform.
    let parsed = parse_args(&args.into_iter().skip(1).collect::<Vec<_>>());
    ForwardedArgs {
        path_arg: parsed.path_arg,
    }
}

#[tauri::command]
pub fn cli_flags() -> CliFlags {
    parse_from_env().clone()
}
