import { describe, expect, it } from 'vitest'

import {
	sessionDisplayStatus,
	DISPLAY_STATUS_LABEL,
	IDLE_AFTER_MS,
} from './displayStatus'

describe('sessionDisplayStatus', () => {
	it('is running without any activity reading', () => {
		expect(sessionDisplayStatus()).toBe('running')
	})

	it('keeps running while output is recent', () => {
		const now = 10_000
		expect(
			sessionDisplayStatus({
				lastActiveAt: now - (IDLE_AFTER_MS - 1),
				now,
			}),
		).toBe('running')
	})

	it('flips to idle once output has been quiet', () => {
		const now = 10_000
		expect(
			sessionDisplayStatus({ lastActiveAt: now - IDLE_AFTER_MS, now }),
		).toBe('idle')
	})

	it('stays running when no activity has been observed yet', () => {
		// A just-launched agent with no ping yet is optimistically working.
		expect(sessionDisplayStatus({ lastActiveAt: undefined, now: 0 })).toBe(
			'running',
		)
	})
})

describe('DISPLAY_STATUS_LABEL', () => {
	it('labels every display status', () => {
		expect(DISPLAY_STATUS_LABEL).toEqual({
			running: 'running',
			idle: 'idle',
			needInput: 'needs input',
		})
	})
})
