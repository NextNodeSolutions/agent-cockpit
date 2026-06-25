import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	sessionActivityAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'

import { StatusCluster } from './StatusCluster'

const store = getDefaultStore()

const startSession = (id: string): void => {
	store.set(startSessionAtom, { id, binary: 'claude', repoPath: '/repo' })
}

describe('StatusCluster', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(sessionActivityAtom, {})
		window.history.pushState({}, '', '/plans')
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
			root.render(<StatusCluster />)
		})
	}

	it('counts running and idle sessions separately', () => {
		startSession('run-1')
		startSession('run-2')
		startSession('idle-1')
		// A stale activity timestamp reads as idle against the live clock; the
		// two sessions with no activity stay optimistically running.
		store.set(sessionActivityAtom, { 'idle-1': 1 })
		render()

		const [running, idle] = Array.from(
			container.querySelectorAll('.mz-status .mz-statbtn'),
		)
		expect(running?.textContent).toContain('2')
		expect(running?.textContent).toContain('running')
		expect(idle?.textContent).toContain('1')
		expect(idle?.textContent).toContain('idle')
	})

	it('jumps to mission control filtered on running agents', () => {
		render()

		act(() => {
			container
				.querySelector<HTMLElement>('[title="Jump to running agents"]')
				?.click()
		})

		expect(window.location.pathname).toBe('/')
		expect(window.location.search).toBe('?filter=running')
	})

	it('jumps to mission control filtered on idle agents', () => {
		render()

		act(() => {
			container
				.querySelector<HTMLElement>('[title="Jump to idle agents"]')
				?.click()
		})

		expect(window.location.pathname).toBe('/')
		expect(window.location.search).toBe('?filter=idle')
	})
})
