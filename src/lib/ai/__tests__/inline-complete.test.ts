// S-AI-025 / S-AI-026: inline completion store coverage.

import { beforeEach, describe, expect, it } from "vitest";
import {
  INLINE_COMPLETE_DEBOUNCE_MS,
  type InlineSuggestion,
  useInlineComplete,
} from "../inline-complete";

const suggestion: InlineSuggestion = { id: "s1", text: " ghost", anchorOffset: 10 };

beforeEach(() => {
  useInlineComplete.setState({ enabled: false, suggestion: null });
});

describe("useInlineComplete", () => {
  it("defaults to disabled with no suggestion", () => {
    expect(useInlineComplete.getState().enabled).toBe(false);
    expect(useInlineComplete.getState().suggestion).toBeNull();
  });

  it("show is ignored while disabled", () => {
    useInlineComplete.getState().show(suggestion);
    expect(useInlineComplete.getState().suggestion).toBeNull();
  });

  it("show stores the suggestion once enabled", () => {
    useInlineComplete.getState().setEnabled(true);
    useInlineComplete.getState().show(suggestion);
    expect(useInlineComplete.getState().suggestion).toEqual(suggestion);
  });

  it("disabling clears any active suggestion", () => {
    useInlineComplete.setState({ enabled: true, suggestion });
    useInlineComplete.getState().setEnabled(false);
    expect(useInlineComplete.getState().suggestion).toBeNull();
  });

  it("accept returns the suggestion and clears it", () => {
    useInlineComplete.setState({ enabled: true, suggestion });
    const accepted = useInlineComplete.getState().accept();
    expect(accepted).toEqual(suggestion);
    expect(useInlineComplete.getState().suggestion).toBeNull();
  });

  it("accept returns null when there is nothing to accept", () => {
    expect(useInlineComplete.getState().accept()).toBeNull();
  });

  it("reject clears the suggestion", () => {
    useInlineComplete.setState({ enabled: true, suggestion });
    useInlineComplete.getState().reject();
    expect(useInlineComplete.getState().suggestion).toBeNull();
  });

  it("invalidate clears the suggestion", () => {
    useInlineComplete.setState({ enabled: true, suggestion });
    useInlineComplete.getState().invalidate();
    expect(useInlineComplete.getState().suggestion).toBeNull();
  });

  it("exposes a conservative debounce constant", () => {
    expect(INLINE_COMPLETE_DEBOUNCE_MS).toBe(600);
  });
});
