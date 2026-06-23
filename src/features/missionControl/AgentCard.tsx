import { useEffect } from 'react'

import type { DiffTotals } from '@/features/review/reviewFiles'
import {
	DISPLAY_STATUS_DOT,
	sessionDisplayStatus,
} from '@/features/sessions/displayStatus'
import { openSession } from '@/features/sessions/openSession'
import { sessionLabel } from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'
import { subscribeToCellFrames } from '@/features/sessions/sessionSubscription'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'
import { useSessionActivity } from '@/features/sessions/useSessionActivity'
import { SDot, StatusTag } from '@/shared/ui/atoms'

import { SessionAgeLabel } from './SessionAgeLabel'

const TERMINAL_TAIL_LINES = 2

type MiniTermProps = {
	session: SessionState
}

// The card's two-line "what is it doing right now" window: a live grid tail.
// Every session in the store is live, so the window always tracks its output.
const MiniTerm = ({ session }: MiniTermProps): React.JSX.Element => {
	const frame = useCellFrame(session.id)
	const tail = terminalTail(frame, TERMINAL_TAIL_LINES)
	// The window is two fixed rows — name them instead of mapping.
	const lastLine = tail.at(-1)
	const previousLine = tail.length > 1 ? tail[0] : undefined

	return (
		<span className="term mini-term" aria-hidden="true">
			{lastLine === undefined && (
				<div className="term-line">
					<span className="t-dim">› waiting for output…</span>{' '}
					<span className="caret" />
				</div>
			)}
			{previousLine !== undefined && (
				<div className="term-line">{previousLine}</div>
			)}
			{lastLine !== undefined && (
				<div className="term-line">
					{lastLine} <span className="caret" />
				</div>
			)}
		</span>
	)
}

type Props = {
	session: SessionState
	/** The checked-out branch of the card's own repo, when known. */
	branch: string | null
	/** Working-tree +/− of the card's own repo, when known. */
	diff: DiffTotals | null
	style?: React.CSSProperties
}

export const AgentCard = ({
	session,
	branch,
	diff,
	style,
}: Props): React.JSX.Element => {
	const activityFor = useSessionActivity()
	const status = sessionDisplayStatus(activityFor(session.id))

	// Watching is what makes the backend emit frames for this session at all —
	// the card subscribes while visible, exactly like a terminal pane does.
	useEffect(() => subscribeToCellFrames(session.id), [session.id])

	return (
		<button
			type="button"
			className="agent-card"
			data-status={status}
			style={style}
			onClick={() => openSession(session)}
		>
			<span className="ac-top">
				<SDot s={DISPLAY_STATUS_DOT[status]} />
				<StatusTag status={status} />
				{branch !== null && (
					<span className="branch-chip">⎇ {branch}</span>
				)}
			</span>
			<span className="ac-task">{sessionLabel(session)}</span>
			<MiniTerm session={session} />
			<span className="ac-foot">
				{diff !== null && diff.files > 0 && (
					<span className="ac-diff">
						<b className="add">+{diff.additions}</b>{' '}
						<b className="del">−{diff.deletions}</b>
					</span>
				)}
				<SessionAgeLabel startedAt={session.startedAt} />
			</span>
		</button>
	)
}
