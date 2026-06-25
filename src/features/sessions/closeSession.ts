import { invoke } from '@tauri-apps/api/core'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import { markIntentionalClose } from './sessionExit'

/**
 * End a session's PTY (Ghostty close_surface). The single seam over the
 * `session_close` command — callers layer their own follow-up (a toast, pruning
 * the split tree) but never re-implement the IPC + error log. Resolves true on
 * success, false on a logged failure.
 */
export const closeSession = async (sessionId: string): Promise<boolean> => {
	// Mark before the IPC: the resulting `agent:end` (a killed child reports a
	// non-zero, signal-based code) must read as an expected stop, not a crash.
	markIntentionalClose(sessionId)
	try {
		await invoke('session_close', { sessionId })
		return true
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`closeSession: session_close failed: ${message}`, {
			scope: 'sessions',
			details: { stack, sessionId },
		})
		return false
	}
}
