"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleStop, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { skipProposalAction } from "@/app/(app)/library/record/actions";
import { Button } from "@/components/ui/button";
import { CAREER_STATUS_KEY } from "./use-career-status";

/**
 * Sets the current source aside unreviewed so the next one is prepared: "Stop and skip" while it is being read,
 * "Review later" once it is waiting for review. It can be prepared again from the Career record tab.
 */
export function SkipButton({
  proposalId,
  ready,
  size = "sm",
  variant = "outline",
  className,
}: {
  proposalId: string;
  /** Waiting for review rather than being prepared. */
  ready: boolean;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await skipProposalAction(proposalId);
          if (res.ok) {
            toast.success(`Skipped ${res.label}`, {
              description: "It stays unreviewed. Prepare it from the Career record tab when you want it.",
            });
          } else {
            toast.error(res.error);
          }
          await client.invalidateQueries({ queryKey: CAREER_STATUS_KEY });
          router.refresh();
        })
      }
    >
      {ready ? <Clock aria-hidden /> : <CircleStop aria-hidden />}
      {ready ? "Review later" : "Stop and skip"}
    </Button>
  );
}
