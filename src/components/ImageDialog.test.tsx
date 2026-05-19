import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Opener = (req: unknown) => void;
let registeredOpener: Opener = () => {};
vi.mock("@/lib/editor/commands/image", () => ({
  setImageDialogOpener: (fn: Opener) => {
    registeredOpener = fn;
  },
}));
vi.mock("@/lib/editor/commands/link", () => ({
  getWorkspaceLinkProvider: () => null,
}));

import { ImageDialog } from "./ImageDialog";

interface OpenReq {
  initialAlt: string;
  initialUrl: string;
  resolve: ReturnType<typeof vi.fn>;
  pickFile?: () => Promise<{ name: string } | null>;
}

function open(overrides?: Partial<OpenReq>): OpenReq {
  const req: OpenReq = {
    initialAlt: "",
    initialUrl: "",
    resolve: vi.fn(),
    ...overrides,
  };
  act(() => registeredOpener(req));
  return req;
}

afterEach(cleanup);

describe("ImageDialog", () => {
  it("renders nothing until opened", () => {
    const { container } = render(<ImageDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("opens with the initial alt and url", () => {
    render(<ImageDialog />);
    open({ initialAlt: "logo", initialUrl: "./a.png" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    const inputs = screen.getAllByRole("textbox");
    expect((inputs[0] as HTMLInputElement).value).toBe("logo");
    expect((inputs[1] as HTMLInputElement).value).toBe("./a.png");
  });

  it("submits the alt/url result", () => {
    render(<ImageDialog />);
    const req = open({ initialUrl: "./pic.png" });
    fireEvent.click(screen.getByText("Insert"));
    expect(req.resolve).toHaveBeenCalledWith({ alt: "", url: "./pic.png" });
  });

  it("does not submit an empty url", () => {
    render(<ImageDialog />);
    const req = open();
    fireEvent.click(screen.getByText("Insert"));
    expect(req.resolve).not.toHaveBeenCalled();
  });

  it("cancels with a null result", () => {
    render(<ImageDialog />);
    const req = open();
    fireEvent.click(screen.getByText("Cancel"));
    expect(req.resolve).toHaveBeenCalledWith(null);
  });

  it("closes on Escape", () => {
    render(<ImageDialog />);
    const req = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(req.resolve).toHaveBeenCalledWith(null);
  });
});
