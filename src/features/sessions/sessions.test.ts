import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toastsAtom } from '@/shared/toasts'

const listenMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({
	listen: listenMock,
}))

import {
	resetAgentEventsBridgeForTests,
	startAgentEventsBridge,
} from './agentEventsBridge'
import { markIntentionalClose } from './sessionExit'
import {
	AGENT_ACTIVITY_EVENT,
	AGENT_CELLS_EVENT,
	AGENT_END_EVENT,
	AGENT_TITLE_EVENT,
	cellFramesAtom,
	removeSessionAtom,
	sessionActivityAtom,
	sessionsAtom,
	startSessionAtom,
} from './sessions'
import type { SessionEndPayload } from './sessions'
import type { CellFramePayload } from './terminalWire'

const store = getDefaultStore()

describe('sessions atoms', () => {
	beforeEach(() => {
		store.set(sessionsAtom, {})
	})

	it('startSessionAtom registers a fresh session', () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_750_000_000_000)

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})

		expect(store.get(sessionsAtom)['sess-a']).toEqual({
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
			title: null,
			startedAt: 1_750_000_000_000,
		})
		vi.useRealTimers()
	})

	it('removeSessionAtom drops the session and its activity + last frame', () => {
		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(sessionActivityAtom, { 'sess-a': 1 })
		store.set(cellFramesAtom, {
			'sess-a': {
				session_id: 'sess-a',
				cols: 1,
				rows: 1,
				cells: [],
				cursor: null,
				mouse_reporting: false,
				viewport_top: 0,
				history_total: 0,
			},
		})

		store.set(removeSessionAtom, 'sess-a')

		expect(store.get(sessionsAtom)['sess-a']).toBeUndefined()
		expect(store.get(sessionActivityAtom)['sess-a']).toBeUndefined()
		expect(store.get(cellFramesAtom)['sess-a']).toBeUndefined()
	})

	it('subscribers are notified on every atom write', () => {
		const seen: Array<Readonly<Record<string, unknown>>> = []
		const unsubscribe = store.sub(sessionsAtom, () => {
			seen.push(store.get(sessionsAtom))
		})

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(removeSessionAtom, 'sess-a')

		unsubscribe()
		expect(seen).toHaveLength(2)
		expect(seen[0]).not.toBe(seen[1])
	})
})

describe('startAgentEventsBridge', () => {
	const unlistenMock = vi.fn()

	beforeEach(() => {
		resetAgentEventsBridgeForTests()
		store.set(sessionsAtom, {})
		store.set(cellFramesAtom, {})
		store.set(toastsAtom, [])
		listenMock.mockReset()
		unlistenMock.mockReset()
		listenMock.mockResolvedValue(unlistenMock)
	})

	it('subscribes to agent:end, agent:cells, agent:title and agent:activity exactly once each', () => {
		startAgentEventsBridge()
		startAgentEventsBridge()
		startAgentEventsBridge()

		expect(listenMock).toHaveBeenCalledTimes(4)
		expect(listenMock).toHaveBeenNthCalledWith(
			1,
			AGENT_END_EVENT,
			expect.any(Function),
		)
		expect(listenMock).toHaveBeenNthCalledWith(
			2,
			AGENT_CELLS_EVENT,
			expect.any(Function),
		)
		expect(listenMock).toHaveBeenNthCalledWith(
			3,
			AGENT_TITLE_EVENT,
			expect.any(Function),
		)
		expect(listenMock).toHaveBeenNthCalledWith(
			4,
			AGENT_ACTIVITY_EVENT,
			expect.any(Function),
		)
	})

	const getCapturedEndHandler = (): ((event: {
		payload: SessionEndPayload
	}) => void) => {
		const call = listenMock.mock.calls[0]
		if (!call) throw new Error('agent:end listen() was not called')
		const handler = call[1]
		if (typeof handler !== 'function') {
			throw new Error('agent:end listen() handler was not a function')
		}
		return handler
	}

	it('routes agent:end into removeSessionAtom — the session is dropped', () => {
		startAgentEventsBridge()
		const handler = getCapturedEndHandler()

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		handler({ payload: { session_id: 'sess-a', exit_code: 0 } })

		expect(store.get(sessionsAtom)['sess-a']).toBeUndefined()
	})

	it('toasts an unexpected non-zero exit before dropping the session', () => {
		startAgentEventsBridge()
		const handler = getCapturedEndHandler()

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		handler({ payload: { session_id: 'sess-a', exit_code: 137 } })

		const messages = store.get(toastsAtom).map(toast => toast.message)
		expect(messages).toContain('claude exited with code 137')
		expect(store.get(sessionsAtom)['sess-a']).toBeUndefined()
	})

	it('stays silent when the user closed the session on purpose', () => {
		startAgentEventsBridge()
		const handler = getCapturedEndHandler()

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		// closeSession marks the id before the kill; the signal-based exit code
		// that follows must NOT read as a crash.
		markIntentionalClose('sess-a')
		handler({ payload: { session_id: 'sess-a', exit_code: 137 } })

		expect(store.get(toastsAtom)).toEqual([])
		expect(store.get(sessionsAtom)['sess-a']).toBeUndefined()
	})

	const getCapturedCellsHandler = (): ((event: {
		payload: CellFramePayload
	}) => void) => {
		const call = listenMock.mock.calls[1]
		if (!call) throw new Error('agent:cells listen() was not called')
		const handler = call[1]
		if (typeof handler !== 'function') {
			throw new Error('agent:cells listen() handler was not a function')
		}
		return handler
	}

	it('routes agent:cells into cellFramesAtom for a known session', () => {
		startAgentEventsBridge()
		const handler = getCapturedCellsHandler()

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		const frame: CellFramePayload = {
			session_id: 'sess-a',
			cols: 2,
			rows: 1,
			cells: [],
			cursor: null,
			mouse_reporting: false,
			viewport_top: 0,
			history_total: 0,
		}
		handler({ payload: frame })

		expect(store.get(cellFramesAtom)['sess-a']).toBe(frame)
	})

	it('drops agent:cells for an unknown session', () => {
		startAgentEventsBridge()
		const handler = getCapturedCellsHandler()

		const before = store.get(cellFramesAtom)
		handler({
			payload: {
				session_id: 'ghost',
				cols: 1,
				rows: 1,
				cells: [],
				cursor: null,
				mouse_reporting: false,
				viewport_top: 0,
				history_total: 0,
			},
		})

		expect(store.get(cellFramesAtom)).toBe(before)
	})
})
