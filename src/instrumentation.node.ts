import { registerPhoenix } from "@/lib/llm/phoenix";

// Node-only part of instrumentation.ts: the OpenTelemetry packages cannot load in the edge runtime.
export async function startTracing() {
  await registerPhoenix();
}
