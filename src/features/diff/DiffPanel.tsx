import { useMemo, useState } from 'react'

import { navigate, reviewHref } from '@/app/router'
import type { DiffTotals } from '@/features/review/reviewFiles'
import {
	diffTotals,
	reviewFilesFromParsed,
} from '@/features/review/reviewFiles'
import { DockShell, PanelHead } from '@/shared/ui/atoms'
import { usePanelCollapse } from '@/shared/usePanelCollapse'

import { DiffPanelBody } from './DiffPanelBody'
import { DiffPanelFiles } from './DiffPanelFiles'
import { DiffPanelPreview } from './DiffPanelPreview'
import { useDiff } from './useDiff'
import { usePatchFiles } from './usePatchFiles'

type FoldProps = {
	totals: DiffTotals
}

// The folded band's summary: the changed-file tally over its +/− totals.
const DiffsFold = ({ totals }: FoldProps): React.JSX.Element => (
	<>
		<span className="panel-fold__count" data-accent={totals.files > 0}>
			{totals.files}
		</span>
		{(totals.additions > 0 || totals.deletions > 0) && (
			<span className="panel-fold__stat">
				<span className="add">+{totals.additions}</span>{' '}
				<span className="del">−{totals.deletions}</span>
			</span>
		)}
	</>
)

type Props = {
	repoPath: string | null
}

/**
 * The cockpit's diff dock: a preview-only panel over the active project's
 * working-tree patch — per-file rows with +/− stats and a unified preview of
 * the selected file. Full review tooling lives on /review ("Open review ↗"
 * and re-clicking the selected row deep-link there with the file).
 */
export const DiffPanel = ({ repoPath }: Props): React.JSX.Element => {
	const { state } = useDiff(repoPath)
	const patch = state.status === 'ready' ? state.data.patch : null
	const parsedFiles = usePatchFiles(patch)
	const files = useMemo(
		() => reviewFilesFromParsed(parsedFiles),
		[parsedFiles],
	)
	const [selectedPath, setSelectedPath] = useState<string | null>(null)
	const { collapsed, toggle } = usePanelCollapse('cockpit.diffs')

	const totals = diffTotals(files)
	const selected =
		files.find(file => file.path === selectedPath) ?? files[0] ?? null
	// Selection and the FileDiff `key` both index by `FileDiffMetadata.name`,
	// which assumes names are unique within the patch. That holds here: this is
	// always one working-tree patch (`git diff`), where each path appears once.
	// A multi-commit or rename-tracked patch could repeat a name and break the
	// lookup — out of scope for this preview-only dock.
	const selectedMeta =
		parsedFiles.find(file => file.name === selected?.path) ?? null

	// Re-clicking the selected row is the "drill in" gesture: it opens the
	// full review preselected on that file instead of re-selecting.
	const selectRow = (path: string): void => {
		if (path === selected?.path) {
			navigate(reviewHref(path))
			return
		}
		setSelectedPath(path)
	}

	return (
		<aside
			className="panel fc-diffs"
			aria-label="Diffs"
			data-collapsed={String(collapsed)}
		>
			<DockShell
				title="Diffs"
				side="right"
				collapsed={collapsed}
				onExpand={toggle}
				fold={<DiffsFold totals={totals} />}
			>
				<PanelHead
					title="Diffs"
					count={`${files.length} files`}
					collapsed={collapsed}
					collapseSide="right"
					onToggleCollapse={toggle}
				>
					<button
						type="button"
						className="btn btn-sm btn-outline"
						onClick={() => navigate(reviewHref(selected?.path))}
					>
						Open review ↗
					</button>
				</PanelHead>
				<DiffPanelBody state={state}>
					<DiffPanelFiles
						files={files}
						selectedPath={selected?.path ?? null}
						onSelect={selectRow}
					/>
					<div className="fc-dhunk">
						{selectedMeta !== null && (
							<DiffPanelPreview
								key={selectedMeta.name}
								fileDiff={selectedMeta}
							/>
						)}
					</div>
				</DiffPanelBody>
			</DockShell>
		</aside>
	)
}
