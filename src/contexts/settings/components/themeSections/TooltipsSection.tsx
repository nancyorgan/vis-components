import {
	DEFAULT_HOVER_HIGHLIGHT_COLOR,
	DEFAULT_HOVER_OUTLINE_COLOR,
	DEFAULT_HOVER_OUTLINE_WIDTH,
} from "../../../chartBuilder/lib/labelsConfig"
import { tooltipConfigFromTheme } from "../../../chartBuilder/lib/themeConfig"
import {
	CheckboxRow,
	ColorInput,
	NumberInput,
	Section,
	SectionGroup,
} from "./controls"
import type { ThemeSectionProps } from "./types"

/** One Auto / Custom color: the tooltip's outline and background follow
 *  the light / dark UI unless the theme names a color. The radio pair is
 *  the Legend section's "Automatic / Custom color" pattern. */
const AutoColorRow = ({
	label,
	autoLabel,
	value,
	seed,
	onChange,
}: {
	label: string
	autoLabel: string
	value: string | null
	seed: string
	onChange: (v: string | null) => void
}) => (
	<div className="flex flex-col gap-1.5">
		<span className="text-sm vc-muted">{label}</span>
		<label className="flex items-center gap-2 text-sm">
			<input
				type="radio"
				checked={value === null}
				onChange={() => onChange(null)}
			/>
			<span className="vc-text">{autoLabel}</span>
		</label>
		<label className="flex items-center gap-2 text-sm">
			<input
				type="radio"
				checked={value !== null}
				onChange={() => onChange(value ?? seed)}
			/>
			<span className="vc-text">Custom color</span>
		</label>
		{value !== null && (
			<ColorInput label="Color" value={value} onChange={onChange} />
		)}
	</div>
)

/** Settings → Themes → Tooltips → Hover: tooltip on/off and the hover look.
 *  Unlike the box, these are SEEDED into a chart's `TooltipConfig` when it's
 *  created or switched onto the theme (`tooltipConfigFromTheme`); an unset
 *  field shows the built-in default. Labels match the sidebar's. */
const HoverDefaults = ({ theme, set }: Omit<ThemeSectionProps, "isReadOnly">) => {
	const seed = tooltipConfigFromTheme(theme)
	const hoverOn = seed.hoverEnabled ?? true
	return (
		<Section title="Hover">
			<p className="text-xs vc-muted">
				What a new chart&apos;s Tooltips and hover settings start as. Copied in
				when a chart is created or switched to this theme — editing them here
				doesn&apos;t change existing charts.
			</p>
			<CheckboxRow
				label="Show tooltips"
				checked={seed.enabled}
				onChange={(v) => set("tooltipEnabled", v)}
			/>
			{seed.enabled && (
				<CheckboxRow
					label="Show tooltips only at points"
					checked={!!seed.pointsOnly}
					onChange={(v) => set("tooltipPointsOnly", v)}
				/>
			)}
			<CheckboxRow
				label="Show hover"
				checked={hoverOn}
				onChange={(v) => set("hoverEnabled", v)}
			/>
			{hoverOn && (
				<>
					<CheckboxRow
						label="Hover over legend to highlight visual elements"
						checked={seed.legendHighlight ?? true}
						onChange={(v) => set("hoverLegendHighlight", v)}
					/>
					<CheckboxRow
						label="Recolor hovered elements"
						checked={!!seed.hoverRecolor}
						onChange={(v) => set("hoverRecolor", v)}
					/>
					{seed.hoverRecolor && (
						<ColorInput
							label="Recolor color"
							value={seed.hoverHighlightColor ?? DEFAULT_HOVER_HIGHLIGHT_COLOR}
							onChange={(v) => set("hoverHighlightColor", v)}
						/>
					)}
					<CheckboxRow
						label="Outline hovered elements"
						checked={!!seed.hoverOutline}
						onChange={(v) => set("hoverOutline", v)}
					/>
					{seed.hoverOutline && (
						<>
							<ColorInput
								label="Outline color"
								value={seed.hoverOutlineColor ?? DEFAULT_HOVER_OUTLINE_COLOR}
								onChange={(v) => set("hoverOutlineColor", v)}
							/>
							<NumberInput
								label="Outline thickness"
								value={seed.hoverOutlineWidth ?? DEFAULT_HOVER_OUTLINE_WIDTH}
								min={0}
								max={20}
								step={0.5}
								suffix="px"
								onChange={(v) => set("hoverOutlineWidth", Math.max(v, 0))}
							/>
						</>
					)}
					<CheckboxRow
						label="Fade other elements"
						checked={seed.hoverFade ?? true}
						onChange={(v) => set("hoverFade", v)}
					/>
					{(seed.hoverFade ?? true) && (
						// Stored 0–1; shown as a percentage like the sidebar.
						<NumberInput
							label="Fade amount"
							value={Math.round((seed.hoverFadeAmount ?? 0.85) * 100)}
							min={0}
							max={100}
							step={5}
							suffix="%"
							onChange={(v) =>
								set("hoverFadeAmount", Math.min(Math.max(v, 0), 100) / 100)
							}
						/>
					)}
				</>
			)}
		</Section>
	)
}

/** Settings → Themes → Tooltips: the box every hover tooltip renders in.
 *  The Tooltips panel's Box group shows these values live and stores an
 *  override only where a visual deviates (`resolveTooltipBox`). The Hover
 *  section after it is seeded instead (see `HoverDefaults`). */
export const TooltipsSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Tooltips" isReadOnly={isReadOnly}>
		<Section title="Tooltip box">
			<p className="text-xs vc-muted">
				What the hover tooltip&apos;s box starts as on every visual. Text
				wraps inside the max width. Tooltips and hover&apos;s Box group
				overrides these per visual.
			</p>
			<NumberInput
				label="Max width"
				value={theme.tooltipMaxWidth}
				min={40}
				max={1000}
				step={10}
				suffix="px"
				onChange={(v) => set("tooltipMaxWidth", v)}
			/>
			<NumberInput
				label="Corner radius"
				value={theme.tooltipCornerRadius}
				min={0}
				max={60}
				step={1}
				suffix="px"
				onChange={(v) => set("tooltipCornerRadius", v)}
			/>
			<AutoColorRow
				label="Outline color"
				autoLabel="Automatic (a hairline that follows light / dark mode)"
				value={theme.tooltipOutlineColor}
				seed="#e7e5e4"
				onChange={(v) => set("tooltipOutlineColor", v)}
			/>
			<AutoColorRow
				label="Background color"
				autoLabel="Automatic (white, or dark in dark mode)"
				value={theme.tooltipBackgroundColor}
				seed="#ffffff"
				onChange={(v) => set("tooltipBackgroundColor", v)}
			/>
			<NumberInput
				label="Background opacity"
				value={theme.tooltipBackgroundOpacity}
				min={0}
				max={1}
				step={0.05}
				onChange={(v) => set("tooltipBackgroundOpacity", v)}
			/>
			<NumberInput
				label="Shadow size"
				value={theme.tooltipShadowSize}
				min={0}
				max={80}
				step={1}
				suffix="px"
				onChange={(v) => set("tooltipShadowSize", v)}
			/>
			{theme.tooltipShadowSize > 0 && (
				<>
					<ColorInput
						label="Shadow color"
						value={theme.tooltipShadowColor}
						onChange={(v) => set("tooltipShadowColor", v)}
					/>
					<NumberInput
						label="Shadow opacity"
						value={theme.tooltipShadowOpacity}
						min={0}
						max={1}
						step={0.05}
						onChange={(v) => set("tooltipShadowOpacity", v)}
					/>
				</>
			)}
		</Section>
		<HoverDefaults theme={theme} set={set} />
	</SectionGroup>
)
