import { env } from "@/lib/env";
import { together } from "./client";

/** Writes resumes, cover letters and cold emails. Full use arrives in Stage 4. */
export interface GenerationProvider {
  id: string;
  generate(input: { system: string; prompt: string }): Promise<string>;
}

export class TogetherProvider implements GenerationProvider {
  id = "together";

  async generate({ system, prompt }: { system: string; prompt: string }) {
    const res = await together().chat.completions.create({
      model: env().WRITER_MODEL,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    const choice = res.choices[0];
    if (choice?.finish_reason === "length") {
      throw new Error("Output was cut off (max_tokens); the input may be too long");
    }
    return choice?.message?.content ?? "";
  }
}
