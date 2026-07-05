/**
 * Shared v2 atoms — the smallest design-system pieces (status dots, tags,
 * diff stats, panels). Styling lives in src/app/styles/components.css.
 */
import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { DISPLAY_STATUS_LABEL } from '@/features/sessions/displayStatus'

import { IconChevron } from './icons'

/** Which edge a dock folds toward — orients the chevron and the fold band. */
export type DockSide = 'left' | 'right'

/** The status flavors a dot can show (see .sdot-* in components.css). */
export type SDotKind = 'run' | 'idle' | 'input' | 'rev' | 'done'

type SDotProps = {
	s: SDotKind
}

export const SDot = ({ s }: SDotProps): React.JSX.Element => (
	<span className={`sdot sdot-${s}`} />
)

const TAG_CLASS: Readonly<Record<SessionDisplayStatus, string>> = {
	running: 'tag tag-run',
	idle: 'tag tag-idle',
	needInput: 'tag tag-input',
}

type StatusTagProps = {
	status: SessionDisplayStatus
}

export const StatusTag = ({ status }: StatusTagProps): React.JSX.Element => (
	<span className={TAG_CLASS[status]}>{DISPLAY_STATUS_LABEL[status]}</span>
)

type DiffStatProps = {
	add: number
	del: number
	files?: number
}

export const DiffStat = ({
	add,
	del,
	files,
}: DiffStatProps): React.JSX.Element => (
	<span className="stat">
		<span className="add">+{add}</span>
		{del > 0 && ' '}
		{del > 0 && <span className="del">−{del}</span>}
		{files !== undefined && <span> · {files} files</span>}
	</span>
)

// Expanded, the chevron points toward the fold edge (an invitation to fold);
// collapsed, it points back out (an invitation to reopen).
const chevronPointsLeft = (side: DockSide, collapsed: boolean): boolean =>
	(side === 'left') !== collapsed

type CollapseToggleProps = {
	collapsed: boolean
	/** Panel title, spoken in the control's accessible name. */
	label: string
	/** The edge the panel folds toward; defaults to a left-hand dock. */
	side?: DockSide
	onToggle: () => void
}

// The disclosure control every peripheral dock shares: a chevron that folds
// the panel to a thin band and back. The block's collapse state is owned by
// usePanelCollapse; this only renders it and reports the click.
export const CollapseToggle = ({
	collapsed,
	label,
	side = 'left',
	onToggle,
}: CollapseToggleProps): React.JSX.Element => {
	const action = collapsed ? 'Expand' : 'Collapse'
	return (
		<button
			type="button"
			className="panel-collapse"
			aria-expanded={!collapsed}
			aria-label={`${action} ${label}`}
			title={`${action} ${label}`}
			onClick={onToggle}
		>
			<span
				className="panel-chev"
				data-point={
					chevronPointsLeft(side, collapsed) ? 'left' : 'right'
				}
				aria-hidden="true"
			>
				<IconChevron />
			</span>
		</button>
	)
}

type CollapsedRailProps = {
	title: string
	side: DockSide
	collapsed: boolean
	onExpand: () => void
	/** Compact summary (dots, counts, a mini bar) shown along the folded band. */
	children: React.ReactNode
}

// The folded band: the whole strip is the re-open control, and it carries a
// compact summary so a collapsed dock still tells you what it holds. It sits
// out of the tab order (and the a11y tree) while the dock is expanded.
export const CollapsedRail = ({
	title,
	side,
	collapsed,
	onExpand,
	children,
}: CollapsedRailProps): React.JSX.Element => (
	<button
		type="button"
		className="panel-fold"
		aria-label={`Expand ${title}`}
		title={`Expand ${title}`}
		aria-hidden={!collapsed}
		inert={!collapsed}
		onClick={onExpand}
	>
		<span
			className="panel-fold__chev"
			data-point={side === 'left' ? 'right' : 'left'}
			aria-hidden="true"
		>
			<IconChevron />
		</span>
		<span className="panel-fold__meta" aria-hidden="true">
			{children}
		</span>
		<span className="panel-fold__title" aria-hidden="true">
			{title}
		</span>
	</button>
)

type DockShellProps = {
	title: string
	side: DockSide
	collapsed: boolean
	onExpand: () => void
	/** Compact summary shown along the folded band. */
	fold: React.ReactNode
	/** The dock's full content (its head and body) shown while expanded. */
	children: React.ReactNode
}

// The inside of a collapsible dock: the full content in a band-clipping wrapper
// plus the folded summary rail. The owner still renders the outer .panel
// element (section/aside/nav) with its own aria-label and data-collapsed, so
// only this two-layer body is shared. Expanded content is inert when folded.
export const DockShell = ({
	title,
	side,
	collapsed,
	onExpand,
	fold,
	children,
}: DockShellProps): React.JSX.Element => (
	<>
		<div className="panel-main" inert={collapsed}>
			{children}
		</div>
		<CollapsedRail
			title={title}
			side={side}
			collapsed={collapsed}
			onExpand={onExpand}
		>
			{fold}
		</CollapsedRail>
	</>
)

type PanelProps = {
	className?: string
	style?: React.CSSProperties
	/** Managed by the owner when the panel is a collapsible dock; drives the
	 *  thin-band styling via data-collapsed. Left off for static panels. */
	collapsed?: boolean
	children: React.ReactNode
}

export const Panel = ({
	className,
	style,
	collapsed,
	children,
}: PanelProps): React.JSX.Element => (
	<section
		className={className === undefined ? 'panel' : `panel ${className}`}
		style={style}
		data-collapsed={collapsed === undefined ? undefined : String(collapsed)}
	>
		{children}
	</section>
)

type PanelHeadProps = {
	title: string
	count?: number | string
	/** Present together to make the panel a collapsible dock; the chevron sits
	 *  at the head's trailing edge and folds the block to a thin band. */
	collapsed?: boolean
	/** The edge the dock folds toward; orients the head's chevron. */
	collapseSide?: DockSide
	onToggleCollapse?: () => void
	children?: React.ReactNode
}

// The grip is the design's modularity affordance — six dots revealed on panel
// hover. Decorative for now (no drag behavior), hence aria-hidden.
export const PanelHead = ({
	title,
	count,
	collapsed,
	collapseSide,
	onToggleCollapse,
	children,
}: PanelHeadProps): React.JSX.Element => (
	<header className="panel-head">
		<span
			className="grip"
			title="Drag to rearrange module"
			aria-hidden="true"
		>
			<i />
			<i />
			<i />
			<i />
			<i />
			<i />
		</span>
		<h3>{title}</h3>
		{count !== undefined && <span className="ph-count">{count}</span>}
		<span className="mz-spacer" />
		{children}
		{onToggleCollapse !== undefined && (
			<CollapseToggle
				collapsed={collapsed ?? false}
				label={title}
				side={collapseSide}
				onToggle={onToggleCollapse}
			/>
		)}
	</header>
)
