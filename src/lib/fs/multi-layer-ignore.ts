// ADR-0014 (T2.h): 다층 ignore matcher — `.gitignore` (default on) + `.markspreadignore` (옵션).
//
// 의도적으로 외부 의존성 없음 (`ignore` npm 패키지 미사용) — 본 도구의 가벼움
// 정책. *완전한* gitignore spec 구현은 아님 — 본 도구가 실제로 만나는 패턴만
// cover (90/10 규칙: 흔한 패턴 90% 정확, drop edge cases).
//
// 지원:
//   - blank line, # comment skip
//   - leading `!` negation
//   - trailing `/` directory-only
//   - leading `/` anchored to root
//   - `*` wildcard (segment 내)
//   - `**` deep wildcard
//   - `?` single char
//   - 후행 패턴이 선행 패턴을 override (gitignore 동작)

export interface IgnoreLayer {
  /** layer 식별 (debug·source 표시). */
  source: string;
  /** ignore 본문 (.gitignore 또는 .markspreadignore 의 raw text). */
  text: string;
  /** layer 가 적용될 root (absolute, OS path). 보통 workspace root. */
  rootDir: string;
}

interface CompiledRule {
  /** original line for debug */
  raw: string;
  /** match 결과를 negation 으로 처리 */
  negate: boolean;
  /** 디렉토리만 매치 */
  dirOnly: boolean;
  /** RegExp 변환된 patterns */
  pattern: RegExp;
}

function compileRule(line: string): CompiledRule | null {
  let trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;

  let negate = false;
  if (trimmed.startsWith("!")) {
    negate = true;
    trimmed = trimmed.slice(1);
  }

  let dirOnly = false;
  if (trimmed.endsWith("/")) {
    dirOnly = true;
    trimmed = trimmed.slice(0, -1);
  }

  let anchored = false;
  if (trimmed.startsWith("/")) {
    anchored = true;
    trimmed = trimmed.slice(1);
  }

  // glob → regex
  // escape regex meta chars except our wildcards.
  // 특수 케이스: 선행 `**/` 는 *0개 이상* segment + slash 매치 (gitignore 의 zero-or-more 의미).
  let consumed = 0;
  let leadingDoubleStar = false;
  if (trimmed.startsWith("**/")) {
    leadingDoubleStar = true;
    consumed = 3;
  }
  let re = "";
  for (let i = consumed; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];
    if (ch === "*" && next === "*") {
      re += ".*";
      i += 1;
    } else if (ch === "*") {
      re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch && "/.+(){}|^$\\".includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }

  // anchored = 무조건 root 부터.
  // leadingDoubleStar = root 또는 임의 subdir 시작 가능.
  // 그 외 (디폴트) = root 시작 또는 `/` 후 시작.
  let prefix: string;
  if (anchored) prefix = "^";
  else if (leadingDoubleStar) prefix = "(^|/)";
  else prefix = "(^|/)";
  const pattern = new RegExp(`${prefix}${re}(/|$)`);

  return { raw: line, negate, dirOnly, pattern };
}

/** 한 layer 의 compiled rules. */
interface CompiledLayer {
  source: string;
  rootDir: string;
  rules: CompiledRule[];
}

export class MultiLayerIgnore {
  private readonly layers: CompiledLayer[];

  constructor(layers: readonly IgnoreLayer[]) {
    this.layers = layers.map((l) => ({
      source: l.source,
      rootDir: l.rootDir,
      rules: l.text
        .split(/\r?\n/)
        .map(compileRule)
        .filter((r): r is CompiledRule => r !== null),
    }));
  }

  /**
   * 주어진 absolute path 가 ignore 되는가.
   * isDirectory 플래그 — directory-only 룰 (`foo/`) 매칭 시 사용.
   */
  isIgnored(absolutePath: string, isDirectory = false): boolean {
    let ignored = false;

    for (const layer of this.layers) {
      const rel = toRelative(absolutePath, layer.rootDir);
      if (rel === null) continue; // path outside this layer's root

      for (const rule of layer.rules) {
        if (rule.dirOnly && !isDirectory) continue;
        if (rule.pattern.test(rel)) {
          ignored = !rule.negate;
        }
      }
    }
    return ignored;
  }

  /**
   * 디버그·진단용 — 모든 매칭 룰 enumerate. UI 의 "왜 숨김?" 패널.
   */
  explain(
    absolutePath: string,
    isDirectory = false,
  ): Array<{
    layer: string;
    rule: string;
    negate: boolean;
  }> {
    const matches: Array<{ layer: string; rule: string; negate: boolean }> = [];
    for (const layer of this.layers) {
      const rel = toRelative(absolutePath, layer.rootDir);
      if (rel === null) continue;
      for (const rule of layer.rules) {
        if (rule.dirOnly && !isDirectory) continue;
        if (rule.pattern.test(rel)) {
          matches.push({ layer: layer.source, rule: rule.raw, negate: rule.negate });
        }
      }
    }
    return matches;
  }
}

/**
 * absolute path → root 기준 forward-slash 상대 경로. root 밖이면 null.
 */
function toRelative(abs: string, root: string): string | null {
  const a = abs.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (a === r) return "";
  if (a.startsWith(`${r}/`)) return a.slice(r.length + 1);
  return null;
}

/**
 * 편의 — workspace root 의 .gitignore + .markspreadignore 텍스트를 받아서
 * `MultiLayerIgnore` 생성. 호출자가 파일 시스템에서 두 파일을 읽어 전달.
 */
export function fromWorkspaceFiles(
  workspaceRoot: string,
  files: { gitignore?: string | undefined; markspreadignore?: string | undefined },
): MultiLayerIgnore {
  const layers: IgnoreLayer[] = [];
  if (files.gitignore != null) {
    layers.push({ source: ".gitignore", text: files.gitignore, rootDir: workspaceRoot });
  }
  if (files.markspreadignore != null) {
    layers.push({
      source: ".markspreadignore",
      text: files.markspreadignore,
      rootDir: workspaceRoot,
    });
  }
  return new MultiLayerIgnore(layers);
}
