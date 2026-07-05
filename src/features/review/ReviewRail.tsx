import { CollapseToggle, DockShell, SDot } from '@/shared/ui/atoms'
import { usePanelCollapse } from '@/shared/usePanelCollapse'

import type { ReviewMessage, ReviewRef } from './agentConversation'
import { reviewRefLabel, useConversation } from './agentConversation'
import type { DiffTotals } from './reviewFiles'
import { useReviewCompose } from './useReviewCompose'

type FoldProps = {
	thread: ReadonlyArray<ReviewMessage>
	agentRunning: boolean
}

// The folded band's summary: the remark tally and a live dot when an agent is
// running, so the rail signals activity even while folded.
const RailFold = ({ thread, agentRunning }: FoldProps): React.JSX.Element => (
	<>
		{thread.length > 0 && (
			<span className="panel-fold__count" data-accent={true}>
				{thread.length}
			</span>
		)}
		{agentRunning && <SDot s="run" />}
	</>
)

type Props = {
	repoPath: string | null
	totals: DiffTotals
	/** Where a sent remark anchors: the selected file, or a clicked line. */
	context: ReviewRef | null
	composeRef: React.Ref<HTMLTextAreaElement>
}

export const ReviewRail = ({
	repoPath,
	totals,
	context,
	composeRef,
}: Props): React.JSX.Element => {
	const thread = useConversation(repoPath)
	const { collapsed, toggle } = usePanelCollapse('review.rail')
	const { draft, setDraft, sending, target, tailLine, submit } =
		useReviewCompose(repoPath, context)

	return (
		<aside
			className="panel review-rail"
			aria-label="Review conversation"
			data-collapsed={String(collapsed)}
		>
			<DockShell
				title="Review conversation"
				side="right"
				collapsed={collapsed}
				onExpand={toggle}
				fold={
					<RailFold thread={thread} agentRunning={target !== null} />
				}
			>
				<div className="review-rail__band">
					<CollapseToggle
						collapsed={collapsed}
						label="Review conversation"
						side="right"
						onToggle={toggle}
					/>
				</div>
				<div className="review-rail__summary">
					<h4>WHAT THE AGENT DID</h4>
					{/* TODO: agent-produced run summary — no backend command exposes one yet. */}
					<p>
						{totals.files} files ·{' '}
						<span className="add">+{totals.additions}</span>{' '}
						<span className="del">−{totals.deletions}</span> in the
						working tree
					</p>
					{tailLine !== undefined && (
						<p className="review-rail__tail">{tailLine}</p>
					)}
					{/* TODO: tests status badge — needs a backend command reporting
				    the branch's test run (.test-badge CSS is ready). */}
				</div>
				<div className="review-rail__thread" aria-label="Conversation">
					{/* TODO: agent reply messages in thread (terminal output is not
				    parsed into conversation turns) — every bubble is ours. */}
					{thread.length === 0 ? (
						<p className="review-rail__hint">
							Review is a conversation — ask the agent to iterate.
						</p>
					) : (
						<ul>
							{thread.map(message => (
								<li
									key={message.id}
									className="review-rail__msg"
									data-me="true"
								>
									<span className="who">
										You
										{message.ref !== null && (
											<>
												{' · '}
												<span className="ref">
													{reviewRefLabel(
														message.ref,
													)}
												</span>
											</>
										)}
									</span>
									<span className="txt">{message.text}</span>
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="review-rail__compose">
					{target === null && (
						<p className="review-rail__hint">
							No running agent in this repo — launch one to
							iterate.
						</p>
					)}
					<textarea
						ref={composeRef}
						value={draft}
						disabled={target === null || sending}
						placeholder="Ask the agent for a change… (e.g. handle the null case too)"
						onChange={event => setDraft(event.target.value)}
						onKeyDown={event => {
							if (
								event.key === 'Enter' &&
								(event.metaKey || event.ctrlKey)
							) {
								event.preventDefault()
								submit()
							}
						}}
					/>
					<div className="review-rail__compose-row">
						{context !== null && (
							<span className="review-rail__ctx">
								↳ {reviewRefLabel(context)}
							</span>
						)}
						<button
							type="button"
							className="btn btn-sm btn-primary review-rail__send"
							disabled={
								target === null ||
								sending ||
								draft.trim() === ''
							}
							onClick={submit}
						>
							Send to agent ↑
						</button>
					</div>
				</div>
			</DockShell>
		</aside>
	)
}
