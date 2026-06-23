import { useCockpitTargetHref } from '@/features/sessions/cockpitTarget'

import { navigate, usePathname } from './router'
import { shellViews } from './shellViews'

export const Rail = (): React.JSX.Element => {
	const pathname = usePathname()
	const cockpitHref = useCockpitTargetHref()

	return (
		<nav className="mz-rail" aria-label="Views">
			{shellViews(cockpitHref).map(view => (
				<button
					key={view.id}
					type="button"
					className="mz-railbtn"
					data-on={view.isActive(pathname) ? 'true' : 'false'}
					aria-label={view.label}
					onClick={() => navigate(view.href)}
				>
					{view.icon}
					<span className="rl">{view.label}</span>
				</button>
			))}
		</nav>
	)
}
