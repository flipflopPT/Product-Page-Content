// Anthropic returns credit exhaustion as a 400 invalid_request_error with a
// "credit balance is too low" message, not a dedicated status/type — so this
// checks the message text rather than relying on a stable error code.
export function isCreditsExhaustedError(err: unknown): boolean {
  const e = err as { status?: number; error?: { type?: string; error?: { type?: string; message?: string } }; message?: string };
  if (e?.status === 402 || e?.error?.error?.type === "credit_balance_too_low") return true;
  const msg = (e?.message ?? "") + (e?.error?.error?.message ?? "");
  return /credit balance is too low|insufficient.{0,20}credit|billing|no.{0,10}credit/i.test(msg);
}
