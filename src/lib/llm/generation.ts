import { env } from "@/lib/env";
import { anthropic } from "./client";

/** Writes resumes, cover letters and cold emails. Full use arrives in Stage 4. */
export interface GenerationProvider {
  id: string;
  generate(input: { system: string; prompt: string }): Promise<string>;
}

export class AnthropicProvider implements GenerationProvider {
  id = "anthropic";

  async generate({ system, prompt }: { system: string; prompt: string }) {
    const res = await anthropic().messages.create({
      model: env().WRITER_MODEL,
      max_tokens: 16000,
      system,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    });
    return res.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
  }
}
