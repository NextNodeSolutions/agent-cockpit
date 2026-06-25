// A session's PTY can exit on its own (the agent crashed or finished) or
// because the user stopped it. `agent:end` fires for both, and a killed child
// reports a non-zero, signal-based code — so to surface only an UNEXPECTED exit
// we track the sessions the user closed on purpose. Until session history
// lands, a vanished session is otherwise the only sign a crash happened.

const intentionallyClosed = new Set<string>()

// Record that the user is closing this session, called before `session_close`
// is invoked so the resulting `agent:end` is treated as expected (no toast).
export const markIntentionalClose = (sessionId: string): void => {
	intentionallyClosed.add(sessionId)
}

// Whether this end was a user-initiated close; consumes the mark. Session ids
// are never reused, so a mark left behind by a failed close is inert.
export const consumeIntentionalClose = (sessionId: string): boolean =>
	intentionallyClosed.delete(sessionId)

// The toast for a session's PTY exit, or null when silent: a clean exit (0).
// The caller suppresses intentional closes via `consumeIntentionalClose` first,
// so this only ever sees an exit worth reporting.
export const crashToast = (label: string, exitCode: number): string | null =>
	exitCode === 0 ? null : `${label} exited with code ${exitCode}`
