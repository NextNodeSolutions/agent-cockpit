import { useState } from 'react'

/**
 * Per-block collapse state for the peripheral panels, persisted across app
 * restarts so a folded dock stays folded. Keyed by a stable panel id
 * ('cockpit.sessions', 'review.tree', …) — one entry per block, never shared.
 */
export type PanelCollapse = {
	collapsed: boolean
	toggle: () => void
}

const STORAGE_PREFIX = 'mizraj.panel-collapse.'

const storageKey = (id: string): string => STORAGE_PREFIX + id

const readStored = (id: string): boolean => {
	try {
		return localStorage.getItem(storageKey(id)) === 'true'
	} catch {
		// Storage can be unavailable in a locked-down webview; default to open.
		return false
	}
}

const writeStored = (id: string, collapsed: boolean): void => {
	try {
		localStorage.setItem(storageKey(id), String(collapsed))
	} catch {
		// Persistence is best-effort — the in-memory state still holds this run.
	}
}

export const usePanelCollapse = (id: string): PanelCollapse => {
	const [collapsed, setCollapsed] = useState(() => readStored(id))

	const toggle = (): void => {
		const next = !collapsed
		writeStored(id, next)
		setCollapsed(next)
	}

	return { collapsed, toggle }
}
