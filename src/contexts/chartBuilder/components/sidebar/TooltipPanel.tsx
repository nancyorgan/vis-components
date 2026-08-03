import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_HOVER_HIGHLIGHT_COLOR,
	DEFAULT_HOVER_OUTLINE_COLOR,
	DEFAULT_HOVER_OUTLINE_WIDTH,
	DEFAULT_TOOLTIP_CONFIG,
	type TooltipConfig,
} from "../../lib/labelsConfig"
import {
	DEFAULT_TOOLTIP_CSS,
	buildDefaultTooltipHtml,
} from "../../lib/tooltipDefaults"
import { ALL_ENCODING_CHANNELS } from "../../lib/channels"
import {
	currentEncodingsAtom,
	currentTooltipConfigAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { NumberInput } from "../../../../components/ui/NumberInput"

/** Sidebar panel for the tooltip subsystem. Drives `TooltipConfig` —
 * enable toggle, per-field visibility (drawn from the dataset, including
 * fields not currently mapped to any encoding), and a CSS escape hatch for
 * users who want to restyle the tooltip container. */
export const TooltipPanel = () => {
	const [cfg, setCfg] = useAtom(currentTooltipConfigAtom)
	const dataset = useCurrentDatasetView()
	const encodings = useAtomValue(currentEncodingsAtom)
	const merged: TooltipConfig = { ...DEFAULT_TOOLTIP_CONFIG, ...cfg }

	const update = (next: Partial<TooltipConfig>) =>
		setCfg({ ...merged, ...next })

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
	// Stored 0–1; surfaced as a 0–100 percentage in the UI.
	const hoverFadePercent = Math.round((merged.hoverFadeAmount ?? 0.85) * 100)

	return (
		<div className="vc-option-panel flex flex-col gap-2">
			<CollapsibleSubsection title="Tooltips" defaultOpen>
			<div className="flex flex-col gap-2">
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={merged.enabled}
					onChange={(e) => update({ enabled: e.target.checked })}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">
					Show tooltips
				</span>
			</label>
			{merged.enabled && mappedFieldNames.length > 0 && (
				<>
					<hr className="border-stone-200 dark:border-stone-700" />
					<span className="text-sm text-stone-600 dark:text-stone-400">
						Fields shown
					</span>
					<div className="flex flex-col gap-1">
						{mappedFieldNames.map((name) => (
							<label key={name} className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={isVisible(name)}
									onChange={(e) => toggleField(name, e.target.checked)}
									className="h-3 w-3"
								/>
								<span
									className="min-w-0 truncate text-stone-700 dark:text-stone-300"
									title={name}
								>
									{name}
								</span>
							</label>
						))}
					</div>
					{missingFromDataset.length > 0 && (
						<p className="text-xs text-amber-600 dark:text-amber-400">
							Not in the current dataset (won&apos;t appear in tooltip):{" "}
							{missingFromDataset.join(", ")}
						</p>
					)}
				</>
			)}
			{merged.enabled && (
				<>
					<hr className="border-stone-200 dark:border-stone-700" />
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={!!merged.useCustomHtml}
							onChange={(e) => update({ useCustomHtml: e.target.checked })}
							className="h-3 w-3"
						/>
						<span className="text-stone-700 dark:text-stone-300">
							Use custom HTML template
						</span>
					</label>
					<p className="ml-5 text-xs text-th-electric-indigo-700 dark:text-stone-400">
						Off (default): the tooltip uses the &ldquo;Fields shown&rdquo;
						checkboxes above. On: the textarea below replaces the tooltip
						content. &ldquo;Load default&rdquo; fills the textarea as a
						starter template — it doesn&rsquo;t flip this toggle on.
					</p>
					<label className="flex flex-col gap-1 text-sm">
						<div className="flex items-center justify-between gap-2">
							<span className="text-stone-600 dark:text-stone-400">
								Custom HTML template
							</span>
							<button
								type="button"
								onClick={() =>
									update({
										customHtml: buildDefaultTooltipHtml(mappedFieldNames),
									})
								}
								className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							>
								Load default
							</button>
						</div>
						<textarea
							value={merged.customHtml}
							onChange={(e) => update({ customHtml: e.target.value })}
							placeholder="<strong>{{state}}</strong><br/>Sales: {{sales}}"
							rows={6}
							className="rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
						<span className="text-sm text-th-electric-indigo-700 dark:text-stone-500">
							Use <code>{`{{fieldName}}`}</code> placeholders. Data values are
							HTML-escaped automatically. Toggle &ldquo;Use custom HTML
							template&rdquo; above to activate.
						</span>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<div className="flex items-center justify-between gap-2">
							<span className="text-stone-600 dark:text-stone-400">
								Custom CSS
							</span>
							<button
								type="button"
								onClick={() => update({ customCss: DEFAULT_TOOLTIP_CSS })}
								className="text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							>
								Load default
							</button>
						</div>
						<textarea
							value={merged.customCss}
							onChange={(e) => update({ customCss: e.target.value })}
							placeholder="background: #111; color: #fff; border-radius: 8px;"
							rows={6}
							className="rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
						<span className="text-sm text-th-electric-indigo-700 dark:text-stone-500">
							Applied to the <code>.vc-tooltip</code> container.
						</span>
					</label>
				</>
			)}
			</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Hover" defaultOpen>
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={hoverEnabled}
							onChange={(e) => update({ hoverEnabled: e.target.checked })}
							className="h-3 w-3"
						/>
						<span className="text-stone-600 dark:text-stone-400">
							Show hover
						</span>
					</label>
					{hoverEnabled && (
						<>
							<label className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									checked={legendHighlight}
									onChange={(e) =>
										update({ legendHighlight: e.target.checked })
									}
									className="mt-0.5 h-3 w-3 flex-shrink-0"
								/>
								<span className="text-stone-700 dark:text-stone-300">
									Hover over legend to highlight visual elements
								</span>
							</label>
							<label className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									checked={hoverRecolor}
									onChange={(e) =>
										update({ hoverRecolor: e.target.checked })
									}
									className="mt-0.5 h-3 w-3 flex-shrink-0"
								/>
								<span className="text-stone-700 dark:text-stone-300">
									Recolor hovered elements
								</span>
							</label>
							{hoverRecolor && (
								<div className="ml-5">
									<ColorInput
										label="Recolor color"
										labelClassName="w-28"
										value={hoverHighlightColor}
										onChange={(c) => update({ hoverHighlightColor: c })}
									/>
								</div>
							)}
							<label className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									checked={hoverOutline}
									onChange={(e) =>
										update({ hoverOutline: e.target.checked })
									}
									className="mt-0.5 h-3 w-3 flex-shrink-0"
								/>
								<span className="text-stone-700 dark:text-stone-300">
									Outline hovered elements
								</span>
							</label>
							{hoverOutline && (
								<div className="ml-5 flex flex-col gap-2">
									<ColorInput
										label="Outline color"
										labelClassName="w-28"
										value={hoverOutlineColor}
										onChange={(c) => update({ hoverOutlineColor: c })}
									/>
									<NumberInput
										label="Outline width"
										labelClassName="w-28"
										value={hoverOutlineWidth}
										min={0}
										max={20}
										step={1}
										clamp
										suffix="px"
										onChange={(n) =>
											update({ hoverOutlineWidth: Math.max(n, 0) })
										}
									/>
								</div>
							)}
							<label className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									checked={hoverFade}
									onChange={(e) => update({ hoverFade: e.target.checked })}
									className="mt-0.5 h-3 w-3 flex-shrink-0"
								/>
								<span className="text-stone-700 dark:text-stone-300">
									Fade other elements
								</span>
							</label>
							{hoverFade && (
								<div className="ml-5">
									<NumberInput
										label="Fade amount"
										labelClassName="w-28"
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
								</div>
							)}
						</>
					)}
				</div>
			</CollapsibleSubsection>
		</div>
	)
}
