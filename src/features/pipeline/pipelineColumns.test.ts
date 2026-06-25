import { describe, expect, it } from 'vitest'

import type { SessionState } from '@/features/sessions/sessions'
import type { Overview, Task } from '@/features/tasks/tasks'

import {
	groupColumnByRepo,
	pipelineColumns,
	primaryApproveSessionId,
} from './pipelineColumns'

const task = (id: string, status: Task['status']): Task => ({
	repoPath: '/repo/x',
	id,
	identifier: null,
	origin: 'track',
	milestoneId: 'm1',
	trackId: 't1',
	step: null,
	title: `Task ${id}`,
	description: null,
	doneWhen: null,
	size: null,
	sliceOf: [],
	sinkId: null,
	position: 0,
	status,
	blockedReason: status === 'blocked' ? 'waiting on infra' : null,
	commitSha: null,
	createdAt: '2026-01-01T00:00:00Z',
})

const session = (
	id: string,
	overrides: Partial<SessionState> = {},
): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	startedAt: 0,
	...overrides,
})

const overview = (
	tasks: ReadonlyArray<Task>,
	user: ReadonlyArray<Task>,
): Overview => ({
	milestones: [
		{
			id: 'm1',
			number: 1,
			demo: 'demo',
			skeleton: false,
			needs: [],
			tracks: [{ id: 't1', branch: 'feat/x', tasks }],
		},
	],
	userTasks: user,
})

const NONE_APPROVED: ReadonlySet<string> = new Set()

describe('pipelineColumns', () => {
	it('routes tasks to their columns and every session to running', () => {
		const columns = pipelineColumns(
			[
				overview(
					[
						task('a', 'backlog'),
						task('b', 'in_progress'),
						task('c', 'done'),
					],
					[task('u', 'backlog')],
				),
			],
			[session('run'), session('two')],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual(['a', 'u'])
		expect(columns.inProgressTasks.map(entry => entry.task.id)).toEqual([
			'b',
		])
		expect(columns.runningSessions.map(s => s.id)).toEqual(['run', 'two'])
		expect(columns.done.map(entry => entry.task.id)).toEqual(['c'])
	})

	it('keeps the review and done-session columns empty — every session is live', () => {
		const columns = pipelineColumns(
			[],
			[session('a'), session('b')],
			new Set(['b']),
		)

		expect(columns.runningSessions.map(s => s.id)).toEqual(['a', 'b'])
		expect(columns.endedSessions).toEqual([])
		expect(columns.doneSessions).toEqual([])
	})

	it('keeps blocked tasks visible in the backlog', () => {
		const columns = pipelineColumns(
			[overview([task('x', 'blocked')], [])],
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual(['x'])
	})

	it('carries the track branch onto task entries', () => {
		const columns = pipelineColumns(
			[overview([task('a', 'backlog')], [])],
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog[0]?.branch).toBe('feat/x')
	})

	it('merges the overviews of every repo into the same columns', () => {
		const taskOfRepo = (id: string, repoPath: string): Task => ({
			...task(id, 'backlog'),
			repoPath,
		})
		const columns = pipelineColumns(
			[
				overview([taskOfRepo('a1', '/repo/alpha')], []),
				overview([taskOfRepo('b1', '/repo/beta')], []),
			],
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual([
			'a1',
			'b1',
		])
		expect(columns.backlog.map(entry => entry.task.repoPath)).toEqual([
			'/repo/alpha',
			'/repo/beta',
		])
	})

	it('groups a column by repo, sessions first, first-seen order', () => {
		const sessions = [
			session('s1', { repoPath: '/repo/beta' }),
			session('s2', { repoPath: '/repo/alpha' }),
		]
		const entries = [
			{
				task: { ...task('t1', 'in_progress'), repoPath: '/repo/alpha' },
				branch: null,
			},
		]

		const groups = groupColumnByRepo(sessions, entries)

		expect(groups.map(group => group.repoPath)).toEqual([
			'/repo/beta',
			'/repo/alpha',
		])
		expect(groups[1]?.sessions.map(s => s.id)).toEqual(['s2'])
		expect(groups[1]?.entries.map(entry => entry.task.id)).toEqual(['t1'])
	})

	it('handles no overview at all', () => {
		const columns = pipelineColumns([], [session('run')], NONE_APPROVED)

		expect(columns.backlog).toEqual([])
		expect(columns.runningSessions.map(s => s.id)).toEqual(['run'])
	})
})

describe('primaryApproveSessionId', () => {
	const ofRepo = (id: string, repoPath: string): SessionState =>
		session(id, { repoPath })

	it('returns null for an empty column — the parked steady state', () => {
		expect(primaryApproveSessionId([])).toBeNull()
	})

	it('targets the first card of the first repo group, not the flat order', () => {
		// beta is seen first in the flat order, so its group leads and its first
		// card owns the primary Approve — even though alpha's card trails it.
		const ended = [
			ofRepo('beta-1', '/repo/beta'),
			ofRepo('alpha-1', '/repo/alpha'),
			ofRepo('beta-2', '/repo/beta'),
		]

		expect(primaryApproveSessionId(ended)).toBe('beta-1')
	})
})
