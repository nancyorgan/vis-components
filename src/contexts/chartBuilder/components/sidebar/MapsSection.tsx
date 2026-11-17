import { useState } from "react"
import { useAtom } from "jotai"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import {
	LABEL_COL,
	LabelSpacer,
	LabeledChipRow,
} from "../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { Segmented } from "../../../../components/ui/Segmented"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../components/ui/Checkbox"
import {
	FOCUS_REGION_LABELS,
	levelDefaultViewport,
	focusRegionPatch,
} from "../../lib/geo/focusRegion"
import {
	FOCUS_REGIONS,
	GEOGRAPHY_LEVELS,
	PROJECTIONS,
	type CoordSystemKind,
	type FocusRegion,
	type GeographyLevel,
	type GeoViewport,
	type MapConfig,
	type ProjectionName,
	type RegionKeyType,
} from "../../lib/mapConfig"
import { PatternTile } from "../../lib/patternDefs"
import { PATTERN_PALETTE } from "../../lib/patterns"
import {
	CustomPatternChips,
	CustomPatternEditor,
} from "./channelOptions/customPatternEditor"
import { swatchChipClass } from "./channelOptions/glyphShared"
import { mapConfigFromTheme } from "../../lib/themeConfig"
import { currentMapConfigAtom } from "../../store/atoms"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { useCustomPatternEdits } from "../../store/useCustomPatternEdits"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useAutoFitViewport } from "../../store/useAutoFitViewport"
import { useEffectiveGeographyLevel } from "../../store/useEffectiveGeographyLevel"
import { useGeoOutsideCount } from "../../store/useGeoOutsideCount"
import { useGeoResolution } from "../../store/useGeoResolution"


const PROJECTION_LABELS: Record<ProjectionName, string> = {
	albersUsa: "Albers USA",
	naturalEarth: "Natural Earth",
	mercator: "Mercator",
}

const GEOGRAPHY_LEVEL_LABELS: Record<GeographyLevel, string> = {
	states: "US States",
	counties: "US Counties",
	zcta: "US ZIP/ZCTA",
	countries: "World Countries",
}

const KEY_TYPE_LABELS: Record<RegionKeyType, string> = {
	fips: "FIPS code",
	zip: "ZIP code",
	abbrev: "Abbreviation",
	iso: "ISO code",
	name: "Name",
}

const projectionOptions: { value: ProjectionName | "auto"; label: string }[] = [
	{ value: "auto", label: "Auto" },
	...PROJECTIONS.map((p) => ({ value: p, label: PROJECTION_LABELS[p] })),
]

/** Live preview tile for one no-data pattern chip: the pattern's tile drawn
 *  with the CURRENT no-data fill as background and the current ink, so the
 *  picker shows exactly what the map will paint. Mirrors GlyphPickerPanel's
 *  PatternGlyph, sized for the Maps section's h-7 chip buttons. */
const NoDataPatternChip = ({
	idx,
	bg,
	ink,
}: {
	idx: number
	bg: string
	ink: string
}) => {
	const uniqueId = `maps-nodata-chip-${idx}`
	return (
		<svg width={20} height={20} aria-hidden="true">
			<defs>
				<PatternTile id={uniqueId} paletteIdx={idx} bgColor={bg} inkColor={ink} />
			</defs>
			<rect
				width={20}
				height={20}
				fill={`url(#${uniqueId})`}
				stroke="#d6d3d1"
				strokeWidth={0.5}
			/>
		</svg>
	)
}

const geographyLevelOptions: { value: GeographyLevel | "auto"; label: string }[] =
	[
		{ value: "auto", label: "Auto" },
		...GEOGRAPHY_LEVELS.map((g) => ({
			value: g,
			label: GEOGRAPHY_LEVEL_LABELS[g],
		})),
	]

const keyTypeOptions: { value: RegionKeyType | "auto"; label: string }[] = [
	{ value: "auto", label: "Auto" },
	...(["fips", "zip", "abbrev", "iso", "name"] as const).map((k) => ({
		value: k,
		label: KEY_TYPE_LABELS[k],
	})),
]

const focusRegionOptions: {
	value: FocusRegion | "auto" | "custom"
	label: string
}[] = [
	{ value: "auto", label: "Whole map (auto)" },
	...FOCUS_REGIONS.map((r) => ({ value: r, label: FOCUS_REGION_LABELS[r] })),
	{ value: "custom", label: "Custom (drag to center)" },
]

/** The coordinate-system master switch, on the shared `Segmented` control.
 *  No map (the default) renders the usual x/y plots; Geographic draws maps. */
const COORD_SYSTEM_SEGMENTS: ReadonlyArray<{ key: CoordSystemKind; label: string }> = [
	{ key: "noMap", label: "No map" },
	{ key: "geographic", label: "Geographic" },
]

/** Read-only join summary: "{matched} of {total} matched" plus an optional
 *  "{n} unmatched (show)" disclosure that reveals the unmatched values. Helper
 *  prose on the light-purple panel uses `text-vc-brand-text` (the base
 *  500 fails AA against the panel background). */
const MatchStatus = () => {
	const { matchedCount, unmatched, total, loading } = useGeoResolution()
	const [showList, setShowList] = useState(false)

	if (loading) {
		return (
			<p className="vc-help">
				Checking matches…
			</p>
		)
	}
	if (total === 0) {
		return (
			<p className="vc-help">
				Map a region field to the Connection channel to generate a map.
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-1">
			<p className="vc-help">
				{matchedCount} of {total} matched
				{unmatched.length > 0 && (
					<>
						{" — "}
						{unmatched.length} unmatched{" "}
						<button
							type="button"
							onClick={() => setShowList((s) => !s)}
							className="underline hover:opacity-80"
						>
							({showList ? "hide" : "show"})
						</button>
					</>
				)}
			</p>
			{showList && unmatched.length > 0 && (
				<ul className="list-inside list-disc vc-help">
					{unmatched.map((v) => (
						<li key={v}>{v}</li>
					))}
				</ul>
			)}
		</div>
	)
}

/**
 * The Maps section — the user-facing control surface for geographic charts.
 * The Coordinate system toggle is the master switch; the projection / level /
 * region key / match-status / no-data controls only appear in Geographic mode.
 * Reads/writes `currentMapConfigAtom`; the Connection shelf elsewhere picks
 * WHICH field is the region. Follows AxisOptionsPanel conventions (purple
 * `.vc-option-panel` root, white-card subsections, `w-24` label column,
 * indigo-700 helper text, no inner scroll).
 */
export const MapsSection = () => {
	const [mapConfig, setMapConfig] = useAtom(currentMapConfigAtom)
	// No-data colors reset to the THEME's defaults (Settings → Themes → Maps),
	// the same values a new visual and a theme switch install.
	const themeMapDefaults = mapConfigFromTheme(useCurrentTheme())

	// Resolve the active mode the same way the render path does, so each
	// geographic toggle can be contextual to the kind of map in play. The
	// kind is the mode's declared `canvas.geo` trait (absent off the map) —
	// never a mode id.
	const geo = useChartModeDef().canvas.geo
	// The joined polygons ARE the marks (choropleth): unjoined regions are
	// either filled with the no-data color or not drawn at all.
	const regionMarks = geo?.marks === "regions"
	// Point marks over an optional basemap (bubble map / dot map).
	const symbolMarks = geo?.marks === "symbols"

	const update = (next: Partial<MapConfig>) =>
		setMapConfig((prev) => ({ ...prev, ...next }))

	// The no-data pattern's custom patterns: the chart's one uploaded list,
	// shared with the Pattern menu (`useCustomPatternEdits`), and whether its
	// "+" chip's upload editor is open.
	const { customPatterns, addCustomPattern, deleteCustomPattern } =
		useCustomPatternEdits()
	const [patternEditorOpen, setPatternEditorOpen] = useState(false)

	// Where "Whole map (auto)" is framing right now, when that's just the
	// data-bearing regions: the choropleth with "Fill regions with no data" off
	// draws only matched regions, so auto frames those (the same rule the
	// renderer applies via useGeoMapScaffold's `fitToMatchedRegions`). Null
	// whenever auto frames the whole geometry. Seeds Custom / "Reset view" so
	// they start from the view on screen rather than jumping to the level
	// default, and gates the explanatory note under the Focus control.
	const autoFitViewport = useAutoFitViewport(
		regionMarks && !mapConfig.showNoDataRegions
	)
	const autoViewport = (): GeoViewport =>
		autoFitViewport ?? levelDefaultViewport(mapConfig.geographyLevel)

	// Changing the Focus dropdown. Switching to "Custom" seeds the draggable
	// viewport "from the current view" — the active region's box, or a sensible
	// default for the geography level — but only the first time (so re-selecting
	// Custom doesn't blow away a viewport the user already dragged).
	const onFocusChange = (next: FocusRegion | "auto" | "custom") =>
		update(focusRegionPatch(mapConfig, next, autoViewport))

	// "Reset view" for custom focus: re-seed from what auto would show (the
	// data frame when only data regions draw, else the level default).
	const resetCustomView = () => update({ customViewport: autoViewport() })

	// "Fill regions with no data" is a region-mark concern (filling unjoined
	// polygons). "Show basemap" is a symbol-mark concern (drawing the
	// geography behind the marks). Both already imply geographic coords.
	const showFillNoDataToggle = regionMarks
	// Both the bubble map and the dot map draw marks over a basemap.
	const showBasemapToggle = symbolMarks
	// The "No-data fill" COLOR is reachable wherever that color is actually
	// painted on screen: choropleth (unjoined polygons) OR a bubble/symbol map
	// whose basemap is on (GeoSymbolPlot paints the basemap with noDataFill). The
	// toggle above stays choropleth-only, but the color control follows the pixels.
	const showNoDataFillColor =
		showFillNoDataToggle || (showBasemapToggle && mapConfig.showBasemap)

	// Effective geography level — the shared hook resolves "auto" by scoring
	// the connection values against each level (null while detecting). Gates
	// the geography-aware helper notes below; while detection is in flight,
	// fall back to states so the notes don't flash a wrong level.
	const detectedLevel = useEffectiveGeographyLevel()
	const effectiveLevel: GeographyLevel = detectedLevel ?? "states"

	// Surface what Auto resolved to right in the dropdown ("Auto (US
	// Counties)") so an auto-detected level is never a mystery.
	const levelOptions =
		mapConfig.geographyLevel === "auto" && detectedLevel
			? geographyLevelOptions.map((o) =>
					o.value === "auto"
						? {
								...o,
								label: `Auto (${GEOGRAPHY_LEVEL_LABELS[detectedLevel]})`,
							}
						: o
				)
			: geographyLevelOptions

	// Point marks the projection silently drops: albersUsa returns null for
	// anything outside the US, so world-wide dots (or joined-region centroids
	// on the bubble map) just vanish. `useGeoResolution` explains rows that
	// didn't JOIN; this is its projection-side companion for the mark modes.
	// Rendered only when at least one mark actually dropped (inert otherwise).
	const outsideCount = useGeoOutsideCount()

	// Country geometry uses Natural-Earth SHORT names ("Dem. Rep. Congo",
	// "Bosnia and Herz."), so joining by full country name often misses. Steer
	// users toward ISO codes, which join reliably.
	const showCountryNameHint = effectiveLevel === "countries"

	return (
		<div className="vc-option-panel">
			<CollapsibleSubsection title="Coordinate system" defaultOpen>
				<Segmented
					ariaLabel="Coordinate system"
					value={mapConfig.coordSystem}
					segments={COORD_SYSTEM_SEGMENTS}
					onChange={(coordSystem) => update({ coordSystem })}
				/>
			</CollapsibleSubsection>

			{mapConfig.coordSystem === "geographic" && (
				<CollapsibleSubsection title="Geography" defaultOpen>
					<div className="flex flex-col gap-3">
						<SelectInput
							label="Projection"
							labelClassName={LABEL_COL}
							value={mapConfig.projection}
							options={projectionOptions}
							onChange={(projection) => update({ projection })}
							selectClassName="min-w-0 flex-1"
						/>
						{outsideCount.outside > 0 && (
							<p className="vc-help">
								{outsideCount.outside} of {outsideCount.total}{" "}
								{outsideCount.kind === "regions" ? "regions" : "points"}{" "}
								{outsideCount.outside === 1 ? "falls" : "fall"} outside
								the mapped area and{" "}
								{outsideCount.outside === 1 ? "isn't" : "aren't"} shown.
								{outsideCount.projection === "albersUsa" &&
									" Albers USA covers only the US; choose the Natural Earth or Mercator projection to show them."}
							</p>
						)}
						<SelectInput
							label="Geography level"
							labelClassName={LABEL_COL}
							value={mapConfig.geographyLevel}
							options={levelOptions}
							onChange={(geographyLevel) => update({ geographyLevel })}
							selectClassName="min-w-0 flex-1"
						/>
						<SelectInput
							label="Focus"
							labelClassName={LABEL_COL}
							value={mapConfig.focusRegion}
							options={focusRegionOptions}
							onChange={onFocusChange}
							selectClassName="min-w-0 flex-1"
						/>
						{mapConfig.focusRegion === "custom" ? (
							<p className="vc-help">
								Drag the map or use arrow keys to pan; scroll or pinch to
								zoom.{" "}
								<button
									type="button"
									onClick={resetCustomView}
									className="underline hover:opacity-80"
								>
									Reset view
								</button>
							</p>
						) : mapConfig.focusRegion !== "auto" ? (
							<p className="vc-help">
								Centers the map on{" "}
								{FOCUS_REGION_LABELS[mapConfig.focusRegion]}. Drag or
								scroll to fine-tune the view.
							</p>
						) : autoFitViewport !== null ? (
							<p className="vc-help">
								Framing just the regions with data. Turn on &quot;Fill
								regions with no data&quot; to show the whole map.
							</p>
						) : null}
						<SelectInput
							label="Region key"
							labelClassName={LABEL_COL}
							value={mapConfig.keyType}
							options={keyTypeOptions}
							onChange={(keyType) => update({ keyType })}
							selectClassName="min-w-0 flex-1"
						/>
						<MatchStatus />
						{showCountryNameHint && (
							<p className="vc-help">
								Country names must match exactly. ISO codes (USA, FR, 840)
								join most reliably.
							</p>
						)}
						{showBasemapToggle && (
							<div className="flex items-center gap-2">
								<LabelSpacer />
								<Checkbox
									label="Show basemap"
									checked={mapConfig.showBasemap}
									onChange={(showBasemap) => update({ showBasemap })}
								/>
							</div>
						)}
						{showFillNoDataToggle && (
							<div className="flex items-center gap-2">
								<LabelSpacer />
								<Checkbox
									label="Fill regions with no data"
									checked={mapConfig.showNoDataRegions}
									onChange={(showNoDataRegions) =>
										update({ showNoDataRegions })
									}
								/>
							</div>
						)}
						{showNoDataFillColor && (
							<div className="flex flex-wrap items-center gap-2">
								<ColorInput
									label="No-data fill"
									labelClassName={LABEL_COL}
									value={mapConfig.noDataFill}
									onChange={(noDataFill) => update({ noDataFill })}
									className="contents"
								/>
								{mapConfig.noDataFill !==
									themeMapDefaults.noDataFill && (
									<ResetLink
										ariaLabel="Reset no-data fill"
										onClick={() =>
											update({
												noDataFill:
													themeMapDefaults.noDataFill,
											})
										}
									/>
								)}
							</div>
						)}
						{showNoDataFillColor && (
							// The chips start on the label's line and wrap under
							// the first chip (`LabeledChipRow`, the Pattern menu's
							// rows too). After the built-ins: the chart's custom
							// patterns and the "+" that uploads one.
							<LabeledChipRow
								label="No-data pattern"
								chips={
									<>
										<button
											type="button"
											onClick={() => update({ noDataPattern: null })}
											aria-pressed={mapConfig.noDataPattern === null}
											className={swatchChipClass(mapConfig.noDataPattern === null, "px-2 text-sm")}
										>
											None
										</button>
										{PATTERN_PALETTE.map((_, idx) => {
											const selected = idx === mapConfig.noDataPattern
											return (
												<button
													// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
													key={idx}
													type="button"
													onClick={() => update({ noDataPattern: idx })}
													aria-pressed={selected}
													aria-label={`No-data pattern option ${idx + 1}`}
													className={swatchChipClass(selected, "w-7")}
												>
													<NoDataPatternChip
														idx={idx}
														bg={mapConfig.noDataFill}
														ink={mapConfig.noDataPatternInk}
													/>
												</button>
											)
										})}
										<CustomPatternChips
											patterns={customPatterns}
											activeIdx={mapConfig.noDataPattern}
											onPick={(idx) => update({ noDataPattern: idx })}
											onDelete={deleteCustomPattern}
											onAdd={() => setPatternEditorOpen((open) => !open)}
											inkColor={mapConfig.noDataPatternInk}
											bgColor={mapConfig.noDataFill}
											ariaName="No-data pattern option"
										/>
									</>
								}
							>
								{patternEditorOpen && (
									<CustomPatternEditor
										onCreate={(p) =>
											addCustomPattern(p, (idx) =>
												update({ noDataPattern: idx })
											)
										}
										onClose={() => setPatternEditorOpen(false)}
										scalable={false}
									/>
								)}
							</LabeledChipRow>
						)}
						{showNoDataFillColor && mapConfig.noDataPattern !== null && (
							<div className="flex flex-wrap items-center gap-2">
								<ColorInput
									label="Pattern ink"
									labelClassName={LABEL_COL}
									value={mapConfig.noDataPatternInk}
									onChange={(noDataPatternInk) =>
										update({ noDataPatternInk })
									}
									className="contents"
								/>
								{mapConfig.noDataPatternInk !==
									themeMapDefaults.noDataPatternInk && (
									<ResetLink
										ariaLabel="Reset pattern ink"
										onClick={() =>
											update({
												noDataPatternInk:
													themeMapDefaults.noDataPatternInk,
											})
										}
									/>
								)}
							</div>
						)}
					</div>
				</CollapsibleSubsection>
			)}
		</div>
	)
}
