// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as registerFromSource from "../lib/parsers/register-from-source";
import { __resetParserRegistryForTests, getParserRegistry } from "../lib/parsers/registry";
import { CreateParserDialog } from "./CreateParserDialog";

// Wrap the real module so tests can delegate to the genuine implementation by
// default but override `registerParserFromSource` for a single error-path case.
vi.mock("../lib/parsers/register-from-source", async () => {
  const actual = await vi.importActual<typeof import("../lib/parsers/register-from-source")>(
    "../lib/parsers/register-from-source",
  );
  return {
    ...actual,
    registerParserFromSource: vi.fn(actual.registerParserFromSource),
    unregisterParser: vi.fn(actual.unregisterParser),
  };
});

const registerSpy = vi.mocked(registerFromSource.registerParserFromSource);
const unregisterSpy = vi.mocked(registerFromSource.unregisterParser);
const realRegister = (
  await vi.importActual<typeof import("../lib/parsers/register-from-source")>(
    "../lib/parsers/register-from-source",
  )
).registerParserFromSource;

beforeEach(() => {
  __resetParserRegistryForTests();
  registerSpy.mockImplementation(realRegister);
  unregisterSpy.mockClear();
});
afterEach(() => {
  cleanup();
  __resetParserRegistryForTests();
});

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  fireEvent.change(el, { target: { value: v } });
};

describe("CreateParserDialog", () => {
  it("hides when open=false", () => {
    const { container } = render(<CreateParserDialog open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders fields + create button when open", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    expect(screen.getByTestId("parser-id")).toBeTruthy();
    expect(screen.getByTestId("parser-extensions")).toBeTruthy();
    expect(screen.getByTestId("parser-source")).toBeTruthy();
    expect(screen.getByTestId("parser-create")).toBeTruthy();
  });

  it("end-to-end: Create → consent dialog(요약+전체코드) → Accept → registered + visible via match (SC-SEC-04)", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "wireweave-ui-test");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".wireweave");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: '<svg data-ww="1">' + input.content + '</svg>' } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // SC-SEC-04 계약 갱신: 등록 = 자동 동의가 아니다 — 활성 동의 다이얼로그가
    // 뜨고 (AI 요약 + 전체 코드 토글 + Accept/Reject), Accept 후 활성.
    expect(screen.getByTestId("plugin-consent-overlay")).toBeTruthy();
    fireEvent.click(screen.getByTestId("consent-toggle-code"));
    expect(screen.getByTestId("consent-full-code").textContent).toContain("data-ww");
    fireEvent.click(screen.getByTestId("consent-accept"));
    // Success UI
    expect(screen.getByTestId("parser-result-success")).toBeTruthy();
    // Registry match returns our parser
    const m = getParserRegistry().match({ path: "/x/y.wireweave" });
    expect(m?.parser.manifest.id).toBe("wireweave-ui-test");
  });

  it("re-creating an already-consented parser succeeds immediately without a consent dialog (T5.F 수정마다 X)", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "reconsented");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".rc");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    fireEvent.click(screen.getByTestId("consent-accept"));
    // 두 번째 Create — 동의가 유지되므로(already-consented) 다이얼로그 없이
    // 바로 성공 메시지 경로(lines 109-117)를 탄다.
    fireEvent.click(screen.getByTestId("parser-create"));
    expect(screen.queryByTestId("plugin-consent-overlay")).toBeNull();
    expect(screen.getByTestId("parser-result-success").textContent).toContain("등록 완료");
    expect(getParserRegistry().match({ path: "/x.rc" })?.parser.manifest.id).toBe("reconsented");
  });

  it("consent Reject rolls the registration back (SC-SEC-04)", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "rejected-parser");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".rj");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    fireEvent.click(screen.getByTestId("consent-reject"));
    expect(screen.getByTestId("parser-result-error").textContent).toContain("동의 거절");
    expect(getParserRegistry().match({ path: "/x.rj" })?.parser.manifest.id).not.toBe(
      "rejected-parser",
    );
  });

  it("shows error for syntax-broken source", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "broken");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".brk");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      "(input) => { return malformed!!!",
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    expect(screen.getByTestId("parser-result-error")).toBeTruthy();
  });

  it("rejects registration and lists violations when source has risky calls (fetch) — SC-SEC-02", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "fetchy");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".fy");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => { fetch("/x"); return { ast: { kind: "html", html: input.content } }; }`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // SC-SEC-02 계약 갱신: Validator 위반 = 등록 거부 (기존 "성공 + 위반 표시"
    // 는 R1 확정 결함). 실패 UI + 위반 목록.
    expect(screen.getByTestId("parser-result-error").textContent).toMatch(/거부/);
    expect(screen.getByTestId("parser-violations").textContent).toMatch(/network_fetch/);
    // Registry 에 미등록 — .fy 파일이 이 파서로 매칭되지 않는다.
    expect(getParserRegistry().match({ path: "/x.fy" })?.parser.manifest.id).not.toBe("fetchy");
  });

  it("Remove button unregisters", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "rmer");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".rmer");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    expect(getParserRegistry().match({ path: "/x.rmer" })?.parser.manifest.id).toBe("rmer");
    fireEvent.click(screen.getByTestId("parser-remove"));
    expect(getParserRegistry().match({ path: "/x.rmer" })?.parser.manifest.id).not.toBe("rmer");
  });

  it("close button fires onClose", () => {
    let closed = false;
    render(
      <CreateParserDialog
        open={true}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("create-parser-close"));
    expect(closed).toBe(true);
  });

  it("rejects empty id or empty extensions", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "");
    fireEvent.click(screen.getByTestId("parser-create"));
    expect(screen.getByTestId("parser-result-error").textContent).toMatch(/필수/);
  });

  it("clicking the backdrop fires onClose; clicking the dialog body does not", () => {
    let closed = 0;
    render(
      <CreateParserDialog
        open={true}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    // Clicking inside the dialog (not the overlay) should NOT close.
    fireEvent.mouseDown(screen.getByTestId("parser-id"));
    expect(closed).toBe(0);
    // Clicking the overlay itself (target === currentTarget) closes.
    fireEvent.mouseDown(screen.getByTestId("create-parser-overlay"));
    expect(closed).toBe(1);
  });

  it("edits the displayName and summary inputs", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    const display = screen.getByTestId("parser-display") as HTMLInputElement;
    const summary = screen.getByTestId("parser-summary") as HTMLInputElement;
    setValue(display, "WireWeave");
    setValue(summary, "DSL → SVG");
    expect(display.value).toBe("WireWeave");
    expect(summary.value).toBe("DSL → SVG");
  });

  it("lists registered parsers and protects the system markdown parser from removal", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    // The bootstrap markdown parser is registered + system-locked: row exists,
    // marked system, and exposes no remove button.
    const row = screen.getByTestId("parser-registry-row-builtin-markdown");
    expect(row).toBeTruthy();
    expect(row.textContent).toMatch(/시스템/);
    expect(screen.queryByTestId("parser-registry-remove-builtin-markdown")).toBeNull();
  });

  it("Edit button loads the row's id/displayName/extensions into the form", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "ww-edit");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".ww");
    setValue(screen.getByTestId("parser-display") as HTMLInputElement, "WW Display");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // Mutate the form, then click Edit on the registered row → form refills.
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "scratch");
    const row = screen.getByTestId("parser-registry-row-ww-edit");
    const editBtn = row.querySelector("button") as HTMLButtonElement;
    fireEvent.click(editBtn);
    expect((screen.getByTestId("parser-id") as HTMLInputElement).value).toBe("ww-edit");
    expect((screen.getByTestId("parser-display") as HTMLInputElement).value).toBe("WW Display");
    expect((screen.getByTestId("parser-extensions") as HTMLInputElement).value).toBe(".ww");
  });

  it("removes a non-system parser via its row trash button", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "ww-rm");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".wwr");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    expect(screen.getByTestId("parser-registry-row-ww-rm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("parser-registry-remove-ww-rm"));
    expect(screen.queryByTestId("parser-registry-row-ww-rm")).toBeNull();
  });

  it("handleRemoveById refuses to remove a system parser (error shown)", () => {
    // Register a non-system parser, then mark it system at the registry level so
    // its row still renders a remove button (UI reads the snapshot taken before
    // the lock) — clicking it exercises the system-protected guard.
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "sys-guard",
        version: "0.0.1",
        displayName: "Sys Guard",
        fileMatch: { extensions: [".sg"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      () => ({ ast: { kind: "raw", value: null } }),
    );
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    const removeBtn = screen.getByTestId("parser-registry-remove-sys-guard");
    // Lock it now; the rendered remove button is stale, so clicking hits the guard.
    reg.markSystem("sys-guard");
    fireEvent.click(removeBtn);
    expect(screen.getByTestId("parser-result-error").textContent).toMatch(/시스템 파서/);
  });

  it("falls back to id / empty extensions / (inline) for a bare manifest", () => {
    getParserRegistry().registerParser(
      { id: "bare-parser", version: "0.0.1", capabilities: "preview-only" } as never,
      () => ({ ast: { kind: "raw", value: null } }),
    );
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    const row = screen.getByTestId("parser-registry-row-bare-parser");
    // displayName falls back to id; extensions render the "(no ext)" arm.
    expect(row.textContent).toMatch(/bare-parser/);
    expect(row.textContent).toMatch(/no ext/);
  });

  it("falls back to the id as displayName and forwards a summary on create", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "named-by-id");
    // Empty display name → handleCreate falls back to id (branch at line 75).
    setValue(screen.getByTestId("parser-display") as HTMLInputElement, "   ");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".nbi");
    // Non-empty summary → the oneLinerSummary spread arm (branch at line 78).
    setValue(screen.getByTestId("parser-summary") as HTMLInputElement, "summary text");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // 동의 다이얼로그가 전달된 summary 를 표시하고, Accept 후 성공 UI.
    expect(screen.getByTestId("consent-summary").textContent).toContain("summary text");
    fireEvent.click(screen.getByTestId("consent-accept"));
    expect(screen.getByTestId("parser-result-success")).toBeTruthy();
    const row = screen.getByTestId("parser-registry-row-named-by-id");
    // displayName column shows the id because the display field was blank.
    expect(row.textContent).toMatch(/named-by-id/);
  });

  it("footer remove button is a no-op when the id field is blank", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "   ");
    fireEvent.click(screen.getByTestId("parser-remove"));
    // No success/error result is produced (handleRemove returned early, line 100).
    expect(screen.queryByTestId("parser-result-success")).toBeNull();
    expect(screen.queryByTestId("parser-result-error")).toBeNull();
  });

  it("shows a generic error message when registration fails without an error string", () => {
    registerSpy.mockReturnValue({ ok: false, violations: [] });
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "no-err");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".ne");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: input.content } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // r.error was undefined → the `?? t("...unknown")` fallback arm (line 93).
    expect(screen.getByTestId("parser-result-error").textContent).toMatch(/unknown/);
  });

  it("renders the empty-registry message when no parsers are registered", () => {
    const reg = getParserRegistry();
    const listSpy = vi.spyOn(reg, "list").mockReturnValue([]);
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    expect(screen.getByText("등록된 파서가 없습니다")).toBeTruthy();
    listSpy.mockRestore();
  });
});
