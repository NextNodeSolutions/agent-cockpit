import type { SessionState } from '@/features/sessions/sessions'

const isAgentBinary = (binary: string): boolean =>
	(binary.split('/').pop() ?? binary).startsWith('claude')

/**
 * The session a review remark should land in: the most recently started
 * session of the repo, preferring an agent (`claude*`) over a plain shell.
 * Every session in the store is live, so any of the repo's sessions can
 * receive input; null when the repo has none.
 */
export const pickAgentSession = (
	sessions: ReadonlyArray<SessionState>,
	repoPath: string | null,
): SessionState | null => {
	if (repoPath === null) return null
	const candidates = sessions
		.filter(session => session.repoPath === repoPath)
		.toSorted((a, b) => b.startedAt - a.startedAt)
	return (
		candidates.find(session => isAgentBinary(session.binary)) ??
		candidates[0] ??
		null
	)
}
