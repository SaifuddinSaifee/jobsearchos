import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { $client: client });
}

// Reuse one connection pool across dev HMR reloads.
const globalForDb = globalThis as unknown as { __db?: Db };

export function db(): Db {
  return (globalForDb.__db ??= createDb(env().DATABASE_URL));
}
