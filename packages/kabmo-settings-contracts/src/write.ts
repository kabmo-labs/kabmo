/** What a settings write did, so a pane reports the server's own answer. */
export interface WriteOutcome {
  ok: boolean;
  /** The refusal's sentence (the payload's `error`, or the transport failure). */
  error?: string;
}
