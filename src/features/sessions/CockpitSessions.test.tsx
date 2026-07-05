import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.hoisted(() => vi.fn())
const launchSessionMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/agent-run/${sessionId}`,
}))

vi.mock('./launchSession', () => ({
	launchSession: launchSessionMock,
}))

import { CockpitSessions } from './CockpitSessions'
import { sessionsAtom, startSessionAtom } from './sessions'

const store = getDefaultStore()

// A fixed epoch so seed-time startedAt and useNow's initial read share one
// clock — the '0s' age cannot flake across a 1000ms boundary.
const FROZEN_NOW = new Date('2026-06-14T12:00:00.000Z').getTime()

describe('CockpitSessions', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		localStorage.clear()
		store.set(sessionsAtom, {})
		navigateMock.mockReset()
		launchSessionMock.mockReset()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
		// Restore the real clock even if a frozen-time test threw before its own
		// teardown, so fake timers never leak into the next test.
		vi.useRealTimers()
	})

	const seed = (id: string, repoPath = '/repo/mizraj'): void => {
		store.set(startSessionAtom, {
			id,
			binary: 'claude',
			repoPath,
		})
	}

	const render = (
		activeSessionId: string,
		activeProjectPath: string | null = null,
	): void => {
		act(() => {
			root.render(
				<CockpitSessions
					activeSessionId={activeSessionId}
					activeProjectPath={activeProjectPath}
				/>,
			)
		})
	}

	const newSessionButton = (): HTMLButtonElement | null =>
		container.querySelector<HTMLButtonElement>(
			'button[aria-label="New session"]',
		)

	it('lists every session as a flat row, no group headings', () => {
		seed('run-1')
		seed('run-2')
		render('run-1')

		expect(container.querySelectorAll('.lgroup')).toHaveLength(0)
		expect(container.querySelectorAll('.lrow')).toHaveLength(2)
	})

	it('shows the panel head with the total session count', () => {
		seed('run-1')
		seed('run-2')
		seed('run-3')
		render('run-1')

		expect(container.querySelector('.panel-head h3')?.textContent).toBe(
			'Sessions',
		)
		expect(
			container.querySelector('.panel-head .ph-count')?.textContent,
		).toBe('3')
	})

	it('marks the open session as current', () => {
		seed('run-1')
		seed('run-2')
		render('run-2')

		const current = container.querySelector('[aria-current="page"]')
		expect(current?.textContent).toContain('claude')
		expect(current?.getAttribute('href')).toBe('/agent-run/run-2')
		expect(current?.getAttribute('data-on')).toBe('true')
	})

	it('navigates to a session on click', () => {
		seed('run-1')
		seed('run-2')
		render('run-1')

		const links = container.querySelectorAll<HTMLElement>('.lrow')
		act(() => {
			links[1]?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith('/agent-run/run-2')
	})

	it('lists only sessions of the followed repo', () => {
		// Freeze the clock so startedAt and useNow's initial read share it and
		// the age cannot tick to 1s on a millisecond boundary.
		vi.useFakeTimers()
		vi.setSystemTime(FROZEN_NOW)
		seed('mizraj-1')
		seed('scribe-1', '/repo/scribe')
		render('mizraj-1', '/repo/mizraj')

		expect(container.querySelectorAll('.lrow')).toHaveLength(1)
		expect(
			container.querySelector('.panel-head .ph-count')?.textContent,
		).toBe('1')
		const metas = Array.from(container.querySelectorAll('.lr-b')).map(
			meta => meta.textContent,
		)
		// Scoped to one repo, the row drops the repo chip — it is redundant.
		expect(metas).toEqual(['0s'])
	})

	it('shows sessions from every repo when no repo is followed', () => {
		seed('mizraj-1')
		seed('scribe-1', '/repo/scribe')
		render('mizraj-1', null)

		expect(container.querySelectorAll('.lrow')).toHaveLength(2)
	})

	it('metas an unscoped row with repo · age', () => {
		vi.useFakeTimers()
		vi.setSystemTime(FROZEN_NOW)
		seed('run-1')
		render('run-1', null)

		const metas = Array.from(container.querySelectorAll('.lrow .lr-b')).map(
			meta => meta.textContent,
		)
		expect(metas).toEqual(['mizraj · 0s'])
	})

	it('points at the top bar Jump button in the panel foot', () => {
		seed('run-1')
		render('run-1')

		const foot = container.querySelector('.fc-sess-foot')
		expect(foot?.textContent).toContain('Jump to…')
	})

	it('hides the new-session button without an active project', () => {
		seed('run-1')
		render('run-1')

		expect(newSessionButton()).toBeNull()
	})

	it('launches a claude session in the active project from the head button', () => {
		launchSessionMock.mockReturnValue(new Promise(() => {}))
		seed('run-1')
		render('run-1', '/repo/mizraj')

		const button = newSessionButton()
		expect(button).not.toBeNull()
		act(() => {
			button?.click()
		})

		expect(launchSessionMock).toHaveBeenCalledExactlyOnceWith({
			binary: 'claude',
			repoPath: '/repo/mizraj',
		})
		expect(newSessionButton()?.disabled).toBe(true)
	})

	it('dots rows with the running status', () => {
		seed('run-1')
		seed('run-2')
		render('run-1')

		const dots = Array.from(container.querySelectorAll('.lrow .sdot')).map(
			dot => dot.className,
		)
		expect(dots).toEqual(['sdot sdot-run', 'sdot sdot-run'])
	})

	const collapseToggle = (): HTMLButtonElement | null =>
		container.querySelector<HTMLButtonElement>('.fc-sess .panel-collapse')

	it('folds the session list to a summary band when the dock is collapsed', () => {
		seed('run-1')
		seed('run-2')
		render('run-1')

		expect(container.querySelectorAll('.lrow')).toHaveLength(2)
		act(() => {
			collapseToggle()?.click()
		})

		// The band replaces the list with a compact summary: the session tally
		// over a dot per running agent.
		const fold = container.querySelector('.fc-sess .panel-fold')
		expect(fold?.querySelector('.panel-fold__count')?.textContent).toBe('2')
		expect(fold?.querySelectorAll('.sdot')).toHaveLength(2)
		expect(collapseToggle()?.getAttribute('aria-expanded')).toBe('false')
	})

	it('marks the sessions panel collapsed for the thin-band styling', () => {
		seed('run-1')
		render('run-1')

		act(() => {
			collapseToggle()?.click()
		})

		expect(
			container.querySelector('.fc-sess')?.getAttribute('data-collapsed'),
		).toBe('true')
	})
})
