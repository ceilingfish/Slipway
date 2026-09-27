/**
 * One entry in an agent's log, as the agent reported it. The agent log editor
 * shows these in order: the agent's commentary, the files it read and edited,
 * the commands it ran, other tool calls, and what each of them returned.
 *
 * Entries that belong to one tool call share its `toolUseId`, so a view can
 * pair each call with its output.
 */
export type LogEntry =
  | { readonly kind: "commentary"; readonly text: string }
  | { readonly kind: "read"; readonly toolUseId: string; readonly path: string }
  | {
      readonly kind: "edit";
      readonly toolUseId: string;
      readonly tool: string;
      readonly path: string;
    }
  | {
      readonly kind: "command";
      readonly toolUseId: string;
      readonly command: string;
      readonly description: string | undefined;
    }
  | {
      readonly kind: "tool";
      readonly toolUseId: string;
      readonly name: string;
      /** The tool's input, as JSON. */
      readonly input: string;
    }
  | {
      readonly kind: "output";
      readonly toolUseId: string;
      readonly text: string;
      readonly isError: boolean;
    }
  | { readonly kind: "error"; readonly text: string }
  /** A line of agent output that isn't in the expected format, kept verbatim. */
  | { readonly kind: "unparsed"; readonly text: string };
