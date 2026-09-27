import { join } from "node:path";

/** Environment variable that relocates `~/.spec-plans`, e.g. for an Extension Development Host. */
export const SPEC_PLANS_HOME_VARIABLE = "SPEC_PLANS_HOME";

/** Where Spec Plans keeps its data: `~/.spec-plans`, unless overridden by the environment. */
export const specPlansHome = (
  env: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string => {
  const override = env[SPEC_PLANS_HOME_VARIABLE];
  return override !== undefined && override !== "" ? override : join(homeDirectory, ".spec-plans");
};
