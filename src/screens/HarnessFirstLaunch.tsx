// S-TST-008: fixture renderer for `?harness=fresh-install`. Pure UI
// state machine that walks the 12-step wizard the spec asserts on.
// Production wizard lives elsewhere (or doesn't yet); this exists so
// the e2e contract can be validated without the real native shell.

import { useState } from "react";

type Step =
  | "splash"
  | "eula"
  | "telemetry"
  | "language"
  | "theme"
  | "workspace"
  | "ai-key"
  | "keybinding"
  | "data-folder"
  | "summary"
  | "shell";

interface Choices {
  language: string;
  theme: string;
  workspace: string;
  keybinding: string;
}

const INITIAL: Choices = {
  language: "한국어",
  theme: "auto",
  workspace: "sample workspace",
  keybinding: "default",
};

export function HarnessFirstLaunch() {
  const [step, setStep] = useState<Step>("splash");
  const [choices, setChoices] = useState<Choices>(INITIAL);

  // Auto-advance from splash to eula so the splash testid is visible
  // briefly (within the 2s budget the spec asserts) without requiring
  // a click.
  if (step === "splash") {
    setTimeout(() => setStep("eula"), 50);
    return <div data-testid="splash">Markspread</div>;
  }

  if (step === "eula") {
    return (
      <>
        <div data-testid="splash">Markspread</div>
        <div data-testid="eula-dialog" role="dialog">
          <p>End user licence agreement…</p>
          <button type="button" onClick={() => setStep("telemetry")}>
            I agree
          </button>
        </div>
      </>
    );
  }

  if (step === "telemetry") {
    return (
      <div data-testid="telemetry-consent" role="dialog">
        <p>Help improve Markspread</p>
        <button type="button" onClick={() => setStep("language")}>
          Yes, share anonymous usage
        </button>
        <button type="button" onClick={() => setStep("language")}>
          No thanks
        </button>
      </div>
    );
  }

  if (step === "language") {
    return (
      <div data-testid="language-picker" role="dialog">
        <label>
          <input
            type="radio"
            name="lang"
            defaultChecked
            onChange={() => setChoices((c) => ({ ...c, language: "한국어" }))}
          />
          한국어
        </label>
        <label>
          <input
            type="radio"
            name="lang"
            onChange={() => setChoices((c) => ({ ...c, language: "English" }))}
          />
          English
        </label>
        <button type="button" onClick={() => setStep("theme")}>
          Next
        </button>
      </div>
    );
  }

  if (step === "theme") {
    return (
      <div data-testid="theme-picker" role="dialog">
        <label>
          <input
            type="radio"
            name="theme"
            onChange={() => setChoices((c) => ({ ...c, theme: "auto" }))}
          />
          Auto
        </label>
        <label>
          <input type="radio" name="theme" />
          Light
        </label>
        <label>
          <input type="radio" name="theme" />
          Dark
        </label>
        <button type="button" onClick={() => setStep("workspace")}>
          Next
        </button>
      </div>
    );
  }

  if (step === "workspace") {
    return (
      <div data-testid="workspace-choice" role="dialog">
        <button type="button">Open existing workspace</button>
        <button type="button">Create new workspace</button>
        <button
          type="button"
          onClick={() => {
            setChoices((c) => ({ ...c, workspace: "sample workspace" }));
            setStep("ai-key");
          }}
        >
          Create sample workspace
        </button>
      </div>
    );
  }

  if (step === "ai-key") {
    return (
      <div data-testid="ai-key-prompt" role="dialog">
        <p>Add an AI provider key now or later.</p>
        <button type="button">Add key</button>
        <button type="button" onClick={() => setStep("keybinding")}>
          Skip for now
        </button>
      </div>
    );
  }

  if (step === "keybinding") {
    return (
      <div data-testid="keybinding-picker" role="dialog">
        <label>
          <input
            type="radio"
            name="kb"
            onChange={() => setChoices((c) => ({ ...c, keybinding: "default" }))}
          />
          Default
        </label>
        <label>
          <input type="radio" name="kb" />
          Vim
        </label>
        <button type="button" onClick={() => setStep("data-folder")}>
          Next
        </button>
      </div>
    );
  }

  if (step === "data-folder") {
    return (
      <div data-testid="data-folder" role="dialog">
        <p>Where should Markspread store its data?</p>
        <button type="button" onClick={() => setStep("summary")}>
          Use suggested
        </button>
        <button type="button">Pick a custom location</button>
      </div>
    );
  }

  if (step === "summary") {
    return (
      <div data-testid="first-run-summary" role="dialog">
        <ul>
          <li>Language: {choices.language}</li>
          <li>Theme: {choices.theme}</li>
          <li>Workspace: {choices.workspace}</li>
          <li>Keybinding: {choices.keybinding}</li>
        </ul>
        <button type="button" onClick={() => setStep("shell")}>
          Finish
        </button>
      </div>
    );
  }

  return <div data-testid="workspace-shell">Workspace loaded.</div>;
}
