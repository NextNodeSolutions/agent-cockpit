import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	activeSessionIdAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'

import { Rail } from './Rail'

const store = getDefaultStore()

describe('Rail', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(activeSessionIdAtom, null)
		window.history.pushState({}, '', '/')
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
	})

	const render = (): void => {
		act(() => {
			root.render(<Rail />)
		})
	}

	const button = (label: string): HTMLElement | null =>
		container.querySelector<HTMLElement>(
			`.mz-railbtn[aria-label="${label}"]`,
		)

	// parked-views: Board and Plans are hidden from the rail (see shellViews.tsx).
	// When they return, re-add 'Board'/'Plans' to the labels list (length 5) and
	// restore the /plans deep-link active-state case removed below.
	it('offers the three active views with icon and label', () => {
		render()

		const labels = Array.from(
			container.querySelectorAll('.mz-rail .mz-railbtn .rl'),
		).map(label => label.textContent)
		expect(labels).toEqual(['Agents', 'Cockpit', 'Review'])
		expect(container.querySelectorAll('.mz-railbtn svg')).toHaveLength(3)
	})

	it('marks the view owning the current route', () => {
		window.history.pushState({}, '', '/review')
		render()

		expect(button('Review')?.getAttribute('data-on')).toBe('true')
		expect(button('Agents')?.getAttribute('data-on')).toBe('false')

		act(() => {
			button('Agents')?.click()
		})

		expect(button('Agents')?.getAttribute('data-on')).toBe('true')
		expect(button('Review')?.getAttribute('data-on')).toBe('false')
	})

	it('claims the cockpit on both session panes and the empty state', () => {
		window.history.pushState({}, '', '/agent-run/sess-1')
		render()
		expect(button('Cockpit')?.getAttribute('data-on')).toBe('true')

		act(() => {
			window.history.pushState({}, '', '/agent-run')
			window.dispatchEvent(new PopStateEvent('popstate'))
		})
		expect(button('Cockpit')?.getAttribute('data-on')).toBe('true')
	})

	it('routes the cockpit to the active session', () => {
		store.set(startSessionAtom, {
			id: 'sess-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(startSessionAtom, {
			id: 'sess-2',
			binary: 'zsh',
			repoPath: '/repo',
		})
		store.set(activeSessionIdAtom, 'sess-2')
		render()

		act(() => {
			button('Cockpit')?.click()
		})

		expect(window.location.pathname).toBe('/agent-run/sess-2')
	})

	it('routes the cockpit to its empty state without sessions', () => {
		render()

		act(() => {
			button('Cockpit')?.click()
		})

		expect(window.location.pathname).toBe('/agent-run')
	})

	// parked-views: Board (→ /pipeline) and Plans (→ /plans) clicks were removed
	// with their rail buttons; restore them here when the entries come back.
	it('navigates to each static view', () => {
		render()

		act(() => {
			button('Review')?.click()
		})
		expect(window.location.pathname).toBe('/review')

		act(() => {
			button('Agents')?.click()
		})
		expect(window.location.pathname).toBe('/')
	})
})
