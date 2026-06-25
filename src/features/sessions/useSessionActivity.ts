import { useAtomValue } from 'jotai'

import { useNow } from '@/shared/useNow'

import type { SessionActivity } from './displayStatus'
import { sessionActivityAtom } from './sessions'

// Poll a touch faster than the idle threshold (IDLE_AFTER_MS, 600ms) so a
// session flips to idle within ~one tick of going quiet, not a whole threshold
// late. The cockpit is a short list, so a sub-second re-render of it is cheap.
const IDLE_POLL_MS = 300

/**
 * A live clock paired with the activity map, exposed as a per-session
 * {@link SessionActivity} lookup to hand `sessionDisplayStatus`/`sessionDotKind`.
 *
 * Resolve it once per list and reuse the returned lookup across rows: one
 * `useNow` timer drives every row's running↔idle transition off a single clock.
 */
export const useSessionActivity = (): ((
	sessionId: string,
) => SessionActivity) => {
	const activity = useAtomValue(sessionActivityAtom)
	const now = useNow(IDLE_POLL_MS)
	return sessionId => ({ lastActiveAt: activity[sessionId], now })
}
