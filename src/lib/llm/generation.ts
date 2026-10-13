import { env } from "@/lib/env";
import { chatCompletion } from "./chat";

/** Writes resumes, cover letters and cold emails. Full use arrives in Stage 4. */
export interface GenerationProvider {
  id: string;
  generate(input: { system: string; prompt: string }): Promise<string>;
}

export class TogetherProvider implements GenerationProvider {
  id = "together";

  async generate({ system, prompt }: { system: string; prompt: string }) {
    const { content, finishReason } = await chatCompletion({
      model: env().WRITER_MODEL,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    if (finishReason === "length") {
      throw new Error("Output was cut off (max_tokens); the input may be too long");
    }
    return content;
  }
}
