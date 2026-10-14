import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { context, setMetadata, setSession, trace, traceChain } from "@arizeai/phoenix-otel";
import type { LlmAction, LlmIds } from "./names";

/** What one user action is, carried to every model call it makes. Set once by `withLlmContext`. */
export type LlmContext = LlmIds & {
  action: LlmAction;
  /** One per `withLlmContext` run, so the cost of "one job added" can be summed without Phoenix. */
  runId: string;
};

const store = new AsyncLocalStorage<LlmContext>();

/** The user action running this code, if any. */
export const currentLlmContext = () => store.getStore();

/** The id of the current trace, or null while tracing is off (no tracer provider is registered). */
export function currentTraceId(): string | null {
  const span = trace.getActiveSpan()?.spanContext();
  return span && trace.isSpanContextValid(span) ? span.traceId : null;
}

// Spans carry the step's name and timing, not its arguments or result: the model call inside already records
// what was sent and returned, and these would only duplicate whole resumes.
const noContent = () => ({});

/** Runs `fn` inside a named span, so the model calls it makes appear grouped under it in the trace. */
export function traceStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return traceChain(fn, { name, processInput: noContent, processOutput: noContent })();
}

/** Adds ids learned part way through a run (a version's document, say). Only calls made afterwards get them. */
export function addLlmIds(ids: LlmIds) {
  const ctx = store.getStore();
  if (!ctx) return;
  for (const [key, value] of Object.entries(ids)) {
    if (value) (ctx as Record<string, unknown>)[key] = value;
  }
}

/**
 * Runs one user action (a route, a server action or a queue job that may call a model). Opens the trace's root span
 * and tags every span below it, and carries the ids to the usage records.
 *
 * It always starts a fresh trace: a queue job started by `kickWorker()` from inside a request would otherwise join
 * that request's trace, and several jobs kicked by one request would end up in one.
 *
 * With tracing off this adds no spans and costs nothing, and usage records still get their context. Any new code
 * path that calls a model must run inside this, or its calls are recorded with action "unknown".
 */
export function withLlmContext<T>(
  action: LlmAction,
  ids: LlmIds,
  fn: () => Promise<T>,
  opts: { metadata?: Record<string, string | number> } = {},
): Promise<T> {
  const ctx: LlmContext = { action, runId: randomUUID(), ...Object.fromEntries(Object.entries(ids).filter(([, v]) => v)) };
  const session = ctx.jobId ?? ctx.companyId ?? ctx.proposalId ?? ctx.documentId ?? ctx.queueItemId;

  let otel = trace.deleteSpan(context.active());
  if (session) otel = setSession(otel, { sessionId: session });
  otel = setMetadata(otel, { action, runId: ctx.runId, ...Object.fromEntries(Object.entries(ids).filter(([, v]) => v)), ...opts.metadata });

  return store.run(ctx, () => context.with(otel, () => traceStep(action, fn)));
}
