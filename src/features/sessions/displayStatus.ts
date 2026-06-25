import type { SDotKind } from '@/shared/ui/atoms'

/**
 * The status axis the cockpit UI communicates. Every session in the store is
 * live (a PTY that exits is dropped, not kept as history), so the axis is the
 * live sub-state only:
 * - `running`   — the agent is actively working (process alive, output flowing)
 * - `idle`      — alive but quiet, not doing anything right now
 * - `needInput` — paused mid-run, waiting on a human answer
 *
 * `running` vs `idle` is driven by PTY output activity: a live session counts as
 * `running` while output is flowing and flips to `idle` once it has been quiet
 * for {@link IDLE_AFTER_MS} (the backend's `agent:activity` ping timestamps the
 * last output; see `sessionActivityAtom`). `needInput` still has no signal — it
 * needs a shell/agent prompt marker — so a blocked agent currently reads `idle`.
 */
export type SessionDisplayStatus = 'running' | 'idle' | 'needInput'

/**
 * Quiet span after which a live session is shown `idle` rather than `running`.
 * Comfortably above the backend's 250ms activity-ping throttle, so continuous
 * output never momentarily reads as idle between pings.
 */
export const IDLE_AFTER_MS = 600

export type SessionActivity = {
	/** Epoch ms of the session's last observed output, or undefined if none. */
	lastActiveAt: number | undefined
	/** Current epoch ms, to measure the quiet span against (from `useNow`). */
	now: number
}

export const sessionDisplayStatus = (
	activity?: SessionActivity,
): SessionDisplayStatus => {
	// A live session goes idle once output has been quiet past the threshold.
	// Without an activity reading (caller passed none, or none seen yet) it
	// stays optimistically `running` — a just-launched agent is working.
	if (
		activity !== undefined &&
		activity.lastActiveAt !== undefined &&
		activity.now - activity.lastActiveAt >= IDLE_AFTER_MS
	) {
		return 'idle'
	}
	return 'running'
}

export const DISPLAY_STATUS_LABEL: Readonly<
	Record<SessionDisplayStatus, string>
> = {
	running: 'running',
	idle: 'idle',
	needInput: 'needs input',
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
}

export const sessionDotKind = (activity?: SessionActivity): SDotKind =>
	DISPLAY_STATUS_DOT[sessionDisplayStatus(activity)]
