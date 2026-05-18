// S-PSDK-001: ParserManifest 스키마. 호스트(Markspread)는 이 manifest 를 검증하여
// 파서를 등록한다. 검증 실패 시 파서는 registry 에 들어가지 않는다.
//
// fileMatch 는 extensions / globs / frontmatterSniff 셋 중 최소 하나는 필수.
// 모두 비어있는 manifest 는 어떤 파일에도 매칭되지 않아 무용지물이므로 거부.

import { z } from "zod";

const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// SemVer subset: MAJOR.MINOR.PATCH (+ optional pre-release/build).
const semverPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

const extensionPattern = /^\.[a-z0-9][a-z0-9.]*$/i;

const FileMatchSchema = z
  .object({
    extensions: z.array(z.string().regex(extensionPattern)).optional(),
    globs: z.array(z.string().min(1)).optional(),
    frontmatterSniff: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .refine(
    (m) =>
      (m.extensions && m.extensions.length > 0) ||
      (m.globs && m.globs.length > 0) ||
      (m.frontmatterSniff && Object.keys(m.frontmatterSniff).length > 0),
    {
      message: "fileMatch must declare at least one of: extensions, globs, frontmatterSniff",
    },
  );

export const ParserManifestSchema = z.object({
  id: z.string().min(1).regex(slugPattern, "id must be lowercase slug (a-z0-9-)"),
  version: z.string().regex(semverPattern, "version must be semver MAJOR.MINOR.PATCH"),
  displayName: z.string().min(1).max(80),
  fileMatch: FileMatchSchema,
  capabilities: z.enum(["preview-only", "preview-plus-edit"]),
  entry: z.string().min(1),
});

export type ParserManifest = z.infer<typeof ParserManifestSchema>;
export type FileMatch = z.infer<typeof FileMatchSchema>;

export type ManifestParseResult =
  | { ok: true; manifest: ParserManifest }
  | { ok: false; issues: { path: string; message: string }[] };

export function parseManifest(input: unknown): ManifestParseResult {
  const result = ParserManifestSchema.safeParse(input);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
