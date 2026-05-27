// S-PL-SEC-001 sample (MAR-1020): wireweave wireframe codeblock plugin.
//
// Tiny grammar:
//   [label]            — declares a rectangle named "label".
//   A -> B             — draws an arrow from box A to box B.
//
// Each box gets the next column slot; arrows are simple horizontal /
// diagonal lines. The point of this sample is to show a non-trivial
// renderer that still fits in one file with zero deps.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parse(source) {
  const boxes = new Map();
  const arrows = [];
  const lines = source.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const boxMatch = /^\[([^\]]{1,32})\]$/.exec(line);
    if (boxMatch) {
      const label = boxMatch[1];
      if (!boxes.has(label)) boxes.set(label, boxes.size);
      continue;
    }
    const arrowMatch = /^([A-Za-z0-9_ -]{1,32})\s*->\s*([A-Za-z0-9_ -]{1,32})$/.exec(line);
    if (arrowMatch) {
      const from = arrowMatch[1].trim();
      const to = arrowMatch[2].trim();
      if (!boxes.has(from)) boxes.set(from, boxes.size);
      if (!boxes.has(to)) boxes.set(to, boxes.size);
      arrows.push({ from, to });
    }
    // Unknown lines are silently ignored — this keeps the parser tolerant
    // for partial drafts as the user types.
  }
  return { boxes, arrows };
}

function renderSvg(source) {
  const { boxes, arrows } = parse(source);
  if (boxes.size === 0) {
    return {
      kind: "html",
      html: '<div class="ms-wireweave-empty" data-testid="ms-wireweave-empty">No boxes</div>',
    };
  }
  const BOX_W = 100;
  const BOX_H = 40;
  const GAP = 40;
  const ROW_Y = 40;
  const width = boxes.size * (BOX_W + GAP) + GAP;
  const height = ROW_Y + BOX_H + GAP;
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" data-testid="ms-wireweave-svg" width="${width}" height="${height}">`,
  );
  parts.push(
    '<defs><marker id="ww-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#555"/></marker></defs>',
  );
  const positions = new Map();
  for (const [label, index] of boxes) {
    const x = GAP + index * (BOX_W + GAP);
    positions.set(label, { x, y: ROW_Y, cx: x + BOX_W / 2, cy: ROW_Y + BOX_H / 2 });
    parts.push(
      `<rect x="${x}" y="${ROW_Y}" width="${BOX_W}" height="${BOX_H}" rx="4" fill="#fff" stroke="#555"/>`,
    );
    const textX = x + BOX_W / 2;
    const textY = ROW_Y + BOX_H / 2 + 4;
    parts.push(
      `<text x="${textX}" y="${textY}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#222">${escapeHtml(label)}</text>`,
    );
  }
  for (const arrow of arrows) {
    const a = positions.get(arrow.from);
    const b = positions.get(arrow.to);
    if (!a || !b) continue;
    const fromX = a.cx < b.cx ? a.x + BOX_W : a.x;
    const toX = a.cx < b.cx ? b.x : b.x + BOX_W;
    parts.push(
      `<line x1="${fromX}" y1="${a.cy}" x2="${toX}" y2="${b.cy}" stroke="#555" marker-end="url(#ww-arrow)"/>`,
    );
  }
  parts.push("</svg>");
  return { kind: "html", html: parts.join("") };
}

self.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "host:init") {
    self.postMessage({
      type: "plugin:ready",
      registered: [{ kind: "codeblock", key: "wireweave" }],
    });
    return;
  }
  if (msg.type === "hook:invoke" && msg.kind === "codeblock" && msg.key === "wireweave") {
    self.postMessage({
      type: "hook:result",
      requestId: msg.requestId,
      result: renderSvg(msg.payload.source),
    });
  }
});
