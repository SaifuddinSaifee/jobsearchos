import type { SendWarning } from "./checks";

/** A failure with a message for the user. `needs` lists warnings that must be acknowledged before sending. */
export class OutreachError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "not_found" | "not_connected" | "blocked" | "needs_ack" | "busy" | "send_failed",
    readonly needs?: SendWarning[],
  ) {
    super(message);
  }
}
