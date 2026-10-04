import { sql } from "drizzle-orm";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { together } from "@/lib/llm/client";

export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; detail: string };

async function checks(): Promise<Check[]> {
  const out: Check[] = [];

  try {
    await db().execute(sql`select 1`);
    out.push({ name: "Postgres", ok: true, detail: "Connected" });
  } catch (err) {
    out.push({ name: "Postgres", ok: false, detail: (err as Error).message });
  }

  try {
    const e = env();
    const available = new Set((await together().models.list()).map((m) => m.id));
    const missing = [e.WRITER_MODEL, e.EXTRACTION_MODEL, e.FAST_MODEL].filter(
      (id) => !available.has(id),
    );
    out.push({
      name: "Together AI",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? "Credentials work and all configured models are available"
          : `Credentials work, but these model IDs were not found: ${missing.join(", ")}`,
    });
  } catch (err) {
    out.push({
      name: "Together AI",
      ok: false,
      detail: `${(err as Error).message}. Set TOGETHER_AI_API_KEY in .env.`,
    });
  }

  out.push(
    env().TAVILY_API_KEY
      ? { name: "Web search (Tavily)", ok: true, detail: "API key is set. Searches are used only when the posting and the company's own site are not enough" }
      : {
          name: "Web search (Tavily)",
          ok: false,
          detail: "Not set up. Company research uses only the posting and the company's own site. Add TAVILY_API_KEY to .env (free tier at tavily.com) to allow searches.",
        },
  );

  return out;
}

export default async function SettingsPage() {
  const results = await checks();
  const e = env();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Whether the services the app depends on are reachable, and which models it uses.</p>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Health</h2>
        {results.map((c) => (
          <Card key={c.name} size="sm">
            <CardContent className="flex items-start gap-3">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 size-5 text-green-600" />
              ) : (
                <XCircle className="mt-0.5 size-5 text-destructive" />
              )}
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-muted-foreground">{c.detail}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Models</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Writing (resume, cover letter, cold email): {e.WRITER_MODEL}</div>
          <div>Extraction, scoring, classification: {e.EXTRACTION_MODEL}</div>
          <div>Bulk triage: {e.FAST_MODEL}</div>
          <div>Embeddings (Stage 5, local via Ollama): {e.EMBEDDING_MODEL}</div>
        </CardContent>
      </Card>
    </div>
  );
}
