import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { usePanelCollapse } from './usePanelCollapse'

const PANEL_ID = 'cockpit.sessions'

let collapsed = false
let toggle = (): void => {}

const Probe = (): React.JSX.Element => {
	const panel = usePanelCollapse(PANEL_ID)
	collapsed = panel.collapsed
	toggle = panel.toggle
	return <output>{String(panel.collapsed)}</output>
}

describe('usePanelCollapse', () => {
	let container: HTMLDivElement
	let root: Root

	const mount = (): void => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		act(() => {
			root.render(<Probe />)
		})
	}

	beforeEach(() => {
		localStorage.clear()
		collapsed = false
		mount()
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
	})

	it('starts expanded when nothing is stored', () => {
		expect(collapsed).toBe(false)
	})

	it('collapses when toggled', () => {
		act(() => {
			toggle()
		})

		expect(collapsed).toBe(true)
	})

	it('expands again on a second toggle', () => {
		act(() => {
			toggle()
		})
		act(() => {
			toggle()
		})

		expect(collapsed).toBe(false)
	})

	it('restores the collapsed state on a fresh mount', () => {
		act(() => {
			toggle()
		})
		act(() => {
			root.unmount()
		})

		mount()

		expect(collapsed).toBe(true)
	})
})
