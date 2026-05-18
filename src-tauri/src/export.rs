// S-EXP-001..009: document export — HTML / PDF / DOCX / ePub / Print.
//
// The renderer hands over pre-sanitised preview HTML; this module
// composes a standalone HTML document (template CSS inlined, optional
// asset embedding) and then:
//
//   • html  — written directly.
//   • pdf / docx / epub — handed to `pandoc`, which every format here
//     names as its specialist. When pandoc is absent the command
//     returns a structured `ExportResult { ok: false, error }` instead
//     of throwing, so the UI can tell the user to install it.
//
// Batch export receives only file paths, so it renders markdown to HTML
// itself via pulldown-cmark before composing.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Margins {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    pub size: String,
    pub custom_width_in: Option<f64>,
    pub custom_height_in: Option<f64>,
    pub margins_in: Margins,
    pub orientation: String,
    // Accepted from the renderer's page-setup contract; the running-head
    // composition that consumes these is a follow-up.
    #[allow(dead_code)]
    pub header: Option<String>,
    #[allow(dead_code)]
    pub footer: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportTemplate {
    // `id`/`label` are display metadata the renderer round-trips; only
    // `css_path` is read backend-side.
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub label: String,
    pub css_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub format: String,
    pub document_path: Option<String>,
    pub body_html: String,
    pub title: String,
    pub template: ExportTemplate,
    pub page_setup: Option<PageSetup>,
    #[serde(default)]
    pub inline_external_assets: bool,
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_written: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ExportErrorBody>,
}

fn export_fail(code: &str, message: String) -> ExportResult {
    ExportResult {
        ok: false,
        output_path: None,
        bytes_written: None,
        error: Some(ExportErrorBody {
            code: code.to_string(),
            message,
        }),
    }
}

const DEFAULT_CSS: &str = "\
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;\
max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}\
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}\
pre{background:#f5f5f5;padding:0.8rem;border-radius:6px;overflow:auto}\
blockquote{border-left:3px solid #ccc;margin:0;padding-left:1rem;color:#555}\
img{max-width:100%}table{border-collapse:collapse}\
td,th{border:1px solid #ddd;padding:0.4rem 0.6rem}";

/// Resolve a template's CSS. `:builtin:*` ids map to the bundled
/// stylesheet; a workspace-relative path is read from disk when the
/// document path lets us anchor it.
fn resolve_css(template: &ExportTemplate, document_path: Option<&str>) -> String {
    if template.css_path.starts_with(":builtin:") {
        return DEFAULT_CSS.to_string();
    }
    if let Some(doc) = document_path {
        if let Some(ws) = Path::new(doc).parent() {
            let candidate = ws.join(&template.css_path);
            if let Ok(css) = std::fs::read_to_string(&candidate) {
                return css;
            }
        }
    }
    // Absolute path fallback.
    std::fs::read_to_string(&template.css_path).unwrap_or_else(|_| DEFAULT_CSS.to_string())
}

fn page_css(setup: &PageSetup) -> String {
    let size = match setup.size.as_str() {
        "A4" | "Letter" | "Legal" | "A5" => setup.size.to_lowercase(),
        "Custom" => format!(
            "{}in {}in",
            setup.custom_width_in.unwrap_or(8.5),
            setup.custom_height_in.unwrap_or(11.0)
        ),
        _ => "a4".to_string(),
    };
    let m = &setup.margins_in;
    format!(
        "@page{{size:{size} {};margin:{}in {}in {}in {}in}}",
        setup.orientation, m.top, m.right, m.bottom, m.left
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Best-effort: download `http(s)` `<img src>` assets and inline them as
/// base64 data URLs so the exported file is self-contained.
async fn inline_assets(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(idx) = rest.find("src=\"http") {
        out.push_str(&rest[..idx + 5]);
        rest = &rest[idx + 5..];
        let Some(end) = rest.find('"') else {
            break;
        };
        let url = &rest[..end];
        match fetch_data_url(url).await {
            Some(data) => out.push_str(&data),
            None => out.push_str(url),
        }
        out.push('"');
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

async fn fetch_data_url(url: &str) -> Option<String> {
    let resp = reqwest::get(url).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = resp.bytes().await.ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{b64}"))
}

async fn compose_html(req: &ExportRequest) -> String {
    let css = resolve_css(&req.template, req.document_path.as_deref());
    let page = req.page_setup.as_ref().map(page_css).unwrap_or_default();
    let body = if req.inline_external_assets {
        inline_assets(&req.body_html).await
    } else {
        req.body_html.clone()
    };
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <title>{title}</title>\n<style>\n{css}\n{page}\n</style>\n</head>\n\
         <body>\n{body}\n</body>\n</html>\n",
        title = html_escape(&req.title),
        css = css,
        page = page,
        body = body,
    )
}

/// Run pandoc to convert composed HTML into `format`. Returns the
/// process error verbatim so the UI can surface "install pandoc".
fn run_pandoc(html: &str, format: &str, output: &Path) -> Result<(), String> {
    let tmp = std::env::temp_dir().join(format!("markspread-export-{}.html", std::process::id()));
    std::fs::write(&tmp, html.as_bytes()).map_err(|e| format!("temp write: {e}"))?;

    let mut cmd = std::process::Command::new("pandoc");
    cmd.arg(&tmp).arg("-f").arg("html").arg("-o").arg(output);
    if format == "pdf" {
        // wkhtmltopdf keeps the HTML/CSS fidelity the preview produced;
        // pandoc falls back to its default engine if it is unavailable.
        cmd.arg("--pdf-engine=wkhtmltopdf");
    }
    let result = cmd.output();
    let _ = std::fs::remove_file(&tmp);
    match result {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!(
            "pandoc failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err("pandoc is not installed — required for pdf/docx/epub export".to_string())
        }
        Err(e) => Err(format!("pandoc spawn: {e}")),
    }
}

#[tauri::command]
pub async fn export_document(req: ExportRequest) -> AppResult<ExportResult> {
    let format = req.format.to_lowercase();
    if !matches!(format.as_str(), "html" | "pdf" | "docx" | "epub") {
        return Ok(export_fail(
            "EFORMAT",
            format!("unsupported export format: {format}"),
        ));
    }
    let output = match &req.output_path {
        Some(p) => PathBuf::from(p),
        None => {
            return Ok(export_fail(
                "ENOPATH",
                "output path required — the save dialog must resolve it first".into(),
            ))
        }
    };

    let html = compose_html(&req).await;

    if format == "html" {
        if let Err(e) = std::fs::write(&output, html.as_bytes()) {
            return Ok(export_fail("EIO", e.to_string()));
        }
    } else if let Err(e) = run_pandoc(&html, &format, &output) {
        return Ok(export_fail("EPANDOC", e));
    }

    let bytes = std::fs::metadata(&output).map(|m| m.len() as i64).ok();
    Ok(ExportResult {
        ok: true,
        output_path: Some(output.display().to_string()),
        bytes_written: bytes,
        error: None,
    })
}

/// S-EXP-007: open the OS print dialog from the active preview window.
#[tauri::command]
pub async fn export_print(app: AppHandle) -> AppResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::NotFound("main window not found".into()))?;
    window
        .print()
        .map_err(|e| AppError::Invalid(format!("print failed: {e}")))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDocument {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExportRequest {
    pub format: String,
    pub documents: Vec<BatchDocument>,
    pub output_dir: String,
    pub template: ExportTemplate,
    pub page_setup: Option<PageSetup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExportResult {
    pub failures: Vec<BatchFailure>,
}

fn render_markdown(md: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(md, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

/// Strip path separators so a document title can safely become a file
/// name inside the chosen output directory.
fn safe_file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

/// S-EXP-008: batch export. Failures are collected, not fatal — one bad
/// document doesn't abort the run.
#[tauri::command]
pub async fn export_batch(req: BatchExportRequest) -> AppResult<BatchExportResult> {
    let format = req.format.to_lowercase();
    if !matches!(format.as_str(), "html" | "pdf" | "docx" | "epub") {
        return Err(AppError::Invalid(format!(
            "unsupported export format: {format}"
        )));
    }
    let ext = format.as_str();
    let out_dir = PathBuf::from(&req.output_dir);
    std::fs::create_dir_all(&out_dir).map_err(AppError::Io)?;

    let mut failures = Vec::new();
    for doc in &req.documents {
        let md = match std::fs::read_to_string(&doc.path) {
            Ok(s) => s,
            Err(e) => {
                failures.push(BatchFailure {
                    path: doc.path.clone(),
                    reason: format!("read: {e}"),
                });
                continue;
            }
        };
        let single = ExportRequest {
            format: format.clone(),
            document_path: Some(doc.path.clone()),
            body_html: render_markdown(&md),
            title: doc.title.clone(),
            template: req.template.clone(),
            page_setup: req.page_setup.clone(),
            inline_external_assets: false,
            output_path: Some(
                out_dir
                    .join(format!("{}.{ext}", safe_file_stem(&doc.title)))
                    .display()
                    .to_string(),
            ),
        };
        match export_document(single).await {
            Ok(r) if r.ok => {}
            Ok(r) => failures.push(BatchFailure {
                path: doc.path.clone(),
                reason: r
                    .error
                    .map(|e| e.message)
                    .unwrap_or_else(|| "export failed".into()),
            }),
            Err(e) => failures.push(BatchFailure {
                path: doc.path.clone(),
                reason: e.to_string(),
            }),
        }
    }
    Ok(BatchExportResult { failures })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_markdown_table() {
        let html = render_markdown("| a | b |\n|---|---|\n| 1 | 2 |");
        assert!(html.contains("<table>"));
    }

    #[test]
    fn safe_stem_strips_separators() {
        assert_eq!(safe_file_stem("a/b:c"), "a_b_c");
        assert_eq!(safe_file_stem("   "), "untitled");
    }

    #[test]
    fn page_css_emits_at_page() {
        let setup = PageSetup {
            size: "A4".into(),
            custom_width_in: None,
            custom_height_in: None,
            margins_in: Margins {
                top: 1.0,
                right: 1.0,
                bottom: 1.0,
                left: 1.0,
            },
            orientation: "portrait".into(),
            header: None,
            footer: None,
        };
        assert!(page_css(&setup).contains("@page"));
    }
}
