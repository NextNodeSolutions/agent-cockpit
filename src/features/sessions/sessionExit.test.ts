import { beforeEach, describe, expect, it } from 'vitest'

import {
	consumeIntentionalClose,
	crashToast,
	markIntentionalClose,
} from './sessionExit'

describe('crashToast', () => {
	it('is silent for a clean exit', () => {
		expect(crashToast('claude', 0)).toBeNull()
	})

	it('names the agent and code for a non-zero exit', () => {
		expect(crashToast('claude', 137)).toBe('claude exited with code 137')
	})
})

describe('intentional close registry', () => {
	beforeEach(() => {
		// Drain any leftover marks between tests.
		consumeIntentionalClose('sess-a')
		consumeIntentionalClose('sess-b')
	})

	it('consumes a mark exactly once', () => {
		markIntentionalClose('sess-a')
		expect(consumeIntentionalClose('sess-a')).toBe(true)
		expect(consumeIntentionalClose('sess-a')).toBe(false)
	})

	it('is false for a session that was never marked', () => {
		expect(consumeIntentionalClose('sess-b')).toBe(false)
	})
})
