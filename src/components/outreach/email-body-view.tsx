import { Fragment, type ReactNode } from "react";
import { lineRuns, textToEmailDoc, type EmailDoc } from "@/lib/outreach/body";
import { cn } from "@/lib/utils";

const WRAP = { bold: "strong", italic: "em", underline: "u" } as const;

/** An email body as it will read: lines, blank lines, formatting and links. Falls back to the plain text for older emails. */
export function EmailBodyView({ doc, text, className }: { doc: EmailDoc | null; text: string; className?: string }) {
  const body = doc ?? textToEmailDoc(text);
  return (
    <div className={cn("break-words whitespace-pre-wrap [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2", className)}>
      {body.content.map((line, i) => (
        <div key={i}>
          {line.content?.length
            ? lineRuns(line).map((run, j) => {
                const inner = run.parts.map((p, k) => (
                  <Fragment key={k}>
                    {(p.marks ?? []).reduceRight<ReactNode>((acc, m) => {
                      if (m.type === "link") return acc;
                      const Tag = WRAP[m.type];
                      return <Tag>{acc}</Tag>;
                    }, p.text)}
                  </Fragment>
                ));
                return run.href ? (
                  <a key={j} href={run.href} target="_blank" rel="noopener noreferrer">
                    {inner}
                  </a>
                ) : (
                  <span key={j}>{inner}</span>
                );
              })
            : <br />}
        </div>
      ))}
    </div>
  );
}
