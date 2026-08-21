import vm from "vm";
import { z } from "zod";

// ─── Building block augmentation: local JavaScript code sandbox ──────────────
// Lets the model write and execute small JavaScript snippets in an isolated
// Node.js `vm` context. Only safe globals (console, Math, Date, JSON) are
// exposed — no `require`, `process`, `fs`, or network access — and execution
// is bounded by a strict timeout to guard against infinite loops.

export const jsSandboxInputSchema = z.object({
  code: z
    .string()
    .describe(
      "The JavaScript code to execute. Must include console.log(...) to output the result you want to see, since the return value of the code itself is not captured.",
    ),
});

export type JsSandboxInput = z.infer<typeof jsSandboxInputSchema>;

export interface JsSandboxResult {
  success: boolean;
  logs?: string;
  error?: string;
}

const EXECUTION_TIMEOUT_MS = 1000;

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Executes a snippet of JavaScript in an isolated vm context with a strict
 * timeout, capturing console.log/console.error output instead of letting the
 * code touch the real process, filesystem, or network.
 */
export function runJavaScript(code: string): JsSandboxResult {
  console.log(`Running JavaScript code in sandbox:
${code}
`);

  const logs: string[] = [];

  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map(formatLogArg).join(" ")),
      error: (...args: unknown[]) =>
        logs.push("ERROR: " + args.map(formatLogArg).join(" ")),
    },
    Math,
    Date,
    JSON,
    // Notice: `process`, `require`, `fs`, and other Node globals are
    // intentionally NOT injected here, keeping the sandbox safe.
  };

  try {
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code);

    // The timeout prevents infinite loops (or anything else pathological)
    // written by the model from hanging the server.
    script.runInContext(context, { timeout: EXECUTION_TIMEOUT_MS });

    return { success: true, logs: logs.join("\n") };
  } catch (err) {
    return {
      success: false,
      logs: logs.length > 0 ? logs.join("\n") : undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const JS_SANDBOX_TOOL_DESCRIPTION =
  "Execute JavaScript code in an isolated, sandboxed Node.js environment. Use this for math, data processing, or any logic that's easier to compute in code than in your head. Use console.log(...) to output the result — the return value of the code is not captured. No network, filesystem, or process access is available inside the sandbox.";
