import { ensureCollectorEndpoint, OTLPTraceExporter, register } from "@arizeai/phoenix-otel";

type Provider = ReturnType<typeof register>;

const globalForPhoenix = globalThis as unknown as { __phoenix?: Promise<Provider> };

async function start(endpoint: string): Promise<Provider> {
  // The span processor ships in an ESM-only entry point, which the command-line scripts (compiled to CommonJS) can
  // only load with a dynamic import. "/vercel" is the Vercel AI SDK integration package, not the hosting platform.
  const { isOpenInferenceSpan, OpenInferenceSimpleSpanProcessor } = await import("@arizeai/phoenix-otel/vercel");
  return register({
    projectName: process.env.PHOENIX_PROJECT_NAME || "jobsearchos",
    spanProcessors: [
      // Each span is exported as soon as it ends rather than batched: a batch still queued when the server stops
      // would be lost, and a job makes only a handful of spans.
      new OpenInferenceSimpleSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: ensureCollectorEndpoint(endpoint),
          headers: process.env.PHOENIX_API_KEY ? { authorization: `Bearer ${process.env.PHOENIX_API_KEY}` } : {},
        }),
        // Phoenix only gets model traces, not every Next.js request span.
        spanFilter: isOpenInferenceSpan,
        reparentOrphanedSpans: true,
      }),
    ],
  });
}

/**
 * Starts sending model-call traces to Arize Phoenix, when PHOENIX_COLLECTOR_ENDPOINT is set. Resolves to the provider
 * (so a script can flush and shut it down), or null when tracing is off. Safe to call twice: a dev reload must not
 * register a second global provider.
 */
export function registerPhoenix(): Promise<Provider | null> {
  const endpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT;
  if (!endpoint) return Promise.resolve(null);
  return (globalForPhoenix.__phoenix ??= start(endpoint));
}
