// S-SE-006..014: secret-scanner unit tests.
// ms:allow-secret — this file contains fake AWS/GitHub token fixtures
// used to exercise the scanner; not real credentials.

import { describe, expect, it } from "vitest";
import {
  BUILTIN_CONTENT_PATTERNS,
  DEFAULT_SCANNER_CONFIG,
  type SecretPattern,
  isSecretFilename,
  maskLogLine,
  scanContent,
  shannonEntropyBits,
} from "./secret-scanner";

describe("isSecretFilename", () => {
  it("matches .env and its variants", () => {
    expect(isSecretFilename(".env")).toBe(true);
    expect(isSecretFilename("a/.env.local")).toBe(true);
    expect(isSecretFilename("path/to/.env.production")).toBe(true);
  });

  it("matches private-key filenames", () => {
    expect(isSecretFilename("home/u/.ssh/id_rsa")).toBe(true);
    expect(isSecretFilename("id_ed25519")).toBe(true);
    expect(isSecretFilename("k.pem")).toBe(true);
    expect(isSecretFilename("ssl.key")).toBe(true);
    expect(isSecretFilename("cert.pfx")).toBe(true);
    expect(isSecretFilename("cert.p12")).toBe(true);
  });

  it("matches credentials/secrets/kubeconfig", () => {
    expect(isSecretFilename("credentials.json")).toBe(true);
    expect(isSecretFilename("secrets.yaml")).toBe(true);
    expect(isSecretFilename("kubeconfig")).toBe(true);
  });

  it("returns false for ordinary filenames", () => {
    expect(isSecretFilename("README.md")).toBe(false);
    expect(isSecretFilename("src/foo.ts")).toBe(false);
  });
});

describe("shannonEntropyBits", () => {
  it("returns 0 for the empty string", () => {
    expect(shannonEntropyBits("")).toBe(0);
  });

  it("returns 0 for a single repeated character", () => {
    expect(shannonEntropyBits("aaaaaa")).toBe(0);
  });

  it("returns 1 for a perfectly balanced two-symbol string", () => {
    expect(shannonEntropyBits("ababab")).toBeCloseTo(1, 5);
  });

  it("returns higher entropy for varied characters than for repeated ones", () => {
    expect(shannonEntropyBits("xY9$aB!")).toBeGreaterThan(shannonEntropyBits("aaaaaaa"));
  });
});

describe("scanContent", () => {
  it("detects an AWS AKIA key", () => {
    const findings = scanContent("AKIAIOSFODNN7EXAMPLE here");
    expect(findings.some((f) => f.patternId === "aws-akia")).toBe(true);
  });

  it("masks the secret in the preview field", () => {
    const findings = scanContent("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa here");
    const f = findings.find((x) => x.patternId === "github-token");
    expect(f).toBeDefined();
    expect(f?.preview).not.toContain("aaaaaaaaaaaaaaaaaaaa");
    expect(f?.preview).toMatch(/^ghp….+aaa$/);
  });

  it("masks short captures by replacing every character", () => {
    const custom: SecretPattern[] = [{ id: "short", re: /\b(abc12)\b/g, severity: "low" }];
    const findings = scanContent("token abc12 end", custom);
    expect(findings[0]?.preview).toBe("•••••");
  });

  it("suppresses low-entropy matches when minEntropyBits is set", () => {
    // 40 chars of one symbol — entropy 0, below threshold 4.5
    const findings = scanContent("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(findings.some((f) => f.patternId === "aws-secret")).toBe(false);
  });

  it("returns an empty array when nothing matches", () => {
    expect(scanContent("plain text with nothing of interest")).toEqual([]);
  });

  it("walks multiple matches for the same pattern", () => {
    const findings = scanContent("AKIAIOSFODNN7EXAMPLE and AKIAJB0GUSEXAMPLEKEY in one line");
    expect(findings.filter((f) => f.patternId === "aws-akia").length).toBe(2);
  });

  it("captures offsets that match the substring index", () => {
    const src = "prefix ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa suffix";
    const findings = scanContent(src);
    const f = findings.find((x) => x.patternId === "github-token");
    expect(f).toBeDefined();
    if (f) expect(src.slice(f.offset, f.offset + f.length).startsWith("ghp_")).toBe(true);
  });

  it("uses the full match when the pattern lacks a capture group", () => {
    const noCapture: SecretPattern[] = [{ id: "raw", re: /AKIA[0-9A-Z]{16}/g, severity: "low" }];
    const findings = scanContent("AKIAIOSFODNN7EXAMPLE here", noCapture);
    expect(findings.length).toBe(1);
    expect(findings[0]?.length).toBe(20);
  });
});

describe("maskLogLine", () => {
  it("replaces a detected secret with a redacted placeholder", () => {
    const out = maskLogLine("token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa other");
    expect(out).toContain("«REDACTED:github-token»");
    expect(out).not.toContain("ghp_aaaaaaaaa");
  });

  it("leaves a clean line unchanged", () => {
    const line = "no secrets here at all";
    expect(maskLogLine(line)).toBe(line);
  });

  it("redacts a custom pattern with its own id", () => {
    const custom: SecretPattern[] = [{ id: "raw", re: /(AKIA[0-9A-Z]{16})/g, severity: "low" }];
    const out = maskLogLine("AKIAIOSFODNN7EXAMPLE end", custom);
    expect(out).toContain("«REDACTED:raw»");
  });
});

describe("BUILTIN_CONTENT_PATTERNS / config defaults", () => {
  it("ships pattern ids for all expected provider tokens", () => {
    const ids = BUILTIN_CONTENT_PATTERNS.map((p) => p.id);
    for (const id of [
      "aws-akia",
      "aws-secret",
      "github-token",
      "github-fg",
      "openai-key",
      "anthropic-key",
      "google-api",
      "slack-token",
      "stripe-live",
      "jwt",
      "bearer-token",
      "private-key",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("exposes empty defaults for user config", () => {
    expect(DEFAULT_SCANNER_CONFIG.allowedFiles).toEqual([]);
    expect(DEFAULT_SCANNER_CONFIG.customPatterns).toEqual([]);
  });
});
