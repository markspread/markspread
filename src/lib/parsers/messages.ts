// S-PSDK-003: parser ↔ host postMessage 스키마.
//
// Worker/iframe 격리에서 신뢰할 수 없는 출력을 받기 때문에 host 는 모든
// 인입 메시지를 zod 로 검증한 뒤에만 처리한다. 스키마에서 떨어지는
// payload (스크립트 삽입을 위한 추가 필드 포함) 는 조용히 폐기되고
// 보안 감사 로그(S-SE-AUDIT-001)로 기록된다.

import { z } from "zod";

export const ParseRequestSchema = z.object({
  type: z.literal("parse"),
  requestId: z.string().min(1),
  parserId: z.string().min(1),
  path: z.string(),
  content: z.string(),
  encoding: z.string(),
});
export type ParseRequest = z.infer<typeof ParseRequestSchema>;

export const ParseResponseSchema = z.object({
  type: z.literal("parse:ok"),
  requestId: z.string().min(1),
  parserId: z.string().min(1),
  // 파서 출력의 두 형태:
  // - 'html' : 이미 HTML 문자열로 렌더된 결과. host 가 sanitize 통과시킨다.
  // - 'ast'  : 임의 JSON. host 측 React 렌더러가 받아 자체적으로 출력.
  result: z.union([
    z.object({ kind: z.literal("html"), html: z.string() }),
    z.object({ kind: z.literal("ast"), ast: z.unknown() }),
  ]),
  warnings: z.array(z.string()).optional(),
});
export type ParseResponse = z.infer<typeof ParseResponseSchema>;

export const ParseErrorSchema = z.object({
  type: z.literal("parse:err"),
  requestId: z.string().min(1),
  parserId: z.string().min(1),
  message: z.string(),
  stack: z.string().optional(),
});
export type ParseError = z.infer<typeof ParseErrorSchema>;

export const ParserMessageSchema = z.discriminatedUnion("type", [
  ParseRequestSchema,
  ParseResponseSchema,
  ParseErrorSchema,
]);
export type ParserMessage = z.infer<typeof ParserMessageSchema>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Host 가 sandbox 로부터 받은 raw 메시지를 검증한다. 알 수 없는 필드는
 * zod 의 strict 거동 대신 strip 되지만, 알려진 필드의 타입이 어긋나면
 * 거부된다.
 */
export function validateIncomingMessage(raw: unknown): ValidationResult<ParserMessage> {
  const result = ParserMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, reason: result.error.issues[0]?.message ?? "invalid message" };
}
