// instrumentation.ts
//
// Next.js automatically loads this file from the project root before any
// route handlers run. It's the entry point for OpenTelemetry setup.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
