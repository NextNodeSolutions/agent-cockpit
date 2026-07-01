/**
 * Shared v2 atoms — the smallest design-system pieces (status dots, tags,
 * diff stats, panels). Styling lives in src/app/styles/components.css.
 */
import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { DISPLAY_STATUS_LABEL } from '@/features/sessions/displayStatus'

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

type CollapseToggleProps = {
	collapsed: boolean
	/** Panel title, spoken in the control's accessible name. */
	label: string
	onToggle: () => void
}

// The disclosure control every peripheral dock shares: a chevron that folds
// the panel to a thin band and back. The block's collapse state is owned by
// usePanelCollapse; this only renders it and reports the click.
export const CollapseToggle = ({
	collapsed,
	label,
	onToggle,
}: CollapseToggleProps): React.JSX.Element => (
	<button
		type="button"
		className="panel-collapse"
		aria-expanded={!collapsed}
		aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
		onClick={onToggle}
	>
		<span
			className="panel-chev"
			data-collapsed={collapsed ? 'true' : 'false'}
			aria-hidden="true"
		>
			▾
		</span>
	</button>
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
	onToggleCollapse?: () => void
	children?: React.ReactNode
}

// The grip is the design's modularity affordance — six dots revealed on panel
// hover. Decorative for now (no drag behavior), hence aria-hidden.
export const PanelHead = ({
	title,
	count,
	collapsed,
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
				onToggle={onToggleCollapse}
			/>
		)}
	</header>
)
