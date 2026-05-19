// Unit tests for the locale store. detectSystemLocale is mocked so the
// follow-system behaviour is deterministic regardless of the host env.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/i18n", async (importActual) => {
  const actual = await importActual<typeof import("../lib/i18n")>();
  return { ...actual, detectSystemLocale: () => "ko" as const };
});

import { useLocale } from "../store/locale";

beforeEach(() => {
  useLocale.setState({ locale: "ko", followSystem: true });
});

describe("locale store", () => {
  it("starts following the detected system locale", () => {
    expect(useLocale.getState().locale).toBe("ko");
    expect(useLocale.getState().followSystem).toBe(true);
  });

  it("setLocale without options keeps follow-system on", () => {
    useLocale.getState().setLocale("ja");
    expect(useLocale.getState().locale).toBe("ja");
    expect(useLocale.getState().followSystem).toBe(true);
  });

  it("a manual setLocale turns follow-system off", () => {
    useLocale.getState().setLocale("es", { manual: true });
    expect(useLocale.getState().locale).toBe("es");
    expect(useLocale.getState().followSystem).toBe(false);
  });

  it("a non-manual setLocale re-enables follow-system", () => {
    useLocale.setState({ followSystem: false });
    useLocale.getState().setLocale("zh", { manual: false });
    expect(useLocale.getState().followSystem).toBe(true);
  });

  it("resetToSystem restores the detected locale and follow-system", () => {
    useLocale.getState().setLocale("en", { manual: true });
    useLocale.getState().resetToSystem();
    expect(useLocale.getState().locale).toBe("ko");
    expect(useLocale.getState().followSystem).toBe(true);
  });
});
