import { useAtomValue } from 'jotai'

import { CollapseToggle, DiffStat } from '@/shared/ui/atoms'
import { usePanelCollapse } from '@/shared/usePanelCollapse'

import type { ReviewFile } from './reviewFiles'
import { CHANGE_BADGE } from './reviewFiles'
import { ViewedCheck } from './ViewedCheck'
import { reviewProgress, viewedFilesAtom } from './viewedFiles'

const fileName = (path: string): string => path.split('/').pop() ?? path

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
			{!collapsed && (
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
			)}
		</nav>
	)
}
