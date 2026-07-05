import { useAtomValue } from 'jotai'

import { CollapseToggle, DiffStat, DockShell } from '@/shared/ui/atoms'
import { usePanelCollapse } from '@/shared/usePanelCollapse'

import type { ReviewFile } from './reviewFiles'
import { CHANGE_BADGE } from './reviewFiles'
import { ViewedCheck } from './ViewedCheck'
import type { ReviewProgress } from './viewedFiles'
import { reviewProgress, viewedFilesAtom } from './viewedFiles'

const fileName = (path: string): string => path.split('/').pop() ?? path

type FoldProps = {
	progress: ReviewProgress
}

// The folded band's summary: viewed-vs-total over a vertical progress bar, so
// review progress stays visible without unfolding the tree.
const TreeFold = ({ progress }: FoldProps): React.JSX.Element => (
	<>
		<span className="panel-fold__count" data-accent={progress.total > 0}>
			{progress.viewed}/{progress.total}
		</span>
		<span
			className="panel-fold__vbar"
			role="progressbar"
			aria-valuenow={progress.percent}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<i style={{ height: `${progress.percent}%` }} />
		</span>
	</>
)

type Props = {
	files: ReadonlyArray<ReviewFile>
	selectedPath: string | null
	onSelect: (path: string) => void
}

export const ReviewTree = ({
	files,
	selectedPath,
	onSelect,
}: Props): React.JSX.Element => {
	const viewed = useAtomValue(viewedFilesAtom)
	const { collapsed, toggle } = usePanelCollapse('review.tree')
	const progress = reviewProgress(
		viewed,
		files.map(file => file.path),
	)

	return (
		<nav
			className="panel review-tree"
			aria-label="Changed files"
			data-collapsed={String(collapsed)}
		>
			<DockShell
				title="Changed files"
				side="left"
				collapsed={collapsed}
				onExpand={toggle}
				fold={<TreeFold progress={progress} />}
			>
				<div className="review-tree__progress">
					<span>
						{progress.viewed} / {progress.total} viewed
					</span>
					<span
						className="review-tree__bar"
						role="progressbar"
						aria-valuenow={progress.percent}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<i style={{ width: `${progress.percent}%` }} />
					</span>
					<CollapseToggle
						collapsed={collapsed}
						label="Changed files"
						onToggle={toggle}
					/>
				</div>
				<ul className="review-tree__list">
					{files.map(file => (
						<li key={file.path} className="review-tree__row">
							<button
								type="button"
								className="review-tree__file"
								data-viewed={Boolean(viewed[file.path])}
								aria-current={
									file.path === selectedPath
										? 'true'
										: undefined
								}
								title={file.path}
								onClick={() => onSelect(file.path)}
							>
								<span
									className="review-tree__badge"
									data-change={file.change}
								>
									{CHANGE_BADGE[file.change]}
								</span>
								<span className="review-tree__name">
									{fileName(file.path)}
								</span>
								<DiffStat
									add={file.additions}
									del={file.deletions}
								/>
							</button>
							<ViewedCheck path={file.path} />
						</li>
					))}
				</ul>
			</DockShell>
		</nav>
	)
}
