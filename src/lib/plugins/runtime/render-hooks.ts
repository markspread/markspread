// S-PL-SEC-001: ADR-0012 hook 디스패처 — markdown 렌더 결과를 PluginHost 가
// 우선 처리하도록 끼어 들어가는 시각화 층.
//
// 본 모듈은 두 가지 hook 점을 지원한다:
//
//   1. fenced code block (```lang ... ```)  — `codeblocks.lang` contribution.
//   2. custom fence (`:::name ... :::`)     — `fences[*]` contribution.
//
// 헤더 / inline 패턴은 의도적으로 v1.3 에서는 제외 (host hookable 한 점이
// 너무 많아져 sanitiser regression risk — D7 의 "모든 응답은
// sanitiseMarkdownHtml 통과" 와 직교). 후속 ticket 으로 분리.
//
// 입력은 *이미 unified/remark 로 파싱된 HTML 문자열* 이다 (preview/render.ts
// 의 출력). 우리는 HTML 안에서 fenced block 의 모양 (`<pre><code
// class="language-X">`) 과 custom fence 의 모양 (` <p>:::X</p>`) 을
// 정규식 단위로 찾아 plugin 결과로 교체한다. 본 정규식은 sanitiseMarkdownHtml
// 통과 후의 형태에 맞춘다.

import type { PluginHost } from "./host";
import type { RenderResult } from "./types";

const CODE_BLOCK_RE = /<pre><code(?:\s+class="language-([\w+-]+)")?>([\s\S]*?)<\/code><\/pre>/g;

/**
 * Custom fence 는 remark-gfm 의 ``` 블록 확장이 아니라 단순 단락으로
 * 떨어진다 — `:::name` 으로 열고 `:::` 로 닫는다. unified 가 그대로
 * 둔다는 가정 (preview/render.ts 의 default pipeline). 우리는 paragraph 의
 * 인접한 두 개를 한 fence 로 결합한다.
 *
 * 정규식 패턴은 fence 가 줄 단위로 떨어진 경우 한 단락이 통째로 매칭되도록
 * 작성. 본문에 HTML 이 섞여 있어도 부분 매칭이 fence 처리에 끼어들지
 * 않도록 paragraph 시작/끝 경계를 강제한다.
 */
const FENCE_RE = /<p>:::([a-z][a-z0-9-]{0,31})\s*\n?([\s\S]*?)\n?:::<\/p>/g;

export interface DispatchContext {
  documentPath: string | null;
}

/**
 * Plugin host 가 모르는 lang/name 은 원본 HTML 을 그대로 둔다. plugin
 * 호출이 실패하면 audit log 만 남기고 원본을 그대로 둔다 (graceful
 * degradation — 문서는 항상 보여야 한다).
 */
export async function applyPluginHooks(
  html: string,
  host: PluginHost,
  ctx: DispatchContext,
): Promise<string> {
  let next = await replaceCodeblocks(html, host, ctx);
  next = await replaceFences(next, host, ctx);
  return next;
}

async function replaceCodeblocks(
  html: string,
  host: PluginHost,
  ctx: DispatchContext,
): Promise<string> {
  const matches = Array.from(html.matchAll(CODE_BLOCK_RE));
  if (matches.length === 0) return html;
  const parts: string[] = [];
  let last = 0;
  for (const m of matches) {
    const start = m.index ?? 0;
    parts.push(html.slice(last, start));
    const lang = m[1] ?? "";
    const code = decodeEntities(m[2] ?? "");
    const replaced = await maybeRenderCodeblock(host, lang, code, ctx);
    parts.push(replaced ?? m[0]);
    last = start + m[0].length;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

async function replaceFences(
  html: string,
  host: PluginHost,
  ctx: DispatchContext,
): Promise<string> {
  const matches = Array.from(html.matchAll(FENCE_RE));
  if (matches.length === 0) return html;
  const parts: string[] = [];
  let last = 0;
  for (const m of matches) {
    const start = m.index ?? 0;
    parts.push(html.slice(last, start));
    const name = m[1] ?? "";
    const body = decodeEntities(m[2] ?? "");
    const replaced = await maybeRenderFence(host, name, body, ctx);
    parts.push(replaced ?? m[0]);
    last = start + m[0].length;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

async function maybeRenderCodeblock(
  host: PluginHost,
  lang: string,
  source: string,
  ctx: DispatchContext,
): Promise<string | null> {
  if (lang === "") return null;
  const result = await host.renderCodeblock(lang, source, ctx);
  return resolveHtml(result);
}

async function maybeRenderFence(
  host: PluginHost,
  name: string,
  source: string,
  ctx: DispatchContext,
): Promise<string | null> {
  const result = await host.renderFence(name, source, ctx);
  return resolveHtml(result);
}

function resolveHtml(result: RenderResult | null): string | null {
  if (!result) return null;
  if (result.kind === "html") return result.html;
  // react / error → 원본 유지. error 는 caller 측 telemetry 가 처리.
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
