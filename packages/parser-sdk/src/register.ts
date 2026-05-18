// S-PSDK-001: registerParser / registerRenderer 호스트 API.
//
// Parser registry 자체(우선순위, 매칭)는 S-PSDK-002 에서 채워진다. 본 SDK 는
// 등록 시그니처와 타입만 노출하여 플러그인 작성자가 import 할 안정된 표면을
//정의한다. host 측은 setRegistryHost() 로 실제 구현을 주입하고, 플러그인
// 모듈이 호출하는 register* 는 그 핸들러로 위임된다.

import type { ComponentType } from "react";
import type { ParserManifest } from "./manifest";

export type ParseInput = {
  path: string;
  content: string;
  encoding: string;
};

export type ParseOutput = {
  ast: unknown;
  warnings?: string[];
};

export type ParserFactory = (input: ParseInput) => ParseOutput | Promise<ParseOutput>;

export type RendererSpec =
  | {
      kind: "react";
      parserId: string;
      component: ComponentType<{ ast: unknown; path: string }>;
    }
  | {
      kind: "html";
      parserId: string;
      render: (ast: unknown, ctx: { path: string }) => string;
    };

export type RegistryHost = {
  registerParser: (manifest: ParserManifest, factory: ParserFactory) => void;
  registerRenderer: (spec: RendererSpec) => void;
};

let host: RegistryHost | null = null;

export function setRegistryHost(next: RegistryHost | null): void {
  host = next;
}

export function registerParser(manifest: ParserManifest, factory: ParserFactory): void {
  if (!host) {
    throw new Error(
      "registerParser called before host registry was initialized. " +
        "The plugin module was loaded outside Markspread, or before the SDK boot.",
    );
  }
  host.registerParser(manifest, factory);
}

export function registerRenderer(spec: RendererSpec): void {
  if (!host) {
    throw new Error(
      "registerRenderer called before host registry was initialized.",
    );
  }
  host.registerRenderer(spec);
}
