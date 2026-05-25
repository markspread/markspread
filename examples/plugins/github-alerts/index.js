// S-PL-SEC-001 sample: GitHub-style alerts plugin.
//
// 이 플러그인은 :::note / :::warning / :::tip 세 fence 를 styled callout
// div 로 렌더한다. 본 모듈은 Web Worker 환경에서 import 되며, host 의
// `host:init` 메시지를 받자마자 `plugin:ready` 로 응답한 뒤 hook:invoke
// 요청을 처리한다.
//
// 의도적으로 *외부 의존성 없음* — manifest 의 permissions 가 빈 배열이고
// fetch / DOM 접근 없이 순수 string 변환만 한다.

const KINDS = {
  note: { label: "Note", color: "#0969da" },
  warning: { label: "Warning", color: "#bf8700" },
  tip: { label: "Tip", color: "#1a7f37" },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAlert(kind, body) {
  const meta = KINDS[kind];
  if (!meta) {
    return {
      kind: "html",
      html: `<div class="ms-plugin-error">unknown alert: ${escapeHtml(kind)}</div>`,
    };
  }
  return {
    kind: "html",
    html:
      `<div class="ms-alert ms-alert-${kind}" data-testid="ms-alert-${kind}" ` +
      `style="border-left: 4px solid ${meta.color}; padding: 8px 12px; margin: 8px 0; background: ${meta.color}11;">` +
      `<strong style="color: ${meta.color};">${meta.label}</strong>` +
      `<div>${escapeHtml(body).replace(/\n/g, "<br>")}</div>` +
      `</div>`,
  };
}

// Worker bootstrap — host 와의 메시지 채널을 연결한다.
self.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "host:init") {
    self.postMessage({
      type: "plugin:ready",
      registered: [
        { kind: "fence", key: "note" },
        { kind: "fence", key: "warning" },
        { kind: "fence", key: "tip" },
      ],
    });
    return;
  }
  if (msg.type === "hook:invoke" && msg.kind === "fence") {
    const result = renderAlert(msg.key, msg.payload.source);
    self.postMessage({
      type: "hook:result",
      requestId: msg.requestId,
      result,
    });
  }
});
