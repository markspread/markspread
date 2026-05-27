// S-PL-SEC-001 sample (MAR-1020): mermaid codeblock plugin (stub).
//
// 의도적으로 mermaid.js 를 번들하지 않는다 — runtime cost 가 v1.3 의
// 가벼움 원칙(ADR-0007)을 위배한다. 본 plugin 은 실제 SVG 대신
// "[mermaid: …source…]" placeholder 를 렌더한다. 사용자가 본인 환경에서
// `import mermaid from "https://esm.sh/mermaid"` 를 추가하면 진짜 렌더링이
// 동작한다 (단, manifest 의 permissions 에 network 추가 필요).

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMermaid(source) {
  const escaped = escapeHtml(source);
  return {
    kind: "html",
    html: `<div class="ms-mermaid-stub" data-testid="ms-mermaid-stub" style="font-family: monospace; padding: 8px; border: 1px dashed #888; background: #f6f6f6; color: #333;">[mermaid: ${escaped}]</div>`,
  };
}

self.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "host:init") {
    self.postMessage({
      type: "plugin:ready",
      registered: [{ kind: "codeblock", key: "mermaid" }],
    });
    return;
  }
  if (msg.type === "hook:invoke" && msg.kind === "codeblock" && msg.key === "mermaid") {
    self.postMessage({
      type: "hook:result",
      requestId: msg.requestId,
      result: renderMermaid(msg.payload.source),
    });
  }
});
