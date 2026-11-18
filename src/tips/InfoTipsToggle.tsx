import { useAtom } from "jotai"

import { INFO_TIPS_TOGGLE_ATTR, infoTipsAtom } from "./infoTips"

/** Header toggle (speech bubble with three dots): while on, every helper
 *  bubble for the current view shows at once (TipBoard). On every page;
 *  hidden on phones, where the header has to stay one line and a board
 *  of 330px bubbles has no room. */
export const InfoTipsToggle = () => {
	const [active, setActive] = useAtom(infoTipsAtom)
	return (
		<button
			type="button"
			onClick={() => setActive(!active)}
			title="Info tips"
			data-vc-title-instant=""
			aria-label="Info tips"
			aria-pressed={active}
			{...{ [INFO_TIPS_TOGGLE_ATTR]: "" }}
			className={`hidden h-8 w-8 items-center justify-center rounded-full transition-colors sm:flex ${
				active
					? "vc-toggle-on"
					: "hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
			}`}
		>
			<svg
				viewBox="0 0 20 20"
				width={18}
				height={18}
				aria-hidden="true"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.6}
				strokeLinejoin="round"
			>
				<path d="M5 3.5h10A2.5 2.5 0 0117.5 6v6a2.5 2.5 0 01-2.5 2.5H9.75L6 17.25V14.5H5A2.5 2.5 0 012.5 12V6A2.5 2.5 0 015 3.5z" />
				<circle cx={6.75} cy={9} r={1.1} fill="currentColor" stroke="none" />
				<circle cx={10} cy={9} r={1.1} fill="currentColor" stroke="none" />
				<circle cx={13.25} cy={9} r={1.1} fill="currentColor" stroke="none" />
			</svg>
		</button>
	)
}
