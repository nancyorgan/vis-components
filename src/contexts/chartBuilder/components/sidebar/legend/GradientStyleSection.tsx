import { useAtomValue } from "jotai"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { RadioGroup } from "../../../../../components/ui/RadioGroup"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { rowGroup } from "../../../../../components/ui/rowGroup"
import { LEGEND_FRIENDLY_NAME } from "../../../lib/labelsConfig"
import { currentRenderedGradientBarLengthAtom } from "../../../store/atoms"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** "Gradient legend style" — bar vs swatches per continuous legend, and the
 *  bar settings every gradient bar shares. */
export const GradientStyleSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		themeBar,
		bar,
		barValue,
		groupChanged,
		showGradientLegendStyle,
		rampChannels,
		rampStyleOf,
		setRampStyle,
		rampBarChannels,
		anyGradientBar,
		resolvedAuxSwatchColor,
	} = m
	// Rendered auto length of the gradient bar, published by the legend's
	// GradientBarRamp after each render. Placeholder + step start for the
	// "Bar length" input; 128 (the vertical bar's 8rem minimum) covers the
	// window before any bar has rendered.
	const autoGradientBarLength = useAtomValue(
		currentRenderedGradientBarLengthAtom,
	)
	const resolveGradientBarLengthStart = (): number =>
		bar.length ??
		(autoGradientBarLength && autoGradientBarLength > 0
			? autoGradientBarLength
			: 128)

	return (
		<CollapsibleSubsection
				title="Gradient legend style"
				changed={groupChanged("gradient")}
			>
			{/* One bar / swatches choice per continuous legend that can
			 *  draw as a bar — named by channel once there's more than
			 *  Color's. The bar settings below are shared by every bar. */}
			{showGradientLegendStyle && (
				<RadioGroup
					legend={
						rampChannels.length > 0
							? LEGEND_FRIENDLY_NAME.hue
							: "Gradient legend style"
					}
					value={merged.gradientLegendStyle ?? "bar"}
					options={[
						{ value: "bar", label: "Show gradient bar" },
						{ value: "swatches", label: "Show swatches" },
					]}
					onChange={(gradientLegendStyle) => update({ gradientLegendStyle })}
				/>
			)}
			{rampChannels.map((ch) => (
				<RadioGroup
					key={ch}
					legend={
						showGradientLegendStyle || rampChannels.length > 1
							? LEGEND_FRIENDLY_NAME[ch]
							: "Gradient legend style"
					}
					value={rampStyleOf(ch)}
					options={[
						{ value: "bar", label: "Show gradient bar" },
						{ value: "swatches", label: "Show swatches" },
					]}
					onChange={(style) => setRampStyle(ch, style)}
				/>
			))}
			{/* Saturation / Brightness / Opacity bars ramp the shared
			 *  swatch color (no Color scale to inherit) — the same
			 *  auxLegendSwatchColor their swatch subsection edits, which
			 *  isn't shown while they draw as bars. */}
			{rampBarChannels.length > 0 && (
				<div className="flex flex-wrap items-center gap-2">
					<ColorInput
						label="Bar color"
						labelClassName={LABEL_COL}
						value={resolvedAuxSwatchColor}
						onChange={(auxLegendSwatchColor) => update({ auxLegendSwatchColor })}
						showHexInput
					/>
					{merged.auxLegendSwatchColor != null && (
						<ResetLink onClick={() => update({ auxLegendSwatchColor: null })} />
					)}
				</div>
			)}
			{anyGradientBar && (
				<div className="flex flex-col gap-2">
					{/* Auto (null) is orientation-dependent (8rem minimum
					 *  vertical, full legend width horizontal) — not one fixed
					 *  px value — so this is a clear-to-null input (`onClear`).
					 *  The placeholder shows the RENDERED auto length (published
					 *  by GradientBarRamp) and the first spinner click / arrow
					 *  key steps from that displayed value instead of jumping
					 *  to 0 ([[auto-input-step-from-displayed]]). */}
					<div className="flex items-center gap-2">
						<NumberInput
							label="Bar length"
							labelClassName={LABEL_COL}
							min={0}
							step={1}
							value={merged.gradientBarLength ?? null}
							placeholder={
								themeBar.length != null
									? String(themeBar.length)
									: autoGradientBarLength != null
										? String(autoGradientBarLength)
										: "Auto"
							}
							stepBase={resolveGradientBarLengthStart()}
							onChange={(n) =>
								update({
									gradientBarLength: barValue(Math.max(0, n), themeBar.length),
								})
							}
							onClear={() => update({ gradientBarLength: null })}
							inputClassName="w-16"
							suffix="px"
						/>
						{merged.gradientBarLength != null && (
							<ResetLink onClick={() => update({ gradientBarLength: null })} />
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Bar thickness"
							labelClassName={LABEL_COL}
							value={bar.thickness}
							min={0}
							step={1}
							onChange={(n) =>
								update({
									gradientBarThickness: barValue(Math.max(0, n), themeBar.thickness),
								})
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{merged.gradientBarThickness != null && (
							<ResetLink onClick={() => update({ gradientBarThickness: null })} />
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Corner radius"
							labelClassName={LABEL_COL}
							value={bar.radius}
							min={0}
							step={1}
							onChange={(n) =>
								update({ gradientBarRadius: barValue(n, themeBar.radius) })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{merged.gradientBarRadius != null && (
							<ResetLink onClick={() => update({ gradientBarRadius: null })} />
						)}
					</div>
					{/* Border thickness is the switch ([[legend-swatch-outline]]
					 *  convention): 0 (the default) draws no border and hides
					 *  the color picker, which is inert until there's a stroke
					 *  to color. */}
					<div className={rowGroup(bar.borderWidth > 0)}>
						<div className="flex items-center gap-2">
							<NumberInput
								label="Border thickness"
								labelClassName={LABEL_COL}
								value={bar.borderWidth}
								min={0}
								step={0.5}
								onChange={(n) =>
									update({
										gradientBarBorderWidth: barValue(
											Math.max(0, n),
											themeBar.borderWidth
										),
									})
								}
								inputClassName="w-16"
								suffix="px"
							/>
							{merged.gradientBarBorderWidth != null && (
								<ResetLink onClick={() => update({ gradientBarBorderWidth: null })} />
							)}
						</div>
						{bar.borderWidth > 0 && (
							<div className="flex flex-wrap items-center gap-2">
								<ColorInput
									label="Border color"
									labelClassName={LABEL_COL}
									value={bar.borderColor}
									onChange={(c) =>
										update({
											gradientBarBorderColor: barValue(c, themeBar.borderColor),
										})
									}
									showHexInput
								/>
								{merged.gradientBarBorderColor != null && (
									<ResetLink
										onClick={() => update({ gradientBarBorderColor: null })}
									/>
								)}
							</div>
						)}
					</div>
					<div className={rowGroup(bar.tickLength > 0)}>
						<div className="flex items-center gap-2">
							<NumberInput
								label="Tick length"
								labelClassName={LABEL_COL}
								value={bar.tickLength}
								min={0}
								step={1}
								onChange={(n) =>
									update({ gradientBarTickLength: barValue(n, themeBar.tickLength) })
								}
								inputClassName="w-16"
								suffix="px"
							/>
							{merged.gradientBarTickLength != null && (
								<ResetLink onClick={() => update({ gradientBarTickLength: null })} />
							)}
						</div>
						{bar.tickLength > 0 && (
							<>
								<div className="flex items-center gap-2">
									<NumberInput
										label="Tick thickness"
										labelClassName={LABEL_COL}
										value={bar.tickThickness}
										min={0}
										step={0.5}
										onChange={(n) =>
											update({
												gradientBarTickThickness: barValue(n, themeBar.tickThickness),
											})
										}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.gradientBarTickThickness != null && (
										<ResetLink
											onClick={() => update({ gradientBarTickThickness: null })}
										/>
									)}
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<ColorInput
										label="Tick color"
										labelClassName={LABEL_COL}
										value={bar.tickColor}
										onChange={(c) =>
											update({
												gradientBarTickColor: barValue(c, themeBar.tickColor),
											})
										}
										showHexInput
									/>
									{merged.gradientBarTickColor != null && (
										<ResetLink onClick={() => update({ gradientBarTickColor: null })} />
									)}
								</div>
							</>
						)}
					</div>
				</div>
			)}
		</CollapsibleSubsection>
	)
}
