/**
 * Parses the output of `claude -p --verbose --output-format stream-json`: one
 * JSON event per line. The shapes handled here were taken from real output of
 * Claude Code 2.1.206 (see fixtures/):
 *
 * - `{type:"system", subtype:"init", session_id, permissionMode, ...}` first
 * - `{type:"assistant", message:{content:[...]}}` with `text`, `thinking` and
 *   `tool_use` ({id, name, input}) blocks
 * - `{type:"user", message:{content:[...]}}` with `tool_result` blocks
 *   ({tool_use_id, content, is_error})
 * - `{type:"result", subtype, is_error, result?, errors?, session_id}` last
 *
 * Anything else (`rate_limit_event`, `system/thinking_tokens`, ...) is ignored.
 */
import type { LogEntry } from "../core/agentLog";

export interface StreamResult {
  readonly isError: boolean;
  readonly text: string | undefined;
}

export interface ParsedLine {
  readonly entries: readonly LogEntry[];
  readonly init?: { readonly sessionId: string; readonly permissionMode: string | undefined };
  readonly result?: StreamResult;
}

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (object: JsonObject, key: string): string | undefined => {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
};

const objectArray = (value: unknown): readonly JsonObject[] =>
  Array.isArray(value) ? value.filter(isObject) : [];

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const toolUseEntry = (block: JsonObject): LogEntry => {
  const toolUseId = stringField(block, "id") ?? "";
  const name = stringField(block, "name") ?? "unknown";
  const input = isObject(block["input"]) ? block["input"] : {};
  const path = stringField(input, "file_path") ?? stringField(input, "notebook_path");
  const command = stringField(input, "command");
  if (name === "Read" && path !== undefined) {
    return { kind: "read", toolUseId, path };
  }
  if (EDIT_TOOLS.has(name) && path !== undefined) {
    return { kind: "edit", toolUseId, tool: name, path };
  }
  if (name === "Bash" && command !== undefined) {
    return { kind: "command", toolUseId, command, description: stringField(input, "description") };
  }
  return { kind: "tool", toolUseId, name, input: JSON.stringify(input) };
};

const assistantEntries = (content: readonly JsonObject[]): LogEntry[] =>
  content.flatMap((block): LogEntry[] => {
    const text = stringField(block, "text");
    switch (block["type"]) {
      case "text":
        return text === undefined || text === "" ? [] : [{ kind: "commentary", text }];
      case "tool_use":
        return [toolUseEntry(block)];
      default:
        // Thinking blocks are the model's private reasoning, not commentary.
        return [];
    }
  });

/** A tool result's content is either a string or a list of content blocks. */
const toolResultText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  return objectArray(content)
    .map((block) => stringField(block, "text") ?? `[${stringField(block, "type") ?? "content"}]`)
    .join("\n");
};

const userEntries = (content: readonly JsonObject[]): LogEntry[] =>
  content
    .filter((block) => block["type"] === "tool_result")
    .map((block) => ({
      kind: "output",
      toolUseId: stringField(block, "tool_use_id") ?? "",
      text: toolResultText(block["content"]),
      isError: block["is_error"] === true,
    }));

const messageContent = (event: JsonObject): readonly JsonObject[] => {
  const message = event["message"];
  if (!isObject(message)) {
    return [];
  }
  const content = message["content"];
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return objectArray(content);
};

const parseResult = (event: JsonObject): ParsedLine => {
  const isError = event["is_error"] === true;
  const errors = Array.isArray(event["errors"])
    ? event["errors"].filter((error): error is string => typeof error === "string")
    : [];
  return {
    entries: errors.map((text) => ({ kind: "error", text })),
    result: { isError, text: stringField(event, "result") },
  };
};

const parseInit = (event: JsonObject): ParsedLine => {
  const sessionId = stringField(event, "session_id");
  if (sessionId === undefined) {
    return { entries: [] };
  }
  return {
    entries: [],
    init: { sessionId, permissionMode: stringField(event, "permissionMode") },
  };
};

const parseEvent = (event: JsonObject): ParsedLine => {
  switch (event["type"]) {
    case "system":
      return event["subtype"] === "init" ? parseInit(event) : { entries: [] };
    case "assistant":
      return { entries: assistantEntries(messageContent(event)) };
    case "user":
      return { entries: userEntries(messageContent(event)) };
    case "result":
      return parseResult(event);
    default:
      return { entries: [] };
  }
};

/** Parses one line of stream-json output. */
export const parseStreamLine = (line: string): ParsedLine => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return { entries: [] };
  }
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return { entries: [{ kind: "unparsed", text: trimmed }] };
  }
  return isObject(event) ? parseEvent(event) : { entries: [{ kind: "unparsed", text: trimmed }] };
};
