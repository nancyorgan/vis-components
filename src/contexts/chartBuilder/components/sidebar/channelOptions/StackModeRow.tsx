import { useAtom, useAtomValue } from "jotai"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { Segmented } from "../../../../../components/ui/Segmented"
import {
	DEFAULT_BRIGHTNESS_CONFIG,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_OPACITY_QUANTITATIVE,
	DEFAULT_PATTERN_CONFIG,
	DEFAULT_SATURATION_CONFIG,
	type ChannelConfigs,
	type HueConfig,
	type PatternConfig,
	type StackMode,
} from "../../../lib/channelConfig"
import { mappedStackChannels, type StackChannel } from "../../../lib/stackMode"
import type { Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
} from "../../../store/atoms"
import { isAreaModeId } from "../../../lib/chartModes/families"
import { useChartModeDef } from "../../../store/useChartModeDef"

/** A stack channel hosts its own Stack/Group/Overlay toggle whenever it's
 *  mapped — including when it shares a variable with another stack channel, so
 *  a user can e.g. group by color and stack by pattern even on the same field.
 *  (The chart-mode / area guards live in the component.) */
export const shouldShowStackToggle = (
	channel: StackChannel,
	encodings: Encodings,
): boolean => !!encodings[channel]?.field

/** Stack / group / overlay toggle, gated by `shouldShowStackToggle`: it renders
 *  on EVERY mapped stack channel's panel (hue, pattern, saturation, brightness,
 *  opacity), so each mapped channel independently controls its own layout role.
 *  The row is labeled "Layout" when 2+ stack channels are mapped (multiple
 *  toggles coexist) and "Stacking" when only one is. Returns null when its
 *  `channel` isn't mapped OR when the chart mode doesn't support stacking
 *  (scatter, pie, tile) — each panel can drop in `<StackModeRow channel="hue"
 *  />` without gating the call site. */
export const StackModeRow = ({
	channel,
	className,
}: {
	channel: StackChannel
	/** Extra classes on the row wrapper — e.g. `px-2` when the row sits as a
	 *  bare sibling of boxed subsections so its columns stay on the shared
	 *  alignment grid. Applied only when the row actually renders. */
	className?: string
}) => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// useChartModeDef (not bare getChartModeDef): config-gated modes —
	// histograms, map modes — only resolve with configs/mapConfig supplied.
	const modeDef = useChartModeDef()

	if (!modeDef.facet.supportsSharedMeasureMax) return null
	if (!shouldShowStackToggle(channel, encodings)) return null
	// Area mode's stacking toggle lives in the Connection panel (under
	// the Chart-type Line/Area toggle) so the user can flip stacking
	// without bouncing to a different panel. Bars and other stacking
	// modes keep the toggle in their primary channel panel (Hue, Pattern).
	if (isAreaModeId(modeDef.id)) return null

	const cfg = configs[channel] as { stackMode?: StackMode } | undefined
	const value: StackMode = cfg?.stackMode ?? "stack"
	const multiChannel = mappedStackChannels(encodings).length >= 2
	const rowLabel = multiChannel ? "Layout" : "Stacking"
	const setValue = (next: StackMode) => {
		setConfigs((prev) => writeStackMode(prev, channel, next))
	}

	return (
		<div
			className={`flex items-center gap-2 text-sm${className ? ` ${className}` : ""}`}
		>
			<span className={`shrink-0 ${LABEL_COL}`}>
				{rowLabel}
			</span>
			<Segmented
				ariaLabel={rowLabel}
				tipAnchor="stack-mode"
				value={value}
				segments={STACK_MODE_SEGMENTS}
				onChange={setValue}
			/>
		</div>
	)
}

/** Non-area stacking modes (bars) get all three options. The area case
 *  returns null above — its Stack/Overlay toggle lives in the Connection
 *  panel where the user already manages line-vs-area. */
const STACK_MODE_SEGMENTS: ReadonlyArray<{ key: StackMode; label: string }> = [
	{ key: "stack", label: "Stack" },
	{ key: "group", label: "Group" },
	{ key: "overlay", label: "Overlay" },
]

/** Build the next channelConfigs with the given stackMode written into the
 *  channel's config slot. Every stack channel (hue, pattern, saturation,
 *  brightness, opacity) carries its own stackMode; an absent slot is seeded
 *  from its DEFAULT_* config so the range/overrides stay at their defaults. */
export const writeStackMode = (
	prev: Partial<ChannelConfigs>,
	channel: StackChannel,
	next: StackMode,
): Partial<ChannelConfigs> => {
	if (channel === "hue") {
		const base: HueConfig = prev.hue ?? DEFAULT_CATEGORICAL_HUE_CONFIG
		return { ...prev, hue: { ...base, stackMode: next } }
	}
	if (channel === "pattern") {
		const base: PatternConfig = prev.pattern ?? DEFAULT_PATTERN_CONFIG
		return { ...prev, pattern: { ...base, stackMode: next } }
	}
	if (channel === "saturation") {
		const base = prev.saturation ?? DEFAULT_SATURATION_CONFIG
		return { ...prev, saturation: { ...base, stackMode: next } }
	}
	if (channel === "brightness") {
		const base = prev.brightness ?? DEFAULT_BRIGHTNESS_CONFIG
		return { ...prev, brightness: { ...base, stackMode: next } }
	}
	if (channel === "opacity") {
		// Opacity's config is a discriminated union (quantitative range /
		// categorical overrides); spreading preserves whichever kind is stored.
		// An unset slot seeds the quantitative default — a mapped opacity field
		// already carries its own config by the time this toggle is reachable.
		const base = prev.opacity ?? DEFAULT_OPACITY_QUANTITATIVE
		return { ...prev, opacity: { ...base, stackMode: next } }
	}
	return prev
}
