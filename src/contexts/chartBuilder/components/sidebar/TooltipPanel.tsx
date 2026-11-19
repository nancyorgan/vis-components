import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_HOVER_HIGHLIGHT_COLOR,
	DEFAULT_HOVER_OUTLINE_COLOR,
	DEFAULT_HOVER_OUTLINE_WIDTH,
	DEFAULT_TOOLTIP_CONFIG,
	hasTooltipBoxOverride,
	resolveTooltipBox,
	type TooltipBoxKey,
	type TooltipConfig,
	tooltipBoxPatch,
} from "../../lib/labelsConfig"
import { tooltipConfigFromTheme } from "../../lib/themeConfig"
import {
	buildDefaultTooltipCss,
	buildDefaultTooltipHtml,
	customHtmlPatch,
} from "../../lib/tooltipDefaults"
import { ALL_ENCODING_CHANNELS } from "../../lib/channels"
import {
	currentEncodingsAtom,
	currentTooltipConfigAtom,
} from "../../store/atoms"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { Checkbox } from "../../../../components/ui/Checkbox"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { rowGroup } from "../../../../components/ui/rowGroup"
import { Textarea } from "../../../../components/ui/Input"

/** Sidebar panel for the tooltip subsystem. Drives `TooltipConfig` —
 * enable toggle, per-field visibility (drawn from the dataset, including
 * fields not currently mapped to any encoding), the tooltip box's look
 * (max width, corner radius, outline, background, opacity), and a CSS
 * escape hatch for users who want to restyle the container further. */
export const TooltipPanel = () => {
	const [cfg, setCfg] = useAtom(currentTooltipConfigAtom)
	const dataset = useCurrentDatasetView()
	const encodings = useAtomValue(currentEncodingsAtom)
	const merged: TooltipConfig = { ...DEFAULT_TOOLTIP_CONFIG, ...cfg }
	// "Only at points" is a LINE-chart question: it exists because a line is
	// hoverable between its points. That's the mode whose connection draws a
	// polyline (`canvas.connectionRole === "line"`) with a connection field
	// mapped — the renderer that snaps the hover to the nearest point.
	// Nothing else draws a line the pointer can wander along.
	const isLineChart =
		useChartModeDef().canvas.connectionRole === "line" &&
		!!encodings.connection?.field

	const update = (next: Partial<TooltipConfig>) =>
		setCfg({ ...merged, ...next })
	/** Drop a sparse entry so the setting follows the theme again. */
	const unset = (key: TooltipBoxKey) => {
		const next = { ...merged }
		delete next[key]
		setCfg(next)
	}

	const allFields = dataset?.fields ?? []
	// Per APPLICATION.md §10 + §15.5: the Fields-shown list always
	// contains every variable in the dataset — mapped OR unmapped — so
	// the user can opt any column into the tooltip (default template
	// or custom HTML). Aggregating renderers (Bar/Area) now surface
	// unmapped fields by taking the first matching row as a
	// representative sample; PiePlot/TilePlot still drop unmapped
	// fields (see their hover handlers) but the checkbox is exposed
	// for symmetry and custom-template authoring.
	const mappedFieldNames = allFields.map((f) => f.name)
	const defaultHtml = buildDefaultTooltipHtml(mappedFieldNames)
	// Tooltip box: the visual's entries over the theme's Tooltips sheet
	// (`resolveTooltipBox`). Entries are SPARSE — the controls show the
	// resolved value, write an entry only when it differs from the theme,
	// and the reset link drops the entry so the theme flows through again.
	const theme = useCurrentTheme()
	// What a fresh chart on this theme starts with (Settings → Themes →
	// Tooltips → Hover seeds these on create / re-theme): the baseline for
	// the changed dots and what the reset links restore.
	const seed = tooltipConfigFromTheme(theme)
	const box = resolveTooltipBox(merged, theme)
	const boxChanged = hasTooltipBoxOverride(merged)
	const pinned = (key: TooltipBoxKey) => merged[key] !== undefined
	/** Write a box number: the theme's own value clears the entry. */
	const setBoxNumber = (
		key: Extract<
			TooltipBoxKey,
			| "tooltipMaxWidth"
			| "tooltipCornerRadius"
			| "tooltipBackgroundOpacity"
			| "tooltipShadowSize"
			| "tooltipShadowOpacity"
		>,
		n: number
	) => setCfg(tooltipBoxPatch(merged, key, n, theme))
	/** Write a box color (`null` = Auto): the theme's own value clears it. */
	const setBoxColor = (
		key: Extract<
			TooltipBoxKey,
			"tooltipOutlineColor" | "tooltipBackgroundColor" | "tooltipShadowColor"
		>,
		c: string | null
	) => setCfg(tooltipBoxPatch(merged, key, c, theme))
	// The Custom CSS seed mirrors the box as it stands, so turning the
	// template on changes nothing visible.
	const defaultCss = buildDefaultTooltipCss(box)
	// Surface any encoding-referenced field that ISN'T in the current
	// dataset's field list. If something's mapped that isn't a column
	// we know about (renamed column, dataset swap, etc.), it would
	// silently disappear from the tooltip checkbox list — surface a
	// hint to the user so the missing row isn't mysterious.
	const datasetFieldSet = new Set(allFields.map((f) => f.name))
	const missingFromDataset = (() => {
		const out: string[] = []
		for (const ch of ALL_ENCODING_CHANNELS) {
			const f = encodings[ch]?.field
			if (f && !datasetFieldSet.has(f) && !out.includes(f)) out.push(f)
		}
		return out
	})()
	// Empty list = "show every field". The toggles below treat that state as
	// "all checked" so the user can opt fields out one by one without first
	// having to opt in.
	const showAll = merged.visibleFields.length === 0
	const isVisible = (name: string) =>
		showAll || merged.visibleFields.includes(name)

	const toggleField = (name: string, on: boolean) => {
		if (showAll && !on) {
			// Transition from "all" → explicit list minus the unchecked field.
			update({
				visibleFields: mappedFieldNames.filter((n) => n !== name),
			})
			return
		}
		const next = on
			? [...merged.visibleFields, name]
			: merged.visibleFields.filter((f) => f !== name)
		// If the user just re-checked every mapped field, collapse back to
		// "show all" (= []) so future field-mapping changes auto-include
		// new fields.
		const allChecked =
			next.length === mappedFieldNames.length &&
			mappedFieldNames.every((n) => next.includes(n))
		update({ visibleFields: allChecked ? [] : next })
	}

	const hoverEnabled = merged.hoverEnabled ?? true
	const legendHighlight = merged.legendHighlight ?? true
	const hoverRecolor = merged.hoverRecolor ?? false
	const hoverOutline = merged.hoverOutline ?? false
	const hoverFade = merged.hoverFade ?? true
	const hoverHighlightColor =
		merged.hoverHighlightColor ?? DEFAULT_HOVER_HIGHLIGHT_COLOR
	const hoverOutlineColor =
		merged.hoverOutlineColor ?? DEFAULT_HOVER_OUTLINE_COLOR
	const hoverOutlineWidth = merged.hoverOutlineWidth ?? DEFAULT_HOVER_OUTLINE_WIDTH
	const hoverFadeAmount = merged.hoverFadeAmount ?? 0.85
	// Stored 0–1; surfaced as a 0–100 percentage in the UI.
	const hoverFadePercent = Math.round(hoverFadeAmount * 100)

	// Subsection "changed" dots — any control off the theme's seed. A
	// control hidden behind a toggle (custom HTML boxes; the hover styling
	// while its toggle is off) is compared only while it shows: turning the
	// toggle away from the seed is itself the deviation that lights the dot.
	const tooltipsChanged =
		merged.enabled !== seed.enabled ||
		(merged.enabled &&
			(merged.visibleFields.length > 0 ||
				!!merged.useCustomHtml ||
				!!merged.pointsOnly !== !!seed.pointsOnly ||
				boxChanged))
	const hoverChanged =
		hoverEnabled !== !!seed.hoverEnabled ||
		(hoverEnabled &&
			(legendHighlight !== !!seed.legendHighlight ||
				hoverRecolor !== !!seed.hoverRecolor ||
				(hoverRecolor &&
					hoverHighlightColor !== seed.hoverHighlightColor) ||
				hoverOutline !== !!seed.hoverOutline ||
				(hoverOutline &&
					(hoverOutlineColor !== seed.hoverOutlineColor ||
						hoverOutlineWidth !== seed.hoverOutlineWidth)) ||
				hoverFade !== !!seed.hoverFade ||
				(hoverFade && hoverFadeAmount !== seed.hoverFadeAmount)))

	return (
		<div className="vc-option-panel">
			<CollapsibleSubsection title="Tooltips" defaultOpen changed={tooltipsChanged}>
			<div className="flex flex-col gap-2">
			<Checkbox
				label="Show tooltips"
				checked={merged.enabled}
				onChange={(enabled) => update({ enabled })}
			/>
			{merged.enabled && isLineChart && (
				<>
					<Checkbox
						label="Show tooltips only at points"
						checked={!!merged.pointsOnly}
						onChange={(pointsOnly) => update({ pointsOnly })}
					/>
					<p className="vc-help">
						Between the points a line draws, the tooltip shows only that
						line&apos;s {encodings.connection?.field}.
					</p>
				</>
			)}
			{merged.enabled && mappedFieldNames.length > 0 && (
				<div className="vc-divider-group">
					<span className="vc-group-header">Fields shown</span>
					<div className="flex flex-col gap-1">
						{mappedFieldNames.map((name) => (
							<Checkbox
								key={name}
								className="min-w-0 [&>label]:min-w-0 [&>label]:truncate"
								label={<span>{name}</span>}
								checked={isVisible(name)}
								onChange={(on) => toggleField(name, on)}
							/>
						))}
					</div>
					{missingFromDataset.length > 0 && (
						<p className="text-xs text-amber-600 dark:text-amber-400">
							Not in the current dataset (won&apos;t appear in tooltip):{" "}
							{missingFromDataset.join(", ")}
						</p>
					)}
				</div>
			)}
			{merged.enabled && (
				<div className="vc-divider-group">
					<span className="vc-group-header">Box</span>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Max width"
							labelClassName={LABEL_COL}
							value={box.maxWidth}
							min={40}
							step={10}
							clamp
							suffix="px"
							onChange={(n) => setBoxNumber("tooltipMaxWidth", Math.max(n, 40))}
						/>
						{pinned("tooltipMaxWidth") && (
							<ResetLink
								ariaLabel="Reset max width"
								onClick={() => unset("tooltipMaxWidth")}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Corner radius"
							labelClassName={LABEL_COL}
							value={box.cornerRadius}
							min={0}
							step={1}
							clamp
							suffix="px"
							onChange={(n) =>
								setBoxNumber("tooltipCornerRadius", Math.max(n, 0))
							}
						/>
						{pinned("tooltipCornerRadius") && (
							<ResetLink
								ariaLabel="Reset corner radius"
								onClick={() => unset("tooltipCornerRadius")}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<ColorInput
							label="Outline color"
							labelClassName={LABEL_COL}
							value={box.outlineColor}
							placeholder="Auto"
							onChange={(c) => setBoxColor("tooltipOutlineColor", c)}
							onClear={() => setBoxColor("tooltipOutlineColor", null)}
						/>
						{pinned("tooltipOutlineColor") && (
							<ResetLink
								ariaLabel="Reset outline color"
								onClick={() => unset("tooltipOutlineColor")}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<ColorInput
							label="Background color"
							labelClassName={LABEL_COL}
							value={box.backgroundColor}
							placeholder="Auto"
							onChange={(c) => setBoxColor("tooltipBackgroundColor", c)}
							onClear={() => setBoxColor("tooltipBackgroundColor", null)}
						/>
						{pinned("tooltipBackgroundColor") && (
							<ResetLink
								ariaLabel="Reset background color"
								onClick={() => unset("tooltipBackgroundColor")}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Background opacity"
							labelClassName={LABEL_COL}
							value={box.backgroundOpacity}
							min={0}
							max={1}
							step={0.05}
							clamp
							onChange={(n) =>
								setBoxNumber(
									"tooltipBackgroundOpacity",
									Math.min(Math.max(n, 0), 1)
								)
							}
						/>
						{pinned("tooltipBackgroundOpacity") && (
							<ResetLink
								ariaLabel="Reset background opacity"
								onClick={() => unset("tooltipBackgroundOpacity")}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Shadow size"
							labelClassName={LABEL_COL}
							value={box.shadowSize}
							min={0}
							step={1}
							clamp
							suffix="px"
							onChange={(n) => setBoxNumber("tooltipShadowSize", Math.max(n, 0))}
						/>
						{pinned("tooltipShadowSize") && (
							<ResetLink
								ariaLabel="Reset shadow size"
								onClick={() => unset("tooltipShadowSize")}
							/>
						)}
					</div>
					{box.shadowSize > 0 && (
						<>
							<div className="flex items-center gap-2">
								<ColorInput
									label="Shadow color"
									labelClassName={LABEL_COL}
									value={box.shadowColor}
									onChange={(c) => setBoxColor("tooltipShadowColor", c)}
								/>
								{pinned("tooltipShadowColor") && (
									<ResetLink
										ariaLabel="Reset shadow color"
										onClick={() => unset("tooltipShadowColor")}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Shadow opacity"
									labelClassName={LABEL_COL}
									value={box.shadowOpacity}
									min={0}
									max={1}
									step={0.05}
									clamp
									onChange={(n) =>
										setBoxNumber(
											"tooltipShadowOpacity",
											Math.min(Math.max(n, 0), 1)
										)
									}
								/>
								{pinned("tooltipShadowOpacity") && (
									<ResetLink
										ariaLabel="Reset shadow opacity"
										onClick={() => unset("tooltipShadowOpacity")}
									/>
								)}
							</div>
						</>
					)}
				</div>
			)}
			{/* Off, the template switch is one row and follows the Box rows; on,
			 *  it and its two editors are a group under a divider. */}
			{merged.enabled && (
				<div className={rowGroup(!!merged.useCustomHtml)}>
					<Checkbox
						label="Use custom HTML template"
						checked={!!merged.useCustomHtml}
						onChange={(on) => update(customHtmlPatch(merged, on, mappedFieldNames, theme))}
					/>
					{merged.useCustomHtml && (
					<>
					<label className="flex flex-col gap-1 text-sm">
						<span className="vc-text">
							Custom HTML template
						</span>
						<Textarea
							value={merged.customHtml}
							onChange={(e) => update({ customHtml: e.target.value })}
							placeholder="<strong>{{state}}</strong><br/>Sales: {{sales}}"
							rows={6}
							className="font-mono"
						/>
						<div className="flex items-start justify-between gap-2">
							{merged.customHtml !== "" && merged.customHtml !== defaultHtml && (
								<ResetLink
									onClick={() => update({ customHtml: defaultHtml })}
								/>
							)}
						</div>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="vc-text">
							Custom CSS
						</span>
						<Textarea
							value={merged.customCss}
							onChange={(e) => update({ customCss: e.target.value })}
							placeholder="background: #111; color: #fff; border-radius: 8px;"
							rows={6}
							className="font-mono"
						/>
						<div className="flex items-start justify-between gap-2">
							{merged.customCss !== "" && merged.customCss !== defaultCss && (
								<ResetLink
									onClick={() => update({ customCss: defaultCss })}
								/>
							)}
						</div>
					</label>
					</>
					)}
				</div>
			)}
			</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Hover" defaultOpen changed={hoverChanged}>
				<div className="flex flex-col gap-2">
					<Checkbox
						label="Show hover"
						checked={hoverEnabled}
						onChange={(on) => update({ hoverEnabled: on })}
					/>
					{hoverEnabled && (
						<>
							<Checkbox
								label="Hover over legend to highlight visual elements"
								checked={legendHighlight}
								onChange={(on) => update({ legendHighlight: on })}
							/>
							<Checkbox
								label="Recolor hovered elements"
								checked={hoverRecolor}
								onChange={(on) => update({ hoverRecolor: on })}
							/>
							{hoverRecolor && (
								<div className="flex items-center gap-2">
									<ColorInput
										label="Recolor color"
										labelClassName={LABEL_COL}
										value={hoverHighlightColor}
										onChange={(c) => update({ hoverHighlightColor: c })}
									/>
									{hoverHighlightColor !== seed.hoverHighlightColor && (
										<ResetLink
											ariaLabel="Reset recolor color"
											onClick={() => update({ hoverHighlightColor: seed.hoverHighlightColor })}
										/>
									)}
								</div>
							)}
							<Checkbox
								label="Outline hovered elements"
								checked={hoverOutline}
								onChange={(on) => update({ hoverOutline: on })}
							/>
							{hoverOutline && (
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-2">
										<ColorInput
											label="Outline color"
											labelClassName={LABEL_COL}
											value={hoverOutlineColor}
											onChange={(c) => update({ hoverOutlineColor: c })}
										/>
										{hoverOutlineColor !== seed.hoverOutlineColor && (
											<ResetLink
												ariaLabel="Reset outline color"
												onClick={() => update({ hoverOutlineColor: seed.hoverOutlineColor })}
											/>
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Outline thickness"
											labelClassName={LABEL_COL}
											value={hoverOutlineWidth}
											min={0}
											step={0.5}
											clamp
											suffix="px"
											onChange={(n) =>
												update({ hoverOutlineWidth: Math.max(n, 0) })
											}
										/>
										{hoverOutlineWidth !== seed.hoverOutlineWidth && (
											<ResetLink
												ariaLabel="Reset outline thickness"
												onClick={() => update({ hoverOutlineWidth: seed.hoverOutlineWidth })}
											/>
										)}
									</div>
								</div>
							)}
							<Checkbox
								label="Fade other elements"
								checked={hoverFade}
								onChange={(on) => update({ hoverFade: on })}
							/>
							{hoverFade && (
								<div className="flex items-center gap-2">
									<NumberInput
										label="Fade amount"
										labelClassName={LABEL_COL}
										value={hoverFadePercent}
										min={0}
										max={100}
										step={5}
										clamp
										suffix="%"
										onChange={(n) =>
											update({
												hoverFadeAmount:
													Math.min(Math.max(n, 0), 100) / 100,
											})
										}
									/>
									{hoverFadeAmount !== seed.hoverFadeAmount && (
										<ResetLink
											ariaLabel="Reset fade amount"
											onClick={() =>
												update({ hoverFadeAmount: seed.hoverFadeAmount })
											}
										/>
									)}
								</div>
							)}
						</>
					)}
				</div>
			</CollapsibleSubsection>
		</div>
	)
}
