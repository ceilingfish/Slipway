import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "../core/agentLog";
import { type ParsedLine, parseStreamLine } from "./claudeStream";

// Fixtures are real `claude -p --verbose --output-format stream-json` output
// (Claude Code 2.1.206), with paths and signatures scrubbed.
const parseFixture = (name: string): ParsedLine[] =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8")
    .split("\n")
    .map(parseStreamLine);

const entriesOf = (lines: readonly ParsedLine[]): LogEntry[] =>
  lines.flatMap((line) => line.entries);

describe("parseStreamLine", () => {
  describe("a run that reads, writes, edits and runs a command", () => {
    const lines = parseFixture("tools-run.jsonl");

    it("reports the session from the init event", () => {
      expect(lines.map((line) => line.init).filter((init) => init !== undefined)).toEqual([
        { sessionId: "a854db5c-e9ed-4556-9fa4-b9878b75e000", permissionMode: "auto" },
      ]);
    });

    it("turns tool calls, their output and the agent's commentary into log entries", () => {
      expect(entriesOf(lines)).toEqual([
        { kind: "read", toolUseId: "toolu_018gLXTd9Q1o9ys9S52cYeWi", path: "/work/project/a.txt" },
        {
          kind: "output",
          toolUseId: "toolu_018gLXTd9Q1o9ys9S52cYeWi",
          text: "1\thello world\n2\t",
          isError: false,
        },
        {
          kind: "edit",
          toolUseId: "toolu_01352Ma7B5S4vNQasBgnfcV3",
          tool: "Write",
          path: "/work/project/b.txt",
        },
        expect.objectContaining({ kind: "output", toolUseId: "toolu_01352Ma7B5S4vNQasBgnfcV3" }),
        {
          kind: "edit",
          toolUseId: "toolu_016YMaEvGL41j5npVfQxbZCX",
          tool: "Edit",
          path: "/work/project/b.txt",
        },
        expect.objectContaining({ kind: "output", toolUseId: "toolu_016YMaEvGL41j5npVfQxbZCX" }),
        {
          kind: "command",
          toolUseId: "toolu_01FgUVqSTRaYA32mMjJCvKhv",
          command: "ls",
          description: "List files in current directory",
        },
        {
          kind: "output",
          toolUseId: "toolu_01FgUVqSTRaYA32mMjJCvKhv",
          text: "a.txt  12B\nb.txt  3B",
          isError: false,
        },
        {
          kind: "commentary",
          text: "a.txt contains \"hello world\". Created b.txt with 'one', edited it to 'two', and `ls` shows both files (a.txt 12B, b.txt 3B).",
        },
      ]);
    });

    it("reports the final result", () => {
      expect(lines.at(-2)?.result).toEqual({
        isError: false,
        text: "a.txt contains \"hello world\". Created b.txt with 'one', edited it to 'two', and `ls` shows both files (a.txt 12B, b.txt 3B).",
      });
    });
  });

  it("reports a resumed session under its original id", () => {
    const lines = parseFixture("resumed-run.jsonl");
    expect(lines[0]?.init?.sessionId).toBe("a854db5c-e9ed-4556-9fa4-b9878b75e000");
    expect(entriesOf(lines)).toEqual([{ kind: "commentary", text: "two" }]);
    expect(lines.at(-2)?.result).toEqual({ isError: false, text: "two" });
  });

  it("logs the errors of a failed run", () => {
    const [line] = parseFixture("failed-resume.jsonl");
    expect(line).toEqual({
      entries: [
        {
          kind: "error",
          text: "No conversation found with session ID: 00000000-0000-4000-8000-000000000000",
        },
      ],
      result: { isError: true, text: undefined },
    });
  });

  it("marks tool output that failed as an error", () => {
    const outputs = entriesOf(parseFixture("permission-denied-run.jsonl")).filter(
      (entry) => entry.kind === "output",
    );
    expect(outputs.map((entry) => entry.isError)).toEqual([false, true]);
  });

  it("reports the permission mode Claude actually ran in", () => {
    // Asking haiku for auto mode silently falls back to the default mode.
    const [line] = parseFixture("permission-denied-run.jsonl");
    expect(line?.init?.permissionMode).toBe("default");
  });

  it("ignores blank lines and events it doesn't log", () => {
    expect(parseStreamLine("  ")).toEqual({ entries: [] });
    expect(parseStreamLine('{"type":"rate_limit_event"}')).toEqual({ entries: [] });
    expect(parseStreamLine('{"type":"system","subtype":"thinking_tokens"}')).toEqual({
      entries: [],
    });
  });

  it("keeps lines that aren't JSON events verbatim", () => {
    expect(parseStreamLine("Warning: something\n")).toEqual({
      entries: [{ kind: "unparsed", text: "Warning: something" }],
    });
    expect(parseStreamLine("[1,2]")).toEqual({ entries: [{ kind: "unparsed", text: "[1,2]" }] });
  });

  it("logs other tool calls with their input", () => {
    const line = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "foo" } }],
        },
      }),
    );
    expect(line.entries).toEqual([
      { kind: "tool", toolUseId: "t1", name: "Grep", input: '{"pattern":"foo"}' },
    ]);
  });

  it("joins tool output given as content blocks", () => {
    const line = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: "a" }, { type: "image" }],
            },
          ],
        },
      }),
    );
    expect(line.entries).toEqual([
      { kind: "output", toolUseId: "t1", text: "a\n[image]", isError: false },
    ]);
  });
});
