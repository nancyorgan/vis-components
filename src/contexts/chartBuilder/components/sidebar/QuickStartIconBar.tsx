import { useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { DEFAULT_ANNOTATIONS_CONFIG } from "../../lib/annotationsConfig"
import {
	detectGeoFields,
	EMPTY_GEO_DETECTION,
} from "../../lib/geo/detectGeoFields"
import { buildQuantHueConfigFromTheme } from "../../lib/hueDefaults"
import {
	applyVariation,
	assignFields,
	mapConfigForVariation,
	nextVariationIndex,
	satisfiableVariationIndices,
} from "../../lib/quickStart"
import type { QuickStartChartType } from "../../lib/quickStartVariations"
import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
} from "../../lib/quickStartVariations"
import type { EncodingChannel } from "../../lib/types"
import { ALL_ENCODING_CHANNELS } from "../../lib/types"
import {
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentMapConfigAtom,
	quickStartStateAtom,
} from "../../store/atoms"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

type Pending = {
	chartType: QuickStartChartType
	variationIndex: number
}

// -- Icons ------------------------------------------------------------------
// Minimal inline SVGs (16x16) so we stay zero-dep. Not pixel-perfect — just
// distinct enough that a user can tell them apart at a glance.

type IconProps = { className?: string }

const BarIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		<rect x="2" y="8" width="3" height="6" />
		<rect x="6.5" y="5" width="3" height="9" />
		<rect x="11" y="10" width="3" height="4" />
	</svg>
)

const ScatterIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		<circle cx="3" cy="11" r="1.5" />
		<circle cx="6" cy="6" r="1.5" />
		<circle cx="9" cy="9" r="1.5" />
		<circle cx="12" cy="4" r="1.5" />
		<circle cx="13" cy="12" r="1.5" />
	</svg>
)

const DumbbellIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Two category rows, each a pair of endpoint dots joined by a bar. */}
		<line
			x1="4"
			y1="5"
			x2="12"
			y2="5"
			stroke="currentColor"
			strokeWidth={1.5}
		/>
		<circle cx="4" cy="5" r="1.75" />
		<circle cx="12" cy="5" r="1.75" fillOpacity={0.5} />
		<line
			x1="6"
			y1="11"
			x2="13"
			y2="11"
			stroke="currentColor"
			strokeWidth={1.5}
		/>
		<circle cx="6" cy="11" r="1.75" />
		<circle cx="13" cy="11" r="1.75" fillOpacity={0.5} />
	</svg>
)

const LineIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		<polyline
			points="2,12 5,7 8,9 11,4 14,8"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const AreaIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		<polygon points="2,14 2,11 5,7 8,9 11,4 14,7 14,14" fillOpacity={0.5} />
		<polyline
			points="2,11 5,7 8,9 11,4 14,7"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const PieIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		<circle cx="8" cy="8" r="6" fillOpacity={0.25} />
		<path d="M 8 8 L 8 2 A 6 6 0 0 1 13.2 11 Z" />
	</svg>
)

const RadarIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Outer ring + cross spokes for the radar grid */}
		<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth={1} opacity={0.5} />
		<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth={1} opacity={0.5} />
		<line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth={1} opacity={0.5} />
		<line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth={1} opacity={0.5} />
		{/* Closed polygon — one vertex per spoke */}
		<polygon
			points="8,3 12,8 8,12 4,7"
			fill="currentColor"
			fillOpacity={0.35}
			stroke="currentColor"
			strokeWidth={1.25}
			strokeLinejoin="round"
		/>
	</svg>
)

const ViolinIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Two stylized violin lobes — vertical density curves side by side. */}
		<path
			d="M4 2 C 6 4, 6 6, 4 8 C 6 10, 6 12, 4 14 C 2 12, 2 10, 4 8 C 2 6, 2 4, 4 2 Z"
			fillOpacity={0.5}
		/>
		<path
			d="M11 2 C 13 4, 13 7, 11 8 C 13 9, 13 12, 11 14 C 9 12, 9 9, 11 8 C 9 7, 9 4, 11 2 Z"
			fillOpacity={0.5}
		/>
	</svg>
)

const TileIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* 3x3 heatmap grid with varying fill opacities. */}
		<rect x="2" y="2" width="3.5" height="3.5" fillOpacity={0.85} />
		<rect x="6.25" y="2" width="3.5" height="3.5" fillOpacity={0.5} />
		<rect x="10.5" y="2" width="3.5" height="3.5" fillOpacity={0.25} />
		<rect x="2" y="6.25" width="3.5" height="3.5" fillOpacity={0.5} />
		<rect x="6.25" y="6.25" width="3.5" height="3.5" fillOpacity={0.85} />
		<rect x="10.5" y="6.25" width="3.5" height="3.5" fillOpacity={0.5} />
		<rect x="2" y="10.5" width="3.5" height="3.5" fillOpacity={0.25} />
		<rect x="6.25" y="10.5" width="3.5" height="3.5" fillOpacity={0.5} />
		<rect x="10.5" y="10.5" width="3.5" height="3.5" fillOpacity={0.85} />
	</svg>
)

const MapIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Globe outline with a meridian + equator, plus a filled location dot. */}
		<circle
			cx="8"
			cy="8"
			r="6"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.25}
		/>
		<ellipse
			cx="8"
			cy="8"
			rx="2.75"
			ry="6"
			fill="none"
			stroke="currentColor"
			strokeWidth={1}
			opacity={0.5}
		/>
		<line
			x1="2"
			y1="8"
			x2="14"
			y2="8"
			stroke="currentColor"
			strokeWidth={1}
			opacity={0.5}
		/>
		<circle cx="10.5" cy="5.5" r="1.75" />
	</svg>
)

const CirclesIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Packed circles: one enclosing ring with nested filled circles. */}
		<circle
			cx="8"
			cy="8"
			r="6.5"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.25}
		/>
		<circle cx="5.5" cy="9" r="3" fillOpacity={0.6} />
		<circle cx="11" cy="6.5" r="2.25" fillOpacity={0.85} />
		<circle cx="10.5" cy="11.25" r="1.5" fillOpacity={0.4} />
	</svg>
)

const TreemapIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Treemap mosaic: one large tile + smaller subdivided tiles. */}
		<rect x="2" y="2" width="7" height="12" fillOpacity={0.85} />
		<rect x="10" y="2" width="4" height="7" fillOpacity={0.5} />
		<rect x="10" y="10" width="4" height="4" fillOpacity={0.3} />
	</svg>
)

const SunburstIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Sunburst: filled hub wrapped by two concentric rings, each broken
		 * into arc segments with clear angular gaps so the ring structure
		 * stays legible at 16px (filled wedges mushed into a blob). */}
		<circle cx="8" cy="8" r="2" />
		<g fill="none" stroke="currentColor">
			<path d="M 8 3.7 A 4.3 4.3 0 0 1 11.72 10.15" strokeWidth={2} />
			<path
				d="M 10.15 11.72 A 4.3 4.3 0 0 1 5.24 4.71"
				strokeWidth={2}
				opacity={0.7}
			/>
			<path
				d="M 9.18 1.3 A 6.8 6.8 0 0 1 14.7 9.18"
				strokeWidth={1.6}
				opacity={0.45}
			/>
			<path
				d="M 13.21 12.37 A 6.8 6.8 0 0 1 3.63 13.21"
				strokeWidth={1.6}
				opacity={0.45}
			/>
			<path
				d="M 1.61 10.33 A 6.8 6.8 0 0 1 5.67 1.61"
				strokeWidth={1.6}
				opacity={0.45}
			/>
		</g>
	</svg>
)

const SankeyIcon = ({ className }: IconProps) => (
	<svg viewBox="0 0 16 16" className={className} aria-hidden="true">
		{/* Sankey: left/right node bars joined by crossing tapered flows. */}
		<rect x="2" y="2" width="2" height="5" />
		<rect x="2" y="9" width="2" height="5" />
		<rect x="12" y="3" width="2" height="4" />
		<rect x="12" y="9" width="2" height="4" />
		<path d="M 4 2 C 8 2, 8 3, 12 3 L 12 5 C 8 5, 8 4, 4 4 Z" fillOpacity={0.45} />
		<path d="M 4 5 C 8 5, 8 9, 12 9 L 12 11 C 8 11, 8 7, 4 7 Z" fillOpacity={0.3} />
		<path d="M 4 9 C 8 9, 8 5, 12 5 L 12 7 C 8 7, 8 11, 4 11 Z" fillOpacity={0.3} />
		<path d="M 4 12 C 8 12, 8 11, 12 11 L 12 13 C 8 13, 8 14, 4 14 Z" fillOpacity={0.45} />
	</svg>
)

const ICONS: Record<QuickStartChartType, (p: IconProps) => JSX.Element> = {
	bar: BarIcon,
	scatter: ScatterIcon,
	dumbbell: DumbbellIcon,
	line: LineIcon,
	area: AreaIcon,
	pie: PieIcon,
	radar: RadarIcon,
	violin: ViolinIcon,
	tile: TileIcon,
	map: MapIcon,
	circles: CirclesIcon,
	treemap: TreemapIcon,
	sunburst: SunburstIcon,
	sankey: SankeyIcon,
}

const LABELS: Record<QuickStartChartType, string> = {
	bar: "Bar chart",
	scatter: "Scatter plot",
	dumbbell: "Dumbbell chart",
	line: "Line chart",
	area: "Area chart",
	pie: "Pie chart",
	radar: "Radar chart",
	violin: "Violin / box plot",
	tile: "Tile heatmap",
	map: "Map",
	circles: "Packed circles",
	treemap: "Treemap",
	sunburst: "Sunburst",
	sankey: "Sankey diagram",
}

// Used only for the disabled-tooltip message. Derived from the channels the
// chart family's variations tend to require. Kept simple — the message is
// informational, not prescriptive.
const MISSING_TYPE_HINT: Record<QuickStartChartType, string> = {
	bar: "Needs at least one categorical field.",
	scatter: "Needs at least two quantitative fields.",
	dumbbell: "Needs a categorical field and a quantitative field.",
	line: "Needs a quantitative/temporal field plus a categorical connection field.",
	area: "Needs a quantitative/temporal field plus a categorical connection field.",
	pie: "Needs a categorical field and a quantitative field.",
	radar: "Needs a categorical field and a quantitative field.",
	violin: "Needs a categorical field and a quantitative field.",
	tile: "Needs two categorical fields and a quantitative field.",
	map: "Needs a geographic field (state/country names or codes) or latitude/longitude columns.",
	circles: "Needs a quantitative field and a categorical grouping field.",
	treemap: "Needs a quantitative field and a categorical grouping field.",
	sunburst: "Needs a quantitative field and a categorical grouping field.",
	sankey:
		"Needs a quantitative field and two categorical fields (flow source and target).",
}

// ----------------------------------------------------------------------------

export const QuickStartIconBar = () => {
	const dataset = useCurrentDatasetView()
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const [quickState, setQuickState] = useAtom(quickStartStateAtom)
	const setAnnotations = useSetAtom(currentAnnotationsAtom)
	const setDataLabels = useSetAtom(currentDataLabelsEncodingsAtom)
	const setMapConfig = useSetAtom(currentMapConfigAtom)
	const theme = useCurrentTheme()
	const [pending, setPending] = useState<Pending | null>(null)
	// Custom hover tooltip (instant, unlike the native `title` delay). Fixed
	// positioning so it escapes the sidebar's overflow-y-auto clipping; the
	// x-center is clamped so long labels don't run off the window edge.
	const [hovered, setHovered] = useState<{
		label: string
		x: number
		y: number
	} | null>(null)

	const fields = useMemo(() => dataset?.fields ?? [], [dataset])

	// Geographic content detection drives the Map icon. Unlike the other chart
	// families, map satisfiability depends on the dataset's VALUES (state /
	// country codes, lat-long ranges), not just field types — so it's sampled
	// from the rows here and threaded through the satisfiability checks.
	const geoDetection = useMemo(
		() =>
			dataset
				? detectGeoFields(dataset.fields, dataset.rows, overrides)
				: EMPTY_GEO_DETECTION,
		[dataset, overrides]
	)

	// Per-chart-type satisfiable variations, computed once per render. The
	// icon is disabled when the list is empty.
	const satisfiableByType = useMemo(() => {
		const map = new Map<QuickStartChartType, number[]>()
		for (const t of QUICK_START_CHART_TYPES) {
			map.set(t, satisfiableVariationIndices(t, fields, overrides, geoDetection))
		}
		return map
	}, [fields, overrides, geoDetection])

	const encodingsAreEmpty = (ALL_ENCODING_CHANNELS as EncodingChannel[]).every(
		(ch) => encodings[ch]?.field == null
	)

	// `pickIndex` produces a random field pick from the eligible list on each
	// scaffold click. Re-randomizing per call gives users fresh field
	// assignments every click, matching the "starting point" feature intent.
	const randomPickIndex = (eligible: readonly unknown[]) =>
		Math.floor(Math.random() * eligible.length)

	const scaffold = (chartType: QuickStartChartType, variationIndex: number) => {
		const variation = QUICK_START_VARIATIONS[chartType][variationIndex]
		if (!variation) return
		const assignments = assignFields(
			variation,
			fields,
			overrides,
			randomPickIndex,
			chartType,
			undefined,
			geoDetection
		)
		// `assignFields` can only return null if the variation is unsatisfiable.
		// The icon is disabled in that state, but guard anyway in case the
		// dataset changed between render and click.
		if (!assignments) return
		const {
			encodings: nextEncodings,
			configs: nextConfigs,
			dataLabels: nextDataLabels,
		} = applyVariation(variation, assignments, configs)
		// `applyVariation` always stamps a categorical hue config because most
		// variations target a categorical hue field. When the variation maps a
		// quantitative/temporal field to hue (e.g. tile heatmaps), we have to
		// override that with a quant config seeded from the user's theme
		// gradient — otherwise `makeHueScale` falls back to viridis until the
		// user expands the Hue panel and triggers its lazy init.
		const hueAssign = assignments.find((a) => a.channel === "hue")
		if (
			hueAssign &&
			(hueAssign.field.inferredType === "quantitative" ||
				hueAssign.field.inferredType === "temporal")
		) {
			nextConfigs.hue = buildQuantHueConfigFromTheme(theme)
		}
		setEncodings(nextEncodings)
		setConfigs(nextConfigs)
		// Data-labels encodings reset alongside the main encodings — empty
		// unless the variation opted in (see `dataLabelsValueFrom`), so labels
		// from the previous chart don't leak onto the new scaffold.
		setDataLabels(nextDataLabels)
		// Map scaffolds switch the coord system to geographic at the detected
		// geography level; every OTHER scaffold switches a leftover geographic
		// coord system off so the geo modes don't claim the new encodings.
		setMapConfig((prev) =>
			mapConfigForVariation(variation, assignments, geoDetection, prev)
		)
		// Scaffolding a fresh chart clears any rectangle annotations from
		// the previous configuration — they're anchored to specific axes /
		// value ranges, so leaving them in place would render them at
		// unintended coordinates on the new chart.
		setAnnotations(DEFAULT_ANNOTATIONS_CONFIG)
		setQuickState((prev) => ({
			cyclePositions: {
				...prev.cyclePositions,
				[chartType]: (prev.cyclePositions[chartType] ?? 0) + 1,
			},
			lastSetByScaffold: true,
		}))
	}

	const onIconClick = (chartType: QuickStartChartType) => {
		const satisfiable = satisfiableByType.get(chartType) ?? []
		const variationIndex = nextVariationIndex(
			quickState.cyclePositions[chartType] ?? 0,
			satisfiable
		)
		if (variationIndex == null) return // disabled; defensive

		// Skip the confirm prompt if nothing's there to protect (empty state)
		// or if what IS there was set by an earlier scaffold click and hasn't
		// been touched by the user since. A2-style: only warn when the user's
		// own work would be overwritten.
		if (encodingsAreEmpty || quickState.lastSetByScaffold) {
			scaffold(chartType, variationIndex)
			return
		}
		setPending({ chartType, variationIndex })
	}

	const confirmPending = () => {
		if (!pending) return
		scaffold(pending.chartType, pending.variationIndex)
		setPending(null)
	}
	const cancelPending = () => setPending(null)

	return (
		<div className="flex flex-col gap-2">
			{/* Auto-fill grid instead of a flex row: tracks shrink a touch
			    (2rem → 1.75rem) as the sidebar narrows, then buttons wrap to
			    the next line rather than squishing. Scales to more buttons. */}
			<div className="grid grid-cols-[repeat(auto-fill,minmax(1.75rem,2rem))] gap-1">
				{QUICK_START_CHART_TYPES.map((chartType) => {
					const Icon = ICONS[chartType]
					const satisfiable = satisfiableByType.get(chartType) ?? []
					const disabled = satisfiable.length === 0
					const tooltip = disabled
						? `${LABELS[chartType]} unavailable: ${MISSING_TYPE_HINT[chartType]}`
						: LABELS[chartType]
					return (
						<button
							key={chartType}
							type="button"
							disabled={disabled || !dataset}
							onClick={() => onIconClick(chartType)}
							onMouseEnter={(e) => {
								const rect = e.currentTarget.getBoundingClientRect()
								setHovered({
									label: tooltip,
									x: rect.left + rect.width / 2,
									y: rect.bottom,
								})
							}}
							onMouseLeave={() => setHovered(null)}
							aria-label={LABELS[chartType]}
							className="flex h-8 w-full items-center justify-center rounded border border-stone-300 bg-white text-stone-700 transition hover:enabled:scale-125 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
						>
							<Icon className="h-6 w-6 fill-current" />
						</button>
					)
				})}
			</div>
			{hovered && (
				<div
					key={hovered.label}
					ref={(el) => {
						// After layout, nudge the centered tooltip back inside the
						// window when it would spill past either edge (the sidebar
						// hugs the left edge, so short-center-x labels can overflow).
						if (!el) return
						const r = el.getBoundingClientRect()
						const overLeft = Math.max(0, 8 - r.left)
						const overRight = Math.max(0, r.right - (window.innerWidth - 8))
						const dx = overLeft - overRight
						if (dx !== 0)
							el.style.transform = `translateX(calc(-50% + ${dx}px))`
					}}
					className="pointer-events-none fixed z-50 max-w-56 -translate-x-1/2 rounded-md bg-white px-2 py-1 text-center text-xs font-medium text-th-electric-indigo-700 shadow-md ring-1 ring-stone-200"
					style={{ left: hovered.x, top: hovered.y + 6 }}
				>
					{hovered.label}
				</div>
			)}
			{pending && (
				<div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-stone-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-stone-200">
					<div>
						Replace the current encoding with a{" "}
						<span className="font-medium">{LABELS[pending.chartType]}</span>{" "}
						starting point? Your current encoding will be overwritten.
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={confirmPending}
							className="rounded bg-stone-800 px-3 py-1 text-sm font-medium text-white hover:bg-stone-700 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300"
						>
							Replace
						</button>
						<button
							type="button"
							onClick={cancelPending}
							className="rounded border border-stone-300 px-3 py-1 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
						>
							Keep current
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
