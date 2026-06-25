import { describe, expect, it } from 'vitest'

import { cockpitTargetHref } from './cockpitTarget'
import type { SessionState } from './sessions'

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

describe('cockpitTargetHref', () => {
	it('targets the active session when it still exists', () => {
		const sessions = [session('a'), session('b')]

		expect(cockpitTargetHref(sessions, 'b')).toBe('/agent-run/b')
	})

	it('ignores a stale active id and picks the most recent session', () => {
		const sessions = [
			session('old', { startedAt: 10 }),
			session('new', { startedAt: 20 }),
		]

		expect(cockpitTargetHref(sessions, 'gone')).toBe('/agent-run/new')
	})

	it('falls back to the most recently started session', () => {
		const sessions = [
			session('old', { startedAt: 10 }),
			session('new', { startedAt: 20 }),
		]

		expect(cockpitTargetHref(sessions, null)).toBe('/agent-run/new')
	})

	it('lands on the cockpit empty state without any session', () => {
		expect(cockpitTargetHref([], null)).toBe('/agent-run')
	})
})
