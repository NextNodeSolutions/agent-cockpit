import { describe, expect, it } from 'vitest'

import { resolveAppearance } from './resolveAppearance'

describe('resolveAppearance', () => {
	it('honours an explicit light theme regardless of the OS preference', () => {
		expect(resolveAppearance('light', true)).toBe('light')
	})

	it('honours an explicit dark theme regardless of the OS preference', () => {
		expect(resolveAppearance('dark', false)).toBe('dark')
	})

	it('follows the OS preference when the theme is system', () => {
		expect(resolveAppearance('system', true)).toBe('dark')
		expect(resolveAppearance('system', false)).toBe('light')
	})
})
