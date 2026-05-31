// MAR-1031 (ADR-0013): VSCode 호환 spec 의 *공통 검증 유틸* 분리.
//
// 기존 vscode-compat.ts 가 import 방향 (VSCode → Markspread) 만 가졌고
// ADR-0013 결정 (export only) 에 따라 *export 방향* (Markspread → VSCode)
// 모듈을 신규 추가하면서, 양방향에서 재사용 가능한 *순수 검증 함수*
// (name normalization, relative path safety) 를 별도 모듈로 추출.
//
// 두 방향 translator (import: deprecated dev-helper / export: production)
// 모두 이 모듈에 의존. 검증 로직 한 곳에서만 진화.

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * VSCode/Cursor 스타일 패키지 이름 → Markspread plugin 슬러그.
 * scope 제거, 소문자, 비-알파뉴메릭 → 하이픈, 32자 cap.
 * 결과는 NAME_RE 통과 필요.
 */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function isValidName(slug: string): boolean {
  return NAME_RE.test(slug);
}

/**
 * 플러그인 디렉토리 내 *상대 경로 자산* 인지 검증.
 * 거부: 절대 경로 (`/...`), 윈도우 드라이브 (`C:\...`), NUL 바이트,
 *      `..` 세그먼트 (디렉토리 탈출).
 * 허용: `./foo.css`, `out/preview.js`, `styles/mermaid.css` 등.
 */
export function isRelativeAsset(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (p.includes("\0")) return false;
  const normalised = p.replace(/\\/g, "/");
  for (const seg of normalised.split("/")) {
    if (seg === "..") return false;
  }
  return true;
}

/**
 * 상대 경로의 `./` prefix 제거 (정규화).
 * 호출자가 검증 후 캐노니컬 경로 저장할 때 사용.
 */
export function stripLeadingDot(p: string): string {
  return p.replace(/^\.\//, "");
}
