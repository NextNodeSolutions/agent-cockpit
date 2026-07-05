import { useEffect, useRef } from 'react'

type PaletteKeyboard = {
	open: boolean
	/** Dismiss the palette (Escape or the backdrop click). */
	close: () => void
	/** Tab is trapped: focus returns to the search input. */
	focusInput: () => void
	/** Arrow keys move the highlight by ±1. */
	moveSelection: (step: number) => void
	/** Enter runs the highlighted item. */
	runSelected: () => void
}

/**
 * The palette's keyboard routing, owned at the window's capture phase so the
 * terminal's own key router never sees a handled chord while the dialog is up.
 * The listener binds once; it delegates to the latest deps through a ref so it
 * isn't re-bound on every render. The caller owns state and rendering.
 *
 * TODO(cmdk): the ⌘K toggle chord is deliberately gone — it shadowed the
 * terminal's own ⌘K (clear screen). The palette opens from the top bar's Jump
 * button (`openPalette` in palette.ts) until a non-conflicting chord is picked.
 */
export const usePaletteKeyboard = (deps: PaletteKeyboard): void => {
	const depsRef = useRef(deps)
	depsRef.current = deps

	useEffect(() => {
		const onKeydown = (event: KeyboardEvent): void => {
			const current = depsRef.current
			if (!current.open) return
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				current.close()
				return
			}
			// Trap Tab inside the dialog: the input is its only tabbable element,
			// so keeping focus there is the whole trap.
			if (event.key === 'Tab') {
				event.preventDefault()
				event.stopPropagation()
				current.focusInput()
				return
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				event.stopPropagation()
				current.moveSelection(event.key === 'ArrowDown' ? 1 : -1)
				return
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				event.stopPropagation()
				current.runSelected()
			}
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, { capture: true })
	}, [])
}
