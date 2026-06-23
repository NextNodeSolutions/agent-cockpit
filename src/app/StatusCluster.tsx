import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { useSessionActivity } from '@/features/sessions/useSessionActivity'
import { useSessions } from '@/features/sessions/useSessions'
import { SDot } from '@/shared/ui/atoms'

import { missionControlHref, navigate } from './router'

/**
 * The topbar's live pulse: how many agents are working right now, how many are
 * idle — each pill deep-links mission control pre-filtered.
 */
export const StatusCluster = (): React.JSX.Element => {
	const sessions = useSessions()
	const activityFor = useSessionActivity()
	const statuses = sessions.map(session =>
		sessionDisplayStatus(activityFor(session.id)),
	)
	const runningCount = statuses.filter(status => status === 'running').length
	const idleCount = statuses.filter(status => status === 'idle').length

	// TODO(subagents): surface the Claude subagent count ('+N sub' chip)
	// when the backend reports a subagent feed per session.
	return (
		<div className="mz-status">
			<button
				type="button"
				className="mz-statbtn"
				title="Jump to running agents"
				onClick={() => navigate(missionControlHref('running'))}
			>
				<SDot s="run" />
				<b>{runningCount}</b>
				<span className="sl">running</span>
			</button>
			<button
				type="button"
				className="mz-statbtn"
				title="Jump to idle agents"
				onClick={() => navigate(missionControlHref('idle'))}
			>
				<SDot s="idle" />
				<b>{idleCount}</b>
				<span className="sl">idle</span>
			</button>
		</div>
	)
}
