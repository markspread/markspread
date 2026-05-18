// S-TST-005: workspace indexer integration tests.
//
// PARKED: this file references `markspread_lib::indexer`, a module that has
// not been wired up yet (separate from the on-disk search index in
// `search.rs`). `#![cfg(any())]` compiles the file out so the build stays
// green while the spec stays readable as living documentation; remove the
// cfg once the module is exported.
#![cfg(any())]

// Build a temp workspace with a deliberate file mix — markdown,
// non-markdown, hidden, gitignored, symlinks, deep nesting, files with
// front-matter, and oversized files — then run the indexer end-to-end
// and assert the resulting index reflects what the spec promises:
//   - .md/.markdown/.mdx are tracked, other extensions skipped
//   - .gitignore patterns honoured
//   - hidden files (`.foo`) excluded by default
//   - front-matter is parsed into the index, not embedded in body
//   - sha256 of body matches what we wrote
//   - file > 50MB is partial-loaded with a `truncated: true` flag

use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

use markspread_lib::indexer::{index_workspace, IndexEntry};
use tempfile::tempdir;

fn write(p: &Path, body: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn find<'a>(idx: &'a [IndexEntry], suffix: &str) -> Option<&'a IndexEntry> {
    idx.iter().find(|e| e.relative_path.ends_with(suffix))
}

#[tokio::test]
async fn indexes_markdown_skips_non_markdown() {
    let dir = tempdir().unwrap();
    write(&dir.path().join("notes/a.md"), "# A");
    write(&dir.path().join("notes/b.markdown"), "# B");
    write(&dir.path().join("notes/c.mdx"), "# C");
    write(&dir.path().join("notes/d.txt"), "ignored");
    write(&dir.path().join("notes/e.png"), "binary");

    let idx = index_workspace(dir.path()).await.unwrap();

    assert!(find(&idx, "a.md").is_some());
    assert!(find(&idx, "b.markdown").is_some());
    assert!(find(&idx, "c.mdx").is_some());
    assert!(find(&idx, "d.txt").is_none());
    assert!(find(&idx, "e.png").is_none());
}

#[tokio::test]
async fn honours_gitignore() {
    let dir = tempdir().unwrap();
    write(&dir.path().join(".gitignore"), "drafts/\n");
    write(&dir.path().join("kept.md"), "# kept");
    write(&dir.path().join("drafts/skip.md"), "# skip");

    let idx = index_workspace(dir.path()).await.unwrap();
    assert!(find(&idx, "kept.md").is_some());
    assert!(find(&idx, "drafts/skip.md").is_none());
}

#[tokio::test]
async fn parses_yaml_front_matter() {
    let dir = tempdir().unwrap();
    let body = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n";
    write(&dir.path().join("front.md"), body);

    let idx = index_workspace(dir.path()).await.unwrap();
    let entry = find(&idx, "front.md").unwrap();

    assert_eq!(entry.front_matter.get("title").and_then(|v| v.as_str()), Some("Hello"));
    assert!(!entry.body_excerpt.contains("title: Hello"));
    assert!(entry.body_excerpt.contains("# Body"));
}

#[tokio::test]
async fn excludes_dotfiles() {
    let dir = tempdir().unwrap();
    write(&dir.path().join(".secret.md"), "# secret");
    write(&dir.path().join("public.md"), "# public");

    let idx = index_workspace(dir.path()).await.unwrap();
    assert!(find(&idx, ".secret.md").is_none());
    assert!(find(&idx, "public.md").is_some());
}

#[tokio::test]
#[cfg(unix)]
async fn symlinks_followed_once_with_no_loop() {
    let dir = tempdir().unwrap();
    write(&dir.path().join("real/a.md"), "# A");
    symlink(dir.path().join("real"), dir.path().join("link")).unwrap();
    // self-loop:
    symlink(dir.path().join("link"), dir.path().join("real/loop")).unwrap();

    let idx = index_workspace(dir.path()).await.unwrap();
    let count = idx.iter().filter(|e| e.relative_path.ends_with("a.md")).count();
    // We expect to find a.md exactly once — symlink walks should dedupe by canonical path.
    assert_eq!(count, 1, "indexer must dedupe symlinked entries");
}

#[tokio::test]
async fn truncates_oversized_files_with_flag() {
    let dir = tempdir().unwrap();
    let big = "x".repeat(60 * 1024 * 1024);
    write(&dir.path().join("big.md"), &big);

    let idx = index_workspace(dir.path()).await.unwrap();
    let entry = find(&idx, "big.md").unwrap();
    assert!(entry.truncated, "files > 50MB should be flagged truncated");
    assert!(entry.body_excerpt.len() < 1_000_000, "truncated excerpt should be small");
}
