import { describe, expect, it } from "vitest";
import {
  buildToolActionFingerprint,
  buildToolMutationState,
  isLikelyMutatingToolName,
  isMutatingToolCall,
  isSameToolMutationAction,
} from "./tool-mutation.js";

describe("tool mutation helpers", () => {
  it("treats session_status as mutating only when model override is provided", () => {
    expect(isMutatingToolCall("session_status", { sessionKey: "agent:main:main" })).toBe(false);
    expect(
      isMutatingToolCall("session_status", {
        sessionKey: "agent:main:main",
        model: "openai/gpt-4o",
      }),
    ).toBe(true);
  });

  it("builds stable fingerprints for mutating calls and omits read-only calls", () => {
    const writeFingerprint = buildToolActionFingerprint(
      "write",
      { path: "/tmp/demo.txt", id: 42 },
      "write /tmp/demo.txt",
    );
    expect(writeFingerprint).toContain("tool=write");
    expect(writeFingerprint).toContain("path=/tmp/demo.txt");
    expect(writeFingerprint).toContain("id=42");
    expect(writeFingerprint).not.toContain("meta=write /tmp/demo.txt");

    const metaOnlyFingerprint = buildToolActionFingerprint("exec", { command: "ls -la" }, "ls -la");
    expect(metaOnlyFingerprint).toContain("tool=exec");
    expect(metaOnlyFingerprint).toContain("meta=ls -la");

    const readFingerprint = buildToolActionFingerprint("read", { path: "/tmp/demo.txt" });
    expect(readFingerprint).toBeUndefined();
  });

  it("canonicalizes file-path arg aliases so retries on the same target dedup", () => {
    // Claude-Code-convention `file_path`, pi-coding-agent `path`, and the
    // camelCase / lowercase variants must all produce the same fingerprint —
    // otherwise a retry would not clear a stale failure on the same file.
    const fromSnake = buildToolActionFingerprint(
      "edit",
      { file_path: "/tmp/a.md", new_string: "x" },
      "in /tmp/a.md (1 chars)",
    );
    const fromCanonical = buildToolActionFingerprint(
      "edit",
      { path: "/tmp/a.md", newText: "x" },
      "in /tmp/a.md (1 chars)",
    );
    const fromCamel = buildToolActionFingerprint(
      "edit",
      { filePath: "/tmp/a.md", newText: "x" },
      "in /tmp/a.md (1 chars)",
    );
    expect(fromSnake).toBe(fromCanonical);
    expect(fromCamel).toBe(fromCanonical);
    expect(fromCanonical).toContain("path=/tmp/a.md");
    // Volatile `(N chars)` meta must not leak into the fingerprint when a
    // stable path arg is available.
    expect(fromCanonical).not.toContain("meta=");
  });

  it("exposes mutation state for downstream payload rendering", () => {
    expect(
      buildToolMutationState("message", { action: "send", to: "telegram:1" }).mutatingAction,
    ).toBe(true);
    expect(buildToolMutationState("browser", { action: "list" }).mutatingAction).toBe(false);
  });

  it("matches tool actions by fingerprint and fails closed on asymmetric data", () => {
    expect(
      isSameToolMutationAction(
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
      ),
    ).toBe(true);
    expect(
      isSameToolMutationAction(
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/b" },
      ),
    ).toBe(false);
    expect(
      isSameToolMutationAction(
        { toolName: "write", actionFingerprint: "tool=write|path=/tmp/a" },
        { toolName: "write" },
      ),
    ).toBe(false);
  });

  it("keeps legacy name-only mutating heuristics for payload fallback", () => {
    expect(isLikelyMutatingToolName("sessions_send")).toBe(true);
    expect(isLikelyMutatingToolName("browser_actions")).toBe(true);
    expect(isLikelyMutatingToolName("message_slack")).toBe(true);
    expect(isLikelyMutatingToolName("browser")).toBe(false);
  });
});
