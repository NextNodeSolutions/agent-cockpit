import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	CollapsedRail,
	CollapseToggle,
	DiffStat,
	DockShell,
	Panel,
	PanelHead,
	SDot,
	StatusTag,
} from './atoms'

describe('atoms', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
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

	const render = (element: React.JSX.Element): void => {
		act(() => {
			root.render(element)
		})
	}

	describe('SDot', () => {
		it('renders the status as a dot variant class', () => {
			render(<SDot s="run" />)

			expect(container.querySelector('span.sdot.sdot-run')).not.toBeNull()
		})

		it('covers the review variant', () => {
			render(<SDot s="rev" />)

			expect(container.querySelector('span.sdot.sdot-rev')).not.toBeNull()
		})
	})

	describe('StatusTag', () => {
		it('labels a running session with the run variant', () => {
			render(<StatusTag status="running" />)

			const tag = container.querySelector('.tag.tag-run')
			expect(tag?.textContent).toBe('running')
		})

		it('labels an idle session with the idle variant', () => {
			render(<StatusTag status="idle" />)

			const tag = container.querySelector('.tag.tag-idle')
			expect(tag?.textContent).toBe('idle')
		})

		it('labels a blocked session as needing input', () => {
			render(<StatusTag status="needInput" />)

			const tag = container.querySelector('.tag.tag-input')
			expect(tag?.textContent).toBe('needs input')
		})
	})

	describe('DiffStat', () => {
		it('shows additions, deletions and the file count', () => {
			render(<DiffStat add={12} del={3} files={4} />)

			const stat = container.querySelector('.stat')
			expect(stat?.textContent).toBe('+12 −3 · 4 files')
			expect(stat?.querySelector('.add')?.textContent).toBe('+12')
			expect(stat?.querySelector('.del')?.textContent).toBe('−3')
		})

		it('hides deletions at zero and files when not provided', () => {
			render(<DiffStat add={5} del={0} />)

			const stat = container.querySelector('.stat')
			expect(stat?.textContent).toBe('+5')
			expect(stat?.querySelector('.del')).toBeNull()
		})
	})

	describe('Panel', () => {
		it('wraps its children in a panel surface with extra classes', () => {
			render(
				<Panel className="fc-sess">
					<p>body</p>
				</Panel>,
			)

			const panel = container.querySelector('section.panel.fc-sess')
			expect(panel?.textContent).toBe('body')
		})

		it('is a plain panel without a class', () => {
			render(
				<Panel>
					<p>body</p>
				</Panel>,
			)

			const panel = container.querySelector('section')
			expect(panel?.className).toBe('panel')
		})
	})

	describe('PanelHead', () => {
		it('titles the panel and shows the count', () => {
			render(<PanelHead title="Sessions" count={3} />)

			const head = container.querySelector('header.panel-head')
			expect(head?.querySelector('h3')?.textContent).toBe('Sessions')
			expect(head?.querySelector('.ph-count')?.textContent).toBe('3')
		})

		it('omits the count and hosts trailing actions', () => {
			render(
				<PanelHead title="Diffs">
					<button type="button">act</button>
				</PanelHead>,
			)

			const head = container.querySelector('header.panel-head')
			expect(head?.querySelector('.ph-count')).toBeNull()
			expect(head?.querySelector('button')?.textContent).toBe('act')
		})

		it('leads with the modularity grip affordance', () => {
			render(<PanelHead title="Sessions" />)

			const grip = container.querySelector('header.panel-head .grip')
			expect(grip?.getAttribute('title')).toBe('Drag to rearrange module')
			expect(grip?.getAttribute('aria-hidden')).toBe('true')
			expect(grip?.querySelectorAll('i')).toHaveLength(6)
		})

		it('has no collapse control without a toggle handler', () => {
			render(<PanelHead title="Sessions" />)

			expect(container.querySelector('.panel-collapse')).toBeNull()
		})

		it('hosts a collapse control when given a toggle handler', () => {
			render(
				<PanelHead
					title="Sessions"
					collapsed={false}
					onToggleCollapse={() => {}}
				/>,
			)

			const toggle = container.querySelector('.panel-collapse')
			expect(toggle?.getAttribute('aria-expanded')).toBe('true')
			expect(toggle?.getAttribute('aria-label')).toBe('Collapse Sessions')
		})
	})

	describe('CollapseToggle', () => {
		it('reads as expanded when the panel is open', () => {
			render(
				<CollapseToggle
					collapsed={false}
					label="Diffs"
					onToggle={() => {}}
				/>,
			)

			const button = container.querySelector('button.panel-collapse')
			expect(button?.getAttribute('aria-expanded')).toBe('true')
			expect(button?.getAttribute('aria-label')).toBe('Collapse Diffs')
		})

		it('reads as collapsed and offers to expand when folded', () => {
			render(
				<CollapseToggle
					collapsed={true}
					label="Diffs"
					onToggle={() => {}}
				/>,
			)

			const button = container.querySelector('button.panel-collapse')
			expect(button?.getAttribute('aria-expanded')).toBe('false')
			expect(button?.getAttribute('aria-label')).toBe('Expand Diffs')
		})

		it('fires the toggle on click', () => {
			let clicks = 0
			render(
				<CollapseToggle
					collapsed={false}
					label="Diffs"
					onToggle={() => {
						clicks += 1
					}}
				/>,
			)

			const button = container.querySelector<HTMLButtonElement>(
				'button.panel-collapse',
			)
			act(() => {
				button?.click()
			})

			expect(clicks).toBe(1)
		})
	})

	describe('CollapsedRail', () => {
		it('re-opens the dock when the whole band is clicked', () => {
			let expands = 0
			render(
				<CollapsedRail
					title="Sessions"
					side="left"
					collapsed={true}
					onExpand={() => {
						expands += 1
					}}
				>
					<span className="panel-fold__count">3</span>
				</CollapsedRail>,
			)

			const band =
				container.querySelector<HTMLButtonElement>('button.panel-fold')
			expect(band?.getAttribute('aria-label')).toBe('Expand Sessions')
			expect(band?.querySelector('.panel-fold__count')?.textContent).toBe(
				'3',
			)
			act(() => {
				band?.click()
			})
			expect(expands).toBe(1)
		})

		it('leaves the tab order and a11y tree while the dock is open', () => {
			render(
				<CollapsedRail
					title="Diffs"
					side="right"
					collapsed={false}
					onExpand={() => {}}
				>
					<span className="panel-fold__count">0</span>
				</CollapsedRail>,
			)

			const band = container.querySelector('button.panel-fold')
			expect(band?.getAttribute('aria-hidden')).toBe('true')
			expect(band?.hasAttribute('inert')).toBe(true)
		})

		it('points its chevron out toward the fold edge', () => {
			render(
				<CollapsedRail
					title="Diffs"
					side="right"
					collapsed={true}
					onExpand={() => {}}
				>
					<span />
				</CollapsedRail>,
			)

			expect(
				container
					.querySelector('.panel-fold__chev')
					?.getAttribute('data-point'),
			).toBe('left')
		})
	})

	describe('DockShell', () => {
		it('wraps the content and hosts the folded summary', () => {
			render(
				<DockShell
					title="Sessions"
					side="left"
					collapsed={false}
					onExpand={() => {}}
					fold={<span className="panel-fold__count">2</span>}
				>
					<p className="body">rows</p>
				</DockShell>,
			)

			const main = container.querySelector('.panel-main')
			expect(main?.querySelector('.body')?.textContent).toBe('rows')
			expect(main?.hasAttribute('inert')).toBe(false)
			expect(
				container.querySelector('.panel-fold .panel-fold__count')
					?.textContent,
			).toBe('2')
		})

		it('makes the open content inert once folded', () => {
			render(
				<DockShell
					title="Sessions"
					side="left"
					collapsed={true}
					onExpand={() => {}}
					fold={<span />}
				>
					<p className="body">rows</p>
				</DockShell>,
			)

			expect(
				container.querySelector('.panel-main')?.hasAttribute('inert'),
			).toBe(true)
		})
	})

	describe('Panel collapse state', () => {
		it('marks the surface collapsed when folded', () => {
			render(
				<Panel className="fc-sess" collapsed={true}>
					<p>body</p>
				</Panel>,
			)

			const panel = container.querySelector('section.panel.fc-sess')
			expect(panel?.getAttribute('data-collapsed')).toBe('true')
		})

		it('leaves the attribute off when collapse is not managed', () => {
			render(
				<Panel className="fc-sess">
					<p>body</p>
				</Panel>,
			)

			const panel = container.querySelector('section.panel.fc-sess')
			expect(panel?.hasAttribute('data-collapsed')).toBe(false)
		})
	})
})
