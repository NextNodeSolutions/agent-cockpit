import { pushToast } from '@/shared/toasts'
import { Panel, PanelHead } from '@/shared/ui/atoms'
import { IconPlus } from '@/shared/ui/icons'
import { useNow } from '@/shared/useNow'
import { usePanelCollapse } from '@/shared/usePanelCollapse'

import { usePlans } from './plans'
import { PlansMenu } from './PlansMenu'
import { PlanView } from './PlanView'

const AGE_REFRESH_MS = 30_000

const requestNewInterview = (): void => {
	// TODO: no create_interview command; interviews are produced by the agent workflow (docs/interviews/<slug>/)
	pushToast('New interview — Claude asks, you answer, a plan comes out')
}

type Props = {
	activeProjectPath: string | null
}

/**
 * The Plans screen: the repo's interviews and plans on the left, the
 * selected document on the right. Selection is the URL — deep links and the
 * command palette land here with a document already open.
 */
export const PlansView = ({ activeProjectPath }: Props): React.JSX.Element => {
	const plansState = usePlans(activeProjectPath)
	const nowMs = useNow(AGE_REFRESH_MS)
	const { collapsed, toggle } = usePanelCollapse('plans.list')
	return (
		<section className="pl-wrap stagger" aria-label="Plans">
			<Panel className="pl-list-panel" collapsed={collapsed}>
				<PanelHead
					title="Plans & interviews"
					collapsed={collapsed}
					onToggleCollapse={toggle}
				>
					<button
						type="button"
						className="mz-iconbtn"
						aria-label="New interview"
						onClick={requestNewInterview}
					>
						<IconPlus />
					</button>
				</PanelHead>
				{!collapsed && <PlansMenu state={plansState} nowMs={nowMs} />}
			</Panel>
			<Panel className="pl-doc-panel">
				<PlanView
					plans={plansState.status === 'ready' ? plansState.data : []}
					repoPath={activeProjectPath}
					nowMs={nowMs}
				/>
			</Panel>
		</section>
	)
}
