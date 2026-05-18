// S-MD-034: dialog UI for the "Insert Table" command.
// Rows/cols numeric inputs + per-column alignment dropdowns. Esc
// cancels, Mod+Enter submits. The opener is registered once on
// mount via setInsertTableOpener.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ColumnAlign,
  type InsertTableRequest,
  type InsertTableResult,
  setInsertTableOpener,
} from "@/lib/editor/commands/insertTable";

const ALIGNS: ColumnAlign[] = ["default", "left", "center", "right"];

export function InsertTableDialog() {
  const { t } = useTranslation();
  const [req, setReq] = useState<InsertTableRequest | null>(null);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [align, setAlign] = useState<ColumnAlign[]>(() => Array(3).fill("default"));

  useEffect(() => {
    setInsertTableOpener((r) => {
      setRows(3);
      setCols(3);
      setAlign(Array(3).fill("default"));
      setReq(r);
    });
    return () => setInsertTableOpener(() => {});
  }, []);

  if (!req) return null;

  const close = (result: InsertTableResult | null) => {
    req.resolve(result);
    setReq(null);
  };
  const submit = () => {
    close({ rows, cols, align });
  };
  const setColCount = (n: number) => {
    const c = Math.max(1, Math.min(20, n));
    setCols(c);
    setAlign((prev) => {
      if (prev.length === c) return prev;
      const copy = prev.slice(0, c);
      while (copy.length < c) copy.push("default");
      return copy;
    });
  };

  return (
    <div
      className="ms-modal-backdrop"
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-label={t("md.table.title", "Insert table")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close(null);
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="ms-modal">
        <h2>{t("md.table.title", "Insert table")}</h2>
        <label>
          <span>{t("md.table.rows", "Rows (body)")}</span>
          <input
            type="number"
            min={1}
            max={50}
            value={rows}
            onChange={(e) => setRows(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          <span>{t("md.table.cols", "Columns")}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={cols}
            onChange={(e) => setColCount(Number(e.target.value) || 1)}
          />
        </label>
        <fieldset className="ms-table-aligns">
          <legend>{t("md.table.align", "Column alignment")}</legend>
          {align.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: align entries are positional per column; index is the stable identity
            <label key={i}>
              <span>#{i + 1}</span>
              <select
                value={a}
                onChange={(e) =>
                  setAlign((prev) => {
                    const copy = prev.slice();
                    copy[i] = e.target.value as ColumnAlign;
                    return copy;
                  })
                }
              >
                {ALIGNS.map((x) => (
                  <option key={x} value={x}>
                    {t(`md.table.align.${x}`, x)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        <div className="ms-modal-actions">
          <button type="button" onClick={() => close(null)}>
            {t("common.cancel", "Cancel")}
          </button>
          <button type="button" onClick={submit}>
            {t("common.insert", "Insert")}
          </button>
        </div>
      </div>
    </div>
  );
}
