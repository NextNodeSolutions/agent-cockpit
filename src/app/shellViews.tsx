import { IconDiff, IconGrid, IconTerm } from '@/shared/ui/icons'

import {
	matchAgentRunIndexRoute,
	matchAgentRunRoute,
	matchMissionControlRoute,
	matchReviewRoute,
	missionControlHref,
	reviewHref,
} from './router'

// 'pipeline' (Board) and 'plans' stay in the union although no rail entry
// produces them today: the views are only *parked* (see the TODO below), so
// keeping the ids spares the type a churn when they return.
export type ShellViewId =
	| 'mission'
	| 'cockpit'
	| 'pipeline'
	| 'plans'
	| 'review'

export type ShellView = {
	id: ShellViewId
	label: string
	icon: React.JSX.Element
	href: string
	isActive: (pathname: string) => boolean
}

/**
 * The ordered shell views — the single source behind both the rail buttons and
 * the ⌘1..N chords, so the chord index and the rail order can never drift (the
 * ARCH5 cross-cutting namespace). The cockpit href follows the active session,
 * so the list is built per render from it. The tasks route is palette-only and
 * deliberately absent (no rail entry, no chord).
 *
 * TODO(parked-views): Board (`pipeline`) and Plans are intentionally hidden
 * from the rail and the ⌘1..N chords. They are NOT dead code — both features
 * stay fully wired and reachable; only the two rail entries below were removed:
 *   - Board: route `/pipeline` (MainContent ROUTES) + module `features/pipeline/`.
 *   - Plans: routes `/plans` and `/plans/:kind/:slug` (Plans is MainContent's
 *     FALLBACK_ROUTE) + module `features/plans/`, also surfaced in the palette.
 *
 * To bring either back into the rail (and restore its ⌘ chord), re-add its
 * imports and splice its entry at the position giving the chord index you want
 * (original order was Board ⌘3, Plans ⌘4, Review ⌘5):
 *
 *   import { IconBoard, IconDoc } from '@/shared/ui/icons'
 *   import {
 *     matchPipelineRoute, pipelineHref,                      // Board
 *     matchPlanRoute, matchPlansIndexRoute, plansIndexHref,  // Plans
 *   } from './router'
 *
 *   // Board — slot after 'cockpit':
 *   { id: 'pipeline', label: 'Board', icon: <IconBoard />,
 *     href: pipelineHref(), isActive: matchPipelineRoute },
 *   // Plans — between Board and Review:
 *   { id: 'plans', label: 'Plans', icon: <IconDoc />,
 *     href: plansIndexHref(),
 *     isActive: pathname =>
 *       matchPlansIndexRoute(pathname) || matchPlanRoute(pathname) !== null },
 *
 * Then restore their cases in Rail.test.tsx and useShellShortcuts.test.tsx
 * (search "parked-views" there for the exact assertions that were dropped).
 */
export const shellViews = (cockpitHref: string): ReadonlyArray<ShellView> => [
	{
		id: 'mission',
		label: 'Agents',
		icon: <IconGrid />,
		href: missionControlHref(),
		isActive: matchMissionControlRoute,
	},
	{
		id: 'cockpit',
		label: 'Cockpit',
		icon: <IconTerm />,
		href: cockpitHref,
		isActive: pathname =>
			matchAgentRunRoute(pathname) !== null ||
			matchAgentRunIndexRoute(pathname),
	},
	{
		id: 'review',
		label: 'Review',
		icon: <IconDiff />,
		href: reviewHref(),
		isActive: matchReviewRoute,
	},
]
