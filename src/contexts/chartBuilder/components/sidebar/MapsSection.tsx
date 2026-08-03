import { useState } from "react"
import { useAtom } from "jotai"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Toggle } from "../../../../components/ui/Toggle"
import {
	FOCUS_REGION_LABELS,
	levelDefaultViewport,
	regionViewport,
} from "../../lib/geo/focusRegion"
import {
	DEFAULT_MAP_CONFIG,
	FOCUS_REGIONS,
	GEOGRAPHY_LEVELS,
	PROJECTIONS,
	type CoordSystemKind,
	type FocusRegion,
	type GeographyLevel,
	type MapConfig,
	type ProjectionName,
	type RegionKeyType,
} from "../../lib/mapConfig"
import { currentMapConfigAtom } from "../../store/atoms"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useGeoResolution } from "../../store/useGeoResolution"

const LABEL_COL = "w-24 text-stone-600 dark:text-stone-400"

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
	abbrev: "Abbreviation",
	iso: "ISO code",
	name: "Name",
}

const projectionOptions: { value: ProjectionName | "auto"; label: string }[] = [
	{ value: "auto", label: "Auto" },
	...PROJECTIONS.map((p) => ({ value: p, label: PROJECTION_LABELS[p] })),
]

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
	...(["fips", "abbrev", "iso", "name"] as const).map((k) => ({
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

/** Single-select segmented control for the coordinate system — the master
 *  switch. No map (the neutral default) and Cartesian both render the usual x/y
 *  plots; Geographic draws maps. Modeled on the Distribution-type segmented
 *  control in AxisOptionsPanel so the two read the same. */
const CoordSystemToggle = ({
	value,
	onChange,
}: {
	value: CoordSystemKind
	onChange: (next: CoordSystemKind) => void
}) => {
	const segments: { key: CoordSystemKind; label: string }[] = [
		{ key: "noMap", label: "No map" },
		{ key: "cartesian", label: "Cartesian" },
		{ key: "geographic", label: "Geographic" },
	]
	const segBase =
		"px-2 py-1 text-sm border-l first:border-l-0 border-stone-300 dark:border-stone-700"
	const segClass = (active: boolean) =>
		active
			? `${segBase} bg-brand-500 text-white`
			: `${segBase} bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700`
	return (
		<div
			role="radiogroup"
			aria-label="Coordinate system"
			className="inline-flex self-start overflow-hidden rounded border border-stone-300 dark:border-stone-700"
		>
			{segments.map((s) => (
				<button
					key={s.key}
					type="button"
					role="radio"
					aria-checked={value === s.key}
					onClick={() => onChange(s.key)}
					className={segClass(value === s.key)}
				>
					{s.label}
				</button>
			))}
		</div>
	)
}

/** Read-only join summary: "{matched} of {total} matched" plus an optional
 *  "{n} unmatched (show)" disclosure that reveals the unmatched values. Helper
 *  prose on the light-purple panel uses `text-th-electric-indigo-700` (the base
 *  500 fails AA against the panel background). */
const MatchStatus = () => {
	const { matchedCount, unmatched, total, loading } = useGeoResolution()
	const [showList, setShowList] = useState(false)

	if (loading) {
		return (
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				Checking matches…
			</p>
		)
	}
	if (total === 0) {
		return (
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				Map a region field to the Connection channel to see match status.
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-1">
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
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
				<ul className="list-inside list-disc text-xs text-th-electric-indigo-700 dark:text-stone-400">
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

	// Resolve the active mode the same way the render path does, so each
	// geographic toggle can be contextual to the kind of map in play.
	const modeId = useChartModeDef().id

	const update = (next: Partial<MapConfig>) =>
		setMapConfig((prev) => ({ ...prev, ...next }))

	// Changing the Focus dropdown. Switching to "Custom" seeds the draggable
	// viewport "from the current view" — the active region's box, or a sensible
	// default for the geography level — but only the first time (so re-selecting
	// Custom doesn't blow away a viewport the user already dragged).
	const onFocusChange = (next: FocusRegion | "auto" | "custom") => {
		if (next === "custom" && !mapConfig.customViewport) {
			const prev = mapConfig.focusRegion
			const seed =
				prev !== "auto" && prev !== "custom"
					? regionViewport(prev)
					: levelDefaultViewport(mapConfig.geographyLevel)
			update({ focusRegion: next, customViewport: seed })
		} else {
			update({ focusRegion: next })
		}
	}

	// "Reset view" for custom focus: re-seed from the geography-level default.
	const resetCustomView = () =>
		update({ customViewport: levelDefaultViewport(mapConfig.geographyLevel) })

	// "Fill regions with no data" is a choropleth-only concern (filling unjoined
	// polygons). "Show basemap" is a bubble/symbol-map concern (drawing the
	// geography behind the marks). Both modes already imply geographic coords.
	const showFillNoDataToggle = modeId === "geo-choropleth"
	// Both the bubble map (geo-symbols) and the dot map (geo-points) draw a basemap.
	const showBasemapToggle = ["geo-symbols", "geo-points"].includes(modeId)
	// The "No-data fill" COLOR is reachable wherever that color is actually
	// painted on screen: choropleth (unjoined polygons) OR a bubble/symbol map
	// whose basemap is on (GeoSymbolPlot paints the basemap with noDataFill). The
	// toggle above stays choropleth-only, but the color control follows the pixels.
	const showNoDataFillColor =
		showFillNoDataToggle || (showBasemapToggle && mapConfig.showBasemap)

	// Effective geography level — "auto" resolves to states (mirrors the
	// renderer). Used to gate the geography-aware helper notes below.
	const effectiveLevel: GeographyLevel =
		mapConfig.geographyLevel === "auto" ? "states" : mapConfig.geographyLevel

	// States + countries are implemented; "auto" resolves to states, so it's
	// fine. Counties / zcta still render a blank map today, so warn instead of
	// silently blanking.
	const isUnimplementedLevel =
		effectiveLevel === "counties" || effectiveLevel === "zcta"

	// Natural Earth and Mercator are *world* projections; fitting them to the US
	// (Alaska crosses the antimeridian, plus far-flung Pacific/Caribbean
	// territories) balloons the bounds so the lower-48 renders tiny. Albers USA
	// ("Auto" for US geographies) is the purpose-built US projection. For world
	// countries those projections are CORRECT, so only surface the tiny-US note
	// when a world projection is paired with a US geography level.
	const isWorldProjection =
		mapConfig.projection === "naturalEarth" ||
		mapConfig.projection === "mercator"
	// A focus region overrides the projection to a world one anyway and pans
	// away from the full US, so the tiny-US note no longer applies.
	const showUsTinyNote =
		isWorldProjection &&
		effectiveLevel !== "countries" &&
		mapConfig.focusRegion === "auto"

	// On a point map (geo-points) the x/y channels carry geographic
	// coordinates, not arbitrary axes — spell out the convention so users map
	// the right fields. Other map modes key off `connection`, not x/y.
	const showLonLatHint = modeId === "geo-points"

	// Country geometry uses Natural-Earth SHORT names ("Dem. Rep. Congo",
	// "Bosnia and Herz."), so joining by full country name often misses. Steer
	// users toward ISO codes, which join reliably.
	const showCountryNameHint = effectiveLevel === "countries"

	return (
		<div className="vc-option-panel flex flex-col gap-3">
			<CollapsibleSubsection title="Coordinate system" defaultOpen>
				<CoordSystemToggle
					value={mapConfig.coordSystem}
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
						{showUsTinyNote && (
							<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
								Natural Earth and Mercator are world projections, best
								suited to country maps. US geographies render best with
								Albers USA (Auto) — other projections fit the US to its
								far-flung territories and Alaska, shrinking the lower-48.
							</p>
						)}
						{showLonLatHint && (
							<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
								On point maps, X = longitude and Y = latitude.
							</p>
						)}
						<SelectInput
							label="Geography level"
							labelClassName={LABEL_COL}
							value={mapConfig.geographyLevel}
							options={geographyLevelOptions}
							onChange={(geographyLevel) => update({ geographyLevel })}
							selectClassName="min-w-0 flex-1"
						/>
						{isUnimplementedLevel && (
							<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
								Only US states are available so far — more geographies are
								coming.
							</p>
						)}
						<SelectInput
							label="Focus"
							labelClassName={LABEL_COL}
							value={mapConfig.focusRegion}
							options={focusRegionOptions}
							onChange={onFocusChange}
							selectClassName="min-w-0 flex-1"
						/>
						{mapConfig.focusRegion === "custom" ? (
							<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
								Drag the map to pan; scroll or pinch to zoom (or Ctrl +
								↑/↓); arrow keys also pan.{" "}
								<button
									type="button"
									onClick={resetCustomView}
									className="underline hover:opacity-80"
								>
									Reset view
								</button>
							</p>
						) : mapConfig.focusRegion !== "auto" ? (
							<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
								Centers the map on{" "}
								{FOCUS_REGION_LABELS[mapConfig.focusRegion]}. Drag or
								scroll to fine-tune the view. Uses a world projection
								(Mercator if chosen, otherwise Natural Earth).
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
							<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
								Country names must match our spelling exactly (e.g. &quot;Dem.
								Rep. Congo&quot;). ISO codes (USA, FR, 840) join most reliably.
							</p>
						)}
						{showBasemapToggle && (
							<div className="flex items-start gap-2">
								<span className={`${LABEL_COL} shrink-0`} aria-hidden />
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<Toggle
										label="Show basemap"
										checked={mapConfig.showBasemap}
										onChange={(showBasemap) =>
											update({ showBasemap })
										}
									/>
									<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
										Draw the geography outlines behind the marks.
									</p>
								</div>
							</div>
						)}
						{showFillNoDataToggle && (
							<div className="flex items-start gap-2">
								<span
									className={`${LABEL_COL} shrink-0`}
									aria-hidden
								/>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<Toggle
										label="Fill regions with no data"
										checked={mapConfig.showNoDataRegions}
										onChange={(showNoDataRegions) =>
											update({ showNoDataRegions })
										}
									/>
									<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
										When on, regions with no matching data are filled
										with the no-data color; when off, only regions
										with data are drawn.
									</p>
								</div>
							</div>
						)}
						{showNoDataFillColor && (
							<div className="flex items-center gap-2">
								<ColorInput
									label="No-data fill"
									labelClassName={LABEL_COL}
									value={mapConfig.noDataFill}
									onChange={(noDataFill) => update({ noDataFill })}
									className="contents"
								/>
								{mapConfig.noDataFill !==
									DEFAULT_MAP_CONFIG.noDataFill && (
									<button
										type="button"
										onClick={() =>
											update({
												noDataFill:
													DEFAULT_MAP_CONFIG.noDataFill,
											})
										}
										className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
									>
										reset
									</button>
								)}
							</div>
						)}
					</div>
				</CollapsibleSubsection>
			)}
		</div>
	)
}
