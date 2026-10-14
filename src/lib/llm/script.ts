import { db } from "@/lib/db";
import { registerPhoenix } from "./phoenix";
import { flushLlmCalls } from "./usage";

/**
 * Runs a command-line script that makes model calls (the evals, snapshot-job). Traces and usage records are written
 * in the background, so the script must send them and close the database before it exits, or they are lost and the
 * process hangs on the open connection. `main` may return an exit code; a thrown error is printed and exits 1.
 */
export async function runLlmScript(main: () => Promise<number | void>): Promise<never> {
  const provider = await registerPhoenix();
  let code = 0;
  try {
    code = (await main()) ?? Number(process.exitCode ?? 0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    code = 1;
  }
  await flushLlmCalls();
  await provider?.forceFlush();
  await provider?.shutdown();
  await db().$client.end();
  process.exit(code);
}
