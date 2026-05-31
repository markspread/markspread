// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetParserRegistryForTests, getParserRegistry } from "../lib/parsers/registry";
import { CreateParserDialog } from "./CreateParserDialog";

beforeEach(() => {
  __resetParserRegistryForTests();
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

  it("end-to-end: user types parser source → click Create → registered + visible via getParserRegistry().match", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "wireweave-ui-test");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".wireweave");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => ({ ast: { kind: "html", html: '<svg data-ww="1">' + input.content + '</svg>' } })`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // Success UI
    expect(screen.getByTestId("parser-result-success")).toBeTruthy();
    // Registry match returns our parser
    const m = getParserRegistry().match({ path: "/x/y.wireweave" });
    expect(m?.parser.manifest.id).toBe("wireweave-ui-test");
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

  it("shows violations list when source has risky calls (fetch)", () => {
    render(<CreateParserDialog open={true} onClose={() => {}} />);
    setValue(screen.getByTestId("parser-id") as HTMLInputElement, "fetchy");
    setValue(screen.getByTestId("parser-extensions") as HTMLInputElement, ".fy");
    setValue(
      screen.getByTestId("parser-source") as HTMLTextAreaElement,
      `(input) => { fetch("/x"); return { ast: { kind: "html", html: input.content } }; }`,
    );
    fireEvent.click(screen.getByTestId("parser-create"));
    // Registration succeeds but violations panel shows
    expect(screen.getByTestId("parser-result-success")).toBeTruthy();
    expect(screen.getByTestId("parser-violations").textContent).toMatch(/network_fetch/);
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
});
