import { useId } from "react"
import { useAtom } from "jotai"

import { infoTipsModeAtom } from "../contexts/chartBuilder/store/atoms"
import {
	INFO_TIPS_TOGGLE_ATTR,
	infoTipsLastTripAtom,
	nextInfoTipsMode,
	type InfoTipsMode,
} from "./infoTips"

/** Name per setting: the hover label and the accessible name, so the
 *  three settings are told apart without seeing the icon. */
const LABEL: Record<InfoTipsMode, string> = {
	paced: "Info tips",
	all: "All info tips",
	off: "Info tips off",
}

const BUBBLE =
	"M5 3.5h10A2.5 2.5 0 0117.5 6v6a2.5 2.5 0 01-2.5 2.5H9.75L6 17.25V14.5H5A2.5 2.5 0 012.5 12V6A2.5 2.5 0 015 3.5z"

/** The speech bubble with three dots, in a 20-unit box. */
const Bubble = ({ dot = 1.1 }: { dot?: number }) => (
	<>
		<path d={BUBBLE} />
		<circle cx={6.75} cy={9} r={dot} fill="currentColor" stroke="none" />
		<circle cx={10} cy={9} r={dot} fill="currentColor" stroke="none" />
		<circle cx={13.25} cy={9} r={dot} fill="currentColor" stroke="none" />
	</>
)

/** "Off": the bubble, smaller, inside a circle with a slash through it.
 *  The bubble is cut away around the slash so the two never touch. */
const OffIcon = () => {
	const mask = useId()
	return (
		<svg
			viewBox="0 0 24 24"
			width={22}
			height={22}
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinejoin="round"
			strokeLinecap="round"
		>
			<mask id={mask}>
				<rect width={24} height={24} fill="white" />
				<line x1={4.5} y1={4.5} x2={19.5} y2={19.5} stroke="black" strokeWidth={4.4} />
			</mask>
			<g
				mask={`url(#${mask})`}
				transform="translate(12 12.2) scale(0.66) translate(-10 -10.4)"
				strokeWidth={2.3}
			>
				<Bubble dot={1.4} />
			</g>
			<circle cx={12} cy={12} r={10.6} />
			<line x1={4.5} y1={4.5} x2={19.5} y2={19.5} />
		</svg>
	)
}

/** Header toggle (speech bubble with three dots), three settings in turn:
 *  paced → all → paced → off → paced → …  "All" shows every helper bubble
 *  for the current view at once (TipBoard); "off" hides every helper
 *  bubble and draws the icon crossed out. The setting is kept across
 *  sessions. On every page; hidden on phones, where the header has to
 *  stay one line and a board of 330px bubbles has no room. */
export const InfoTipsToggle = () => {
	const [mode, setMode] = useAtom(infoTipsModeAtom)
	const [lastTrip, setLastTrip] = useAtom(infoTipsLastTripAtom)
	const label = LABEL[mode]
	return (
		<button
			type="button"
			onClick={() => {
				const next = nextInfoTipsMode(mode, lastTrip)
				if (next !== "paced") setLastTrip(next)
				setMode(next)
			}}
			title={label}
			data-vc-title-instant=""
			aria-label={label}
			data-mode={mode}
			{...{ [INFO_TIPS_TOGGLE_ATTR]: "" }}
			className={`hidden h-8 w-8 items-center justify-center rounded-full transition-colors sm:flex ${
				mode === "all"
					? "vc-toggle-on"
					: "hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
			}`}
		>
			{mode === "off" ? (
				<OffIcon />
			) : (
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
					<Bubble />
				</svg>
			)}
		</button>
	)
}
