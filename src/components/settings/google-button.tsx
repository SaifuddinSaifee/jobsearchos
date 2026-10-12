"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Google's four-colour "G", as published in their sign-in branding kit. */
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * "Continue with Google", styled to Google's sign-in branding guidelines (white or dark fill, grey outline,
 * the unmodified logo, 40px tall). Their review checks this before approving the app, so the colours are
 * fixed rather than taken from the theme.
 */
export function GoogleButton({
  onClick,
  loading = false,
  label = "Continue with Google",
  className,
}: {
  onClick: () => void;
  loading?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex h-10 items-center gap-2.5 overflow-hidden rounded-full border px-3 pr-4 text-sm font-medium outline-none select-none",
        "border-[#747775] bg-white text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]",
        // State layer: Google's hover and press tints, laid over the fill so the logo keeps its colours.
        "after:pointer-events-none after:absolute after:inset-0 after:bg-[#303030] after:opacity-0 after:transition-opacity after:duration-150 dark:after:bg-white",
        "hover:after:opacity-[0.08] active:after:opacity-[0.12]",
        "transition-[scale,box-shadow] duration-150 active:not-disabled:scale-[0.97] hover:shadow-sm",
        "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-progress disabled:opacity-70",
        className,
      )}
      style={{ fontFamily: "Roboto, var(--font-sans)" }}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <GoogleLogo className="size-5" />}
      <span>{loading ? "Opening Google..." : label}</span>
    </button>
  );
}
