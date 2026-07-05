import { useState } from 'react'

import { agentRunHref } from '@/app/router'
import { formatSessionAge } from '@/features/missionControl/sessionAge'
import { DockShell, Panel, PanelHead, SDot } from '@/shared/ui/atoms'
import { IconPlus } from '@/shared/ui/icons'
import { useNow } from '@/shared/useNow'
import { usePanelCollapse } from '@/shared/usePanelCollapse'

import { sessionDotKind } from './displayStatus'
import type { SessionActivity } from './displayStatus'
import { launchSession } from './launchSession'
import { openSession } from './openSession'
import { sessionLabel, sessionRepoLabel } from './sessionLabel'
import type { SessionState } from './sessions'
import { useSessionActivity } from './useSessionActivity'
import { useSessions } from './useSessions'

const AGENT_BINARY = 'claude'

const AGE_REFRESH_MS = 30_000

// TODO(backend): per-session branch — sessions are not bound to a worktree/branch (worktree.rs exposes no command; repo_head covers only the active project). Render sessionRepoLabel(session) until a session→branch mapping exists.
// TODO(backend): per-session diff stats unavailable — get_diff is the active project's working tree, not attributable to one session. Omit +/− in session rows; show repo · age instead.
const sessionMeta = (
	session: SessionState,
	now: number,
	showRepo: boolean,
): string => {
	const tail = formatSessionAge(now, session.startedAt)
	const repo = showRepo ? sessionRepoLabel(session) : null
	return repo === null ? tail : `${repo} · ${tail}`
}

type NewSessionButtonProps = {
	repoPath: string
}

// launchSession navigates to the new pane itself; pending only guards a
// double click while session_create is in flight.
const NewSessionButton = ({
	repoPath,
}: NewSessionButtonProps): React.JSX.Element => {
	const [pending, setPending] = useState(false)

	const handleClick = (): void => {
		setPending(true)
		void launchSession({ binary: AGENT_BINARY, repoPath }).finally(() => {
			setPending(false)
		})
	}

	return (
		<button
			type="button"
			className="mz-iconbtn"
			aria-label="New session"
			disabled={pending}
			aria-busy={pending}
			onClick={handleClick}
		>
			<IconPlus />
		</button>
	)
}

type RowProps = {
	session: SessionState
	active: boolean
	now: number
	showRepo: boolean
	activity: SessionActivity
}

const SessionRow = ({
	session,
	active,
	now,
	showRepo,
	activity,
}: RowProps): React.JSX.Element => (
	<a
		className="lrow"
		href={agentRunHref(session.id)}
		aria-current={active ? 'page' : undefined}
		data-on={active}
		title={session.id}
		onClick={event => {
			event.preventDefault()
			openSession(session)
		}}
	>
		<span className="lr-dot">
			<SDot s={sessionDotKind(activity)} />
		</span>
		<div style={{ minWidth: 0 }}>
			{/* TODO(backend): no task/prompt is stored for a session (SessionState has no task field). Render sessionLabel(session) — OSC title or binary basename — as the row title. */}
			<div className="lr-t">{sessionLabel(session)}</div>
			<div className="lr-b">{sessionMeta(session, now, showRepo)}</div>
		</div>
	</a>
)

// How many status dots the folded band shows before it tallies the rest.
const FOLD_DOT_LIMIT = 6

type FoldProps = {
	sessions: ReadonlyArray<SessionState>
	activityFor: (id: string) => SessionActivity
}

// The folded band's summary: the session tally over a stack of status dots, so
// a glance still tells you how many agents run and how they're doing.
const SessionsFold = ({
	sessions,
	activityFor,
}: FoldProps): React.JSX.Element => (
	<>
		<span className="panel-fold__count" data-accent={sessions.length > 0}>
			{sessions.length}
		</span>
		{sessions.slice(0, FOLD_DOT_LIMIT).map(session => (
			<SDot
				key={session.id}
				s={sessionDotKind(activityFor(session.id))}
			/>
		))}
	</>
)

type Props = {
	activeSessionId: string
	activeProjectPath: string | null
}

export const CockpitSessions = ({
	activeSessionId,
	activeProjectPath,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const now = useNow(AGE_REFRESH_MS)
	const activityFor = useSessionActivity()
	const { collapsed, toggle } = usePanelCollapse('cockpit.sessions')
	// The cockpit is per-repo (MP2): it follows the active session's repo, so it
	// lists only that repo's sessions — a sibling repo's agents never bleed in.
	// Before any repo is followed (null) nothing scopes the list, so show all.
	const repoSessions =
		activeProjectPath === null
			? sessions
			: sessions.filter(session => session.repoPath === activeProjectPath)
	// The list spans repos only when no repo is followed; once scoped to one,
	// every row shares the same repo so the chip is noise.
	const showRepo = activeProjectPath === null

	return (
		<Panel className="fc-sess" collapsed={collapsed}>
			<DockShell
				title="Sessions"
				side="left"
				collapsed={collapsed}
				onExpand={toggle}
				fold={
					<SessionsFold
						sessions={repoSessions}
						activityFor={activityFor}
					/>
				}
			>
				<PanelHead
					title="Sessions"
					count={repoSessions.length}
					collapsed={collapsed}
					onToggleCollapse={toggle}
				>
					{activeProjectPath !== null && (
						<NewSessionButton repoPath={activeProjectPath} />
					)}
				</PanelHead>
				<nav className="fc-sess-list" aria-label="Sessions">
					{repoSessions.map(session => (
						<SessionRow
							key={session.id}
							session={session}
							active={session.id === activeSessionId}
							now={now}
							showRepo={showRepo}
							activity={activityFor(session.id)}
						/>
					))}
				</nav>
				<div className="fc-sess-foot">
					<span>Jump to… (top bar) switches agents</span>
				</div>
			</DockShell>
		</Panel>
	)
}
