const MUTATING_TOOL_NAMES = new Set([
  "write",
  "edit",
  "apply_patch",
  "exec",
  "bash",
  "process",
  "message",
  "sessions_send",
  "cron",
  "gateway",
  "canvas",
  "nodes",
  "session_status",
]);

const READ_ONLY_ACTIONS = new Set([
  "get",
  "list",
  "read",
  "status",
  "show",
  "fetch",
  "search",
  "query",
  "view",
  "poll",
  "log",
  "inspect",
  "check",
  "probe",
]);

// Fingerprint argument aliases. Each group maps multiple arg-key spellings
// (camelCase / snake_case / lowercase) emitted by different model conventions
// onto a single canonical segment in the fingerprint string. This keeps
// retry-dedup stable when a model alternates spellings (e.g. Claude Code
// emits `file_path`, pi-coding-agent emits `path`).
const FINGERPRINT_ARG_ALIAS_GROUPS: ReadonlyArray<{
  canonical: string;
  aliases: readonly string[];
}> = [
  { canonical: "path", aliases: ["path", "file_path", "filePath", "filepath", "file"] },
  { canonical: "oldpath", aliases: ["oldPath", "old_path"] },
  { canonical: "newpath", aliases: ["newPath", "new_path"] },
  { canonical: "to", aliases: ["to", "target"] },
  { canonical: "messageid", aliases: ["messageId", "message_id"] },
  { canonical: "sessionkey", aliases: ["sessionKey", "session_key"] },
  { canonical: "jobid", aliases: ["jobId", "job_id"] },
  { canonical: "id", aliases: ["id"] },
  { canonical: "model", aliases: ["model"] },
];

const PROCESS_MUTATING_ACTIONS = new Set(["write", "send_keys", "submit", "paste", "kill"]);

const MESSAGE_MUTATING_ACTIONS = new Set([
  "send",
  "reply",
  "thread_reply",
  "threadreply",
  "edit",
  "delete",
  "react",
  "pin",
  "unpin",
]);

export type ToolMutationState = {
  mutatingAction: boolean;
  actionFingerprint?: string;
};

export type ToolActionRef = {
  toolName: string;
  meta?: string;
  actionFingerprint?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeActionName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized || undefined;
}

function normalizeFingerprintValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized.toLowerCase() : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return undefined;
}

export function isLikelyMutatingToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    MUTATING_TOOL_NAMES.has(normalized) ||
    normalized.endsWith("_actions") ||
    normalized.startsWith("message_") ||
    normalized.includes("send")
  );
}

export function isMutatingToolCall(toolName: string, args: unknown): boolean {
  const normalized = toolName.trim().toLowerCase();
  const record = asRecord(args);
  const action = normalizeActionName(record?.action);

  switch (normalized) {
    case "write":
    case "edit":
    case "apply_patch":
    case "exec":
    case "bash":
    case "sessions_send":
      return true;
    case "process":
      return action != null && PROCESS_MUTATING_ACTIONS.has(action);
    case "message":
      return (
        (action != null && MESSAGE_MUTATING_ACTIONS.has(action)) ||
        typeof record?.content === "string" ||
        typeof record?.message === "string"
      );
    case "session_status":
      return typeof record?.model === "string" && record.model.trim().length > 0;
    default: {
      if (normalized === "cron" || normalized === "gateway" || normalized === "canvas") {
        return action == null || !READ_ONLY_ACTIONS.has(action);
      }
      if (normalized === "nodes") {
        return action == null || action !== "list";
      }
      if (normalized.endsWith("_actions")) {
        return action == null || !READ_ONLY_ACTIONS.has(action);
      }
      if (normalized.startsWith("message_") || normalized.includes("send")) {
        return true;
      }
      return false;
    }
  }
}

export function buildToolActionFingerprint(
  toolName: string,
  args: unknown,
  meta?: string,
): string | undefined {
  if (!isMutatingToolCall(toolName, args)) {
    return undefined;
  }
  const normalizedTool = toolName.trim().toLowerCase();
  const record = asRecord(args);
  const action = normalizeActionName(record?.action);
  const parts = [`tool=${normalizedTool}`];
  if (action) {
    parts.push(`action=${action}`);
  }
  // Aliases (camelCase + snake_case + lowercase) collapse onto one canonical
  // segment so Claude-Code-convention args (`file_path`, `old_string`, …) and
  // pi-coding-agent args (`path`, `oldText`, …) produce the same fingerprint
  // for the same call, and dedup of retries on the same target is stable.
  let hasStableTarget = false;
  for (const { canonical, aliases } of FINGERPRINT_ARG_ALIAS_GROUPS) {
    for (const alias of aliases) {
      const value = normalizeFingerprintValue(record?.[alias]);
      if (value) {
        parts.push(`${canonical}=${value}`);
        hasStableTarget = true;
        break;
      }
    }
  }
  const normalizedMeta = meta?.trim().replace(/\s+/g, " ").toLowerCase();
  // Meta text often carries volatile details (for example "N chars").
  // Prefer stable arg-derived keys for matching; only fall back to meta
  // when no stable target key is available.
  if (normalizedMeta && !hasStableTarget) {
    parts.push(`meta=${normalizedMeta}`);
  }
  return parts.join("|");
}

export function buildToolMutationState(
  toolName: string,
  args: unknown,
  meta?: string,
): ToolMutationState {
  const actionFingerprint = buildToolActionFingerprint(toolName, args, meta);
  return {
    mutatingAction: actionFingerprint != null,
    actionFingerprint,
  };
}

export function isSameToolMutationAction(existing: ToolActionRef, next: ToolActionRef): boolean {
  if (existing.actionFingerprint != null || next.actionFingerprint != null) {
    // For mutating flows, fail closed: only clear when both fingerprints exist and match.
    return (
      existing.actionFingerprint != null &&
      next.actionFingerprint != null &&
      existing.actionFingerprint === next.actionFingerprint
    );
  }
  return existing.toolName === next.toolName && (existing.meta ?? "") === (next.meta ?? "");
}
