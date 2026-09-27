import { describe, expect, it } from "vitest";
import { statusOnStartup } from "./execution";

describe("statusOnStartup", () => {
  it("records a run left running as cancelled", () => {
    expect(statusOnStartup("running")).toBe("cancelled");
  });

  it.each(["finished", "failed", "cancelled"] as const)("keeps a %s run as it is", (status) => {
    expect(statusOnStartup(status)).toBe(status);
  });
});
