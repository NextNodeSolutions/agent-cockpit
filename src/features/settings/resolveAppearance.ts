import type { Appearance } from '@/features/sessions/ghosttyConfig'

import type { Theme } from './settings'

/**
 * The light/dark axis a `Theme` resolves to: an explicit `light`/`dark` setting
 * wins outright; `system` follows the OS preference. The single source of truth
 * shared by `useAppearance` (live) and `currentAppearance` (one-shot, non-React).
 */
export const resolveAppearance = (
	theme: Theme,
	systemPrefersDark: boolean,
): Appearance => {
	if (theme === 'light') return 'light'
	if (theme === 'dark') return 'dark'
	return systemPrefersDark ? 'dark' : 'light'
}
