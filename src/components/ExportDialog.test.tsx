import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const exportDocument = vi.fn();
vi.mock("../lib/export/export", () => ({
  BUILTIN_TEMPLATES: [
    { id: "default", label: "Default", css: "" },
    { id: "academic", label: "Academic", css: "" },
  ],
  exportDocument: (req: unknown) => exportDocument(req),
}));

import { ExportDialog } from "./ExportDialog";

const baseProps = {
  documentPath: "/ws/doc.md",
  documentTitle: "Doc",
  bodyHtml: "<p>hi</p>",
};

afterEach(cleanup);

describe("ExportDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ExportDialog open={false} onClose={() => {}} {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog with format and template pickers", () => {
    render(<ExportDialog open={true} onClose={() => {}} {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("combobox").length).toBe(2);
  });

  it("changes format and template", () => {
    render(<ExportDialog open={true} onClose={() => {}} {...baseProps} />);
    const [format, template] = screen.getAllByRole("combobox");
    fireEvent.change(format as HTMLSelectElement, { target: { value: "html" } });
    fireEvent.change(template as HTMLSelectElement, { target: { value: "academic" } });
    expect((format as HTMLSelectElement).value).toBe("html");
    expect((template as HTMLSelectElement).value).toBe("academic");
  });

  it("runs the export and shows a success status", async () => {
    exportDocument.mockResolvedValue({ ok: true, outputPath: "/out/doc.pdf" });
    render(<ExportDialog open={true} onClose={() => {}} {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(exportDocument).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Exported to/)).toBeTruthy());
  });

  it("calls onClose from the Close button", () => {
    const onClose = vi.fn();
    render(<ExportDialog open={true} onClose={onClose} {...baseProps} />);
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
