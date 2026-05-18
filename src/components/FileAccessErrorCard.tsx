// S-FAP-008: file-access denial surface.
//
// Replaces the bare red placeholder that read failures used to render. The
// card shows the category badge + rule_id + an actionable copy from the
// errors.access.rule.* catalog (FAP-004) and exposes the rule's recommended
// actions (FAP-005 §5.2). Handlers are supplied by the host so the same card
// works inside an editor pane, a toast, or the file tree.

import { useTranslation } from "react-i18next";
import {
  RULE_ACTIONS,
  RULE_TO_CATEGORY,
  ruleI18nPrefix,
  specAnchorFor,
} from "../lib/access-policy/mapping";
import type { AccessCategory, AccessDecision, ActionId } from "../lib/access-policy/types";

const CATEGORY_TONE: Record<AccessCategory, "danger" | "warning" | "info" | "muted"> = {
  SEC: "danger",
  BND: "info",
  PRM: "warning",
  POL: "info",
  PRF: "warning",
  FMT: "muted",
  IO: "muted",
};

const TONE_STYLE: Record<"danger" | "warning" | "info" | "muted", React.CSSProperties> = {
  danger: {
    background: "var(--color-access-danger-bg)",
    color: "var(--color-access-danger-fg)",
    borderColor: "var(--color-access-danger-border)",
  },
  warning: {
    background: "var(--color-access-warning-bg)",
    color: "var(--color-access-warning-fg)",
    borderColor: "var(--color-access-warning-border)",
  },
  info: {
    background: "var(--color-access-info-bg)",
    color: "var(--color-access-info-fg)",
    borderColor: "var(--color-access-info-border)",
  },
  muted: {
    background: "var(--color-access-muted-bg)",
    color: "var(--color-access-muted-fg)",
    borderColor: "var(--color-access-muted-border)",
  },
};

export interface FileAccessErrorCardProps {
  decision: AccessDecision;
  /** Handlers for whichever ActionIds this surface can fulfil. Buttons whose
   *  ActionId has no handler are not rendered, so the card degrades cleanly
   *  while features like the allow-list editor (FAP-006) are still landing. */
  handlers?: Partial<Record<ActionId, () => void>>;
  /** Override the "왜?" deep link. Defaults to the spec anchor for ruleId. */
  whyHref?: string;
  /** Optional extra class on the outer section (e.g., max-width wrapper). */
  className?: string;
}

export function FileAccessErrorCard({
  decision,
  handlers,
  whyHref,
  className,
}: FileAccessErrorCardProps) {
  const { t } = useTranslation();
  const { ruleId, vars } = decision;
  const category = decision.category ?? RULE_TO_CATEGORY[ruleId];
  const tone = CATEGORY_TONE[category];
  const prefix = ruleI18nPrefix(ruleId);

  const interpolation = vars ?? {};
  const title = t(`${prefix}.title`, interpolation);
  const body = t(`${prefix}.body`, interpolation);
  const learnLabel = t(`${prefix}.learn_more`, "");
  const why = whyHref ?? specAnchorFor(ruleId);

  const actions = RULE_ACTIONS[ruleId];
  const primary =
    actions.primary && handlers?.[actions.primary]
      ? { id: actions.primary, onClick: handlers[actions.primary] }
      : null;
  const secondary =
    actions.secondary && handlers?.[actions.secondary]
      ? { id: actions.secondary, onClick: handlers[actions.secondary] }
      : null;

  const categoryLabel = t(`errors.access.category.${category.toLowerCase()}`);

  return (
    <section
      role="alert"
      aria-label={categoryLabel}
      data-rule-id={ruleId}
      data-access-category={category}
      data-access-tone={tone}
      style={{ ...TONE_STYLE[tone], borderWidth: 1, borderStyle: "solid" }}
      className={`flex w-full flex-col gap-3 rounded-md p-4 text-sm ${className ?? ""}`}
    >
      <header className="flex items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
          style={{ background: "color-mix(in oklab, currentColor 18%, transparent)" }}
        >
          {categoryLabel}
        </span>
        <code className="text-xs opacity-70">{ruleId}</code>
      </header>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="opacity-90">{body}</p>
      </div>
      <footer className="flex flex-wrap items-center gap-2 pt-1">
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            className="rounded-md border border-current bg-[color-mix(in_oklab,_currentColor_10%,_transparent)] px-3 py-1 text-xs font-medium hover:bg-[color-mix(in_oklab,_currentColor_18%,_transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {t(`errors.access.action.${primary.id}`)}
          </button>
        )}
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="rounded-md border border-current/40 px-3 py-1 text-xs hover:bg-[color-mix(in_oklab,_currentColor_10%,_transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {t(`errors.access.action.${secondary.id}`)}
          </button>
        )}
        <a
          href={why}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs underline opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {learnLabel || t("errors.access.action.learn_more")}
        </a>
      </footer>
    </section>
  );
}
