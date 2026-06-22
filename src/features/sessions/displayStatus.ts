import type { SDotKind } from '@/shared/ui/atoms'

import type { SessionState } from './sessions'

/**
 * The status axis the cockpit UI communicates:
 * - `running`   — the agent is actively working (process alive, output flowing)
 * - `idle`      — alive but quiet, not doing anything right now
 * - `needInput` — paused mid-run, waiting on a human answer
 * - `review`    — ended cleanly; its changes await review
 * - `failed`    — ended on a non-zero or unknown exit
 *
 * Today only `running` / `review` / `failed` are derivable: raw SessionState
 * carries just `status` ('running' | 'ended') and `exitCode`, so `review` is a
 * proxy ("ended with exit 0") and there is no signal to tell a working agent
 * from an idle one or one blocked on input.
 */
export type SessionDisplayStatus =
	| 'running'
	| 'idle'
	| 'needInput'
	| 'review'
	| 'failed'

export const sessionDisplayStatus = (
	session: SessionState,
): SessionDisplayStatus => {
	// TODO(backend): `idle` and `needInput` need a real agent-state signal from
	// the PTY (running-active vs waiting-on-input vs quiet). Until that event
	// exists, a live process is always reported `running`; the two states are
	// scaffolded in the UI (dot/tag/label) ready to be wired.
	if (session.status === 'running') return 'running'
	return session.exitCode === 0 ? 'review' : 'failed'
}

export const DISPLAY_STATUS_LABEL: Readonly<
	Record<SessionDisplayStatus, string>
> = {
	running: 'running',
	idle: 'idle',
	needInput: 'needs input',
	review: 'needs review',
	failed: 'failed',
}

// The status-dot flavor per display status — the single home for the
// status→dot mapping, shared by the cockpit list, the term tab and the
// mission-control cards.
export const DISPLAY_STATUS_DOT: Readonly<
	Record<SessionDisplayStatus, SDotKind>
> = {
	running: 'run',
	idle: 'idle',
	needInput: 'input',
	review: 'rev',
	failed: 'fail',
}

export const sessionDotKind = (session: SessionState): SDotKind =>
	DISPLAY_STATUS_DOT[sessionDisplayStatus(session)]
