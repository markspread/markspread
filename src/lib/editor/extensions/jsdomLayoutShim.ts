// Test-only side-effect import: install jsdom Range layout shims.
//
// CodeMirror's async `measure()` pass (scheduled on an animation
// frame after `dispatch`) calls `Range.getClientRects()` and
// `Range.getBoundingClientRect()`. jsdom leaves the Range versions
// unimplemented, so the deferred callback throws an uncaught
// TypeError. We stub both with empty results — command/selection
// tests never assert on geometry, so empty rects are harmless.

if (typeof Range !== "undefined") {
  const emptyRectList = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* emptyIter() {
      // no rects
    },
  } as unknown as DOMRectList;
  const emptyRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  } as DOMRect;
  Range.prototype.getClientRects = () => emptyRectList;
  Range.prototype.getBoundingClientRect = () => emptyRect;
}
