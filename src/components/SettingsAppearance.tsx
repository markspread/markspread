import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_WEIGHT_VALUES,
  type FontWeight,
  LETTER_SPACING_DEFAULT,
  LETTER_SPACING_MAX,
  LETTER_SPACING_MIN,
  LINE_HEIGHTS,
  type LineHeight,
  useSettings,
} from "../store/settings";

/**
 * S-TY-003: Appearance settings panel. Exposes a UI font + editor font picker
 * sourced from the OS via `os_list_fonts`. Selecting a family writes to the
 * settings store; `useFontFamilyEffect` (mounted at app root) is what actually
 * applies the chosen face to CSS variables.
 */
export function SettingsAppearance() {
  const { t } = useTranslation();
  const uiFontFamily = useSettings((s) => s.uiFontFamily);
  const editorFontFamily = useSettings((s) => s.editorFontFamily);
  const setUiFontFamily = useSettings((s) => s.setUiFontFamily);
  const setEditorFontFamily = useSettings((s) => s.setEditorFontFamily);
  const fontSizePx = useSettings((s) => s.fontSizePx);
  const setFontSizePx = useSettings((s) => s.setFontSizePx);
  const lineHeight = useSettings((s) => s.lineHeight);
  const setLineHeight = useSettings((s) => s.setLineHeight);
  const letterSpacingPx = useSettings((s) => s.letterSpacingPx);
  const setLetterSpacingPx = useSettings((s) => s.setLetterSpacingPx);
  const fontWeight = useSettings((s) => s.fontWeight);
  const setFontWeight = useSettings((s) => s.setFontWeight);

  const [families, setFamilies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await invoke<string[]>("os_list_fonts");
        if (!cancelled) setFamilies(list);
      } catch (err) {
        if (!cancelled) setError(String((err as { message?: string })?.message ?? err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-label={t("settings.appearance.title", "Appearance")}
      className="flex flex-col gap-4 p-4 text-sm"
    >
      <h2 className="font-semibold text-base">
        {t("settings.appearance.title", "Appearance")}
      </h2>
      <FontPicker
        labelKey="settings.appearance.font.ui"
        value={uiFontFamily}
        onChange={setUiFontFamily}
        families={families}
        loading={loading}
        error={error}
        defaultLabel="Inter"
      />
      <FontPicker
        labelKey="settings.appearance.font.editor"
        value={editorFontFamily}
        onChange={setEditorFontFamily}
        families={families}
        loading={loading}
        error={error}
        defaultLabel="JetBrains Mono"
      />
      <label className="flex flex-col gap-1">
        <span className="text-[var(--color-muted)]">
          {t("settings.appearance.font.size", "Font size")} · {fontSizePx}px
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSizePx}
            onChange={(e) => setFontSizePx(Number(e.target.value))}
            aria-label={t("settings.appearance.font.size", "Font size")}
            className="flex-1"
          />
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)]/40"
            onClick={() => setFontSizePx(FONT_SIZE_DEFAULT)}
          >
            {t("settings.appearance.reset", "Reset")}
          </button>
        </div>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[var(--color-muted)]">
          {t("settings.appearance.line_height", "Line height")}
        </legend>
        <div className="flex gap-2">
          {LINE_HEIGHTS.map((lh) => (
            <label
              key={lh}
              className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                lineHeight === lh
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-border)]/40"
              }`}
            >
              <input
                type="radio"
                name="line-height"
                value={lh}
                checked={lineHeight === lh}
                onChange={() => setLineHeight(lh as LineHeight)}
                className="sr-only"
              />
              {lh.toFixed(1)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-[var(--color-muted)]">
          {t("settings.appearance.letter_spacing", "Letter spacing")} · {letterSpacingPx.toFixed(1)}px
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={LETTER_SPACING_MIN}
            max={LETTER_SPACING_MAX}
            step={0.1}
            value={letterSpacingPx}
            onChange={(e) => setLetterSpacingPx(Number(e.target.value))}
            aria-label={t("settings.appearance.letter_spacing", "Letter spacing")}
            className="flex-1"
          />
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)]/40"
            onClick={() => setLetterSpacingPx(LETTER_SPACING_DEFAULT)}
          >
            {t("settings.appearance.reset", "Reset")}
          </button>
        </div>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[var(--color-muted)]">
          {t("settings.appearance.font.weight", "Font weight")}
        </legend>
        <div className="flex gap-2">
          {(Object.keys(FONT_WEIGHT_VALUES) as FontWeight[]).map((w) => (
            <label
              key={w}
              className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                fontWeight === w
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-border)]/40"
              }`}
              style={{ fontWeight: FONT_WEIGHT_VALUES[w] }}
            >
              <input
                type="radio"
                name="font-weight"
                value={w}
                checked={fontWeight === w}
                onChange={() => setFontWeight(w)}
                className="sr-only"
              />
              {w}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

interface FontPickerProps {
  labelKey: string;
  value: string;
  onChange: (v: string) => void;
  families: string[];
  loading: boolean;
  error: string | null;
  defaultLabel: string;
}

function FontPicker({
  labelKey,
  value,
  onChange,
  families,
  loading,
  error,
  defaultLabel,
}: FontPickerProps) {
  const { t } = useTranslation();
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[var(--color-muted)]">{t(labelKey, labelKey)}</span>
      <select
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || !!error}
      >
        <option value="">{t("settings.appearance.font.default", "Default")} ({defaultLabel})</option>
        {families.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-red-500 text-xs">
          {error}
        </span>
      )}
    </label>
  );
}
