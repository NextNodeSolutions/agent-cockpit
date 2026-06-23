import { describe, expect, it } from 'vitest'

import {
	sessionDisplayStatus,
	DISPLAY_STATUS_LABEL,
	IDLE_AFTER_MS,
} from './displayStatus'
import type { SessionState } from './sessions'

const session = (overrides: Partial<SessionState>): SessionState => ({
	id: 'sess-a',
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	status: 'running',
	exitCode: null,
	startedAt: 0,
	...overrides,
})

describe('sessionDisplayStatus', () => {
	it('maps a running session to running', () => {
		expect(sessionDisplayStatus(session({}))).toBe('running')
	})

	it('maps a clean exit to review — the agent finished, the diff awaits', () => {
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: 0 })),
		).toBe('review')
	})

	it('maps a non-zero exit to failed', () => {
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: 1 })),
		).toBe('failed')
	})

	it('maps an ended session without exit code to failed', () => {
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: null })),
		).toBe('failed')
	})

	it('keeps a running session running while output is recent', () => {
		const now = 10_000
		expect(
			sessionDisplayStatus(session({}), {
				lastActiveAt: now - (IDLE_AFTER_MS - 1),
				now,
			}),
		).toBe('running')
	})

	it('flips a running session to idle once output has been quiet', () => {
		const now = 10_000
		expect(
			sessionDisplayStatus(session({}), {
				lastActiveAt: now - IDLE_AFTER_MS,
				now,
			}),
		).toBe('idle')
	})

	it('stays running when no activity has been observed yet', () => {
		// A just-launched agent with no ping yet is optimistically working.
		expect(
			sessionDisplayStatus(session({}), { lastActiveAt: undefined, now: 0 }),
		).toBe('running')
	})

	it('ignores activity for an ended session — review/failed win', () => {
		const now = 10_000
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: 0 }), {
				lastActiveAt: now - IDLE_AFTER_MS * 10,
				now,
			}),
		).toBe('review')
	})
})

describe('DISPLAY_STATUS_LABEL', () => {
	it('labels every display status', () => {
		expect(DISPLAY_STATUS_LABEL).toEqual({
			running: 'running',
			idle: 'idle',
			needInput: 'needs input',
			review: 'needs review',
			failed: 'failed',
		})
	})
})
