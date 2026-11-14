import { useMemo } from "react"
import { useAtom, useAtomValue } from "jotai"

import {
	DEFAULT_DENSITY_CURVE_WIDTH,
	DEFAULT_LENGTH_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_SEGMENT_THICKNESS,
	DEFAULT_SHAPE_CONFIG,
	type ConnectionConfig,
	type LengthConfig,
	type RegressionConfig,
	type ShapeConfig,
} from "../../../lib/channelConfig"
import { MIN_LINE_THICKNESS } from "../../../lib/connectionThickness"
import { effectiveType } from "../../../lib/fieldType"
import { sizeSections, type SizeSection } from "../../../lib/markParts"
import {
	axisConfigFromTheme,
	connectionConfigFromTheme,
	shapeConfigFromTheme,
	valueChanged,
} from "../../../lib/themeConfig"
import { fieldLevels, thicknessByLevel } from "../../../lib/thicknessVaryBy"
import type { FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useDrawnParts, usePartsContext } from "../../../store/usePartsContext"
import { useVaryByFieldFilter } from "../../../store/useVaryByFieldFilter"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"

/** The Size row's thickness sections: one per stroke the chart draws
 *  (`sizeSections`, lib/markParts). Every thickness lives here — the
 *  marks' outline, the connecting line, stems, line segments, the violin /
 *  box strokes, the regression line — so "how thick is it?" has one place
 *  to look, beside "how big is it?". Each section is the same control: a
 *  single value, or, where the stroke can differ from mark to mark, a
 *  "Vary by" variable with one value per level. */

/** The jump target of a thickness section, for links from the panels the
 *  thickness used to live in (`channelJump("area", sizeJumpId("line"))`). */
export const sizeJumpId = (kind: SizeSection["kind"]): string => `size:${kind}`

/** Variable types a thickness "Vary by" offers: discrete levels only — a
 *  quantitative column would list one row per distinct number. */
const VARY_BY_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(["categorical", "ordinal"])

/** One stroke's thickness, wherever it is stored. */
type ThicknessModel = {
	/** The stroke, for the per-level inputs' accessible names ("Line
	 *  thickness for East") and the reset link. */
	noun: string
	value: number
	/** What the reset link returns the single value to. */
	resetTo: number
	changed: boolean
	min: number
	max?: number
	/** Snap typed values into [min, max] instead of ignoring them. */
	clamp?: boolean
	set: (n: number) => void
	/** Back to the default, where that is "follow another part" and not a
	 *  number to write (a dot map's regions follow its points). Absent =
	 *  `set(resetTo)`. */
	reset?: () => void
	/** Present where the stroke's storage can hold one value per level of a
	 *  variable. Whether "Vary by" is OFFERED is the section's
	 *  (`SizeSection.varyBy`): a line can vary, an area chart's cannot. */
	varyBy?: {
		/** The variable in effect (null = one thickness). */
		field: string | null
		/** The variables offered. */
		fields: string[]
		levels: string[]
		byValue: Record<string, number>
		pick: (field: string | null) => void
		setFor: (level: string, n: number) => void
	}
}

/** Field types and levels of the data set being charted. */
const useFieldLevels = () => {
	const dataset = useCurrentDatasetView()
	const fieldOverrides = useAtomValue(currentFieldOverridesAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const typeOf = (name: string): FieldType =>
		dataset ? effectiveType(dataset, name, fieldOverrides) : "categorical"
	return {
		has: (name: string): boolean => !!dataset?.fields.some((f) => f.name === name),
		names: (dataset?.fields ?? []).map((f) => f.name),
		typeOf,
		// Distinct levels in the Fields panel's pinned order, parsed through
		// the effective type so the keys match what the renderers key on.
		levelsOf: (name: string): string[] =>
			dataset ? fieldLevels(dataset.rows, name, typeOf(name), levelOrders[name]) : [],
	}
}

/** The connecting line's thickness (`connection.thickness`). The stems
 *  follow it until they are given one of their own.
 *
 *  The "Vary by" position is DERIVED: `thicknessField` names the variable
 *  when one was picked; visuals saved before it existed carry only a
 *  populated `thicknessByValue`, which means "vary by the connection
 *  field". A stored field that is gone from the data set draws as a single
 *  thickness, so it reads that way. */
const useLineThickness = (noun: string): ThicknessModel => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fields = useFieldLevels()

	const themeCfg = connectionConfigFromTheme(theme)
	const cfg: ConnectionConfig = { ...themeCfg, ...configs.connection }
	// Seed untouched fields from the THEME so the stored slice matches the
	// "changed" dot's baseline.
	const update = (next: Partial<ConnectionConfig>) =>
		setConfigs((prev) => ({
			...prev,
			connection: { ...connectionConfigFromTheme(theme), ...prev.connection, ...next },
		}))

	const connectionField = encodings.connection?.field ?? null
	const byValue = configs.connection?.thicknessByValue
	const stored = configs.connection?.thicknessField ?? null
	const field: string | null = stored
		? fields.has(stored)
			? stored
			: null
		: byValue && Object.keys(byValue).length > 0
			? connectionField
			: null

	return {
		noun,
		value: cfg.thickness,
		resetTo: themeCfg.thickness,
		changed:
			valueChanged(configs.connection?.thickness, theme.connectionThickness) || field !== null,
		min: MIN_LINE_THICKNESS,
		// Negative typed input is ignored rather than snapped; 0 hides the
		// line (thickness is the switch).
		set: (n) => {
			if (n >= 0) update({ thickness: n })
		},
		varyBy: {
					field,
					// The connection field is always offered: a line's thickness
					// is looked up off its first row, so any variable constant
					// within a line works, and the one the lines are grouped by
					// always is.
					fields: fields.names.filter(
						(name) =>
							name === connectionField ||
							name === field ||
							VARY_BY_TYPES.has(fields.typeOf(name))
					),
					levels: field ? fields.levelsOf(field) : [],
					byValue: byValue ?? {},
					// Picking a variable SEEDS every level at the single value
					// (identical until one is edited); "— none —" clears both.
					pick: (next) =>
						update(
							next === null
								? { thicknessField: null, thicknessByValue: {} }
								: {
										thicknessField: next,
										thicknessByValue: thicknessByLevel(fields.levelsOf(next), cfg.thickness),
									}
						),
					setFor: (level, n) => {
						if (n >= 0) update({ thicknessByValue: { ...(byValue ?? {}), [level]: n } })
					},
				},
	}
}

/** Line segments' thickness (`length.segmentThickness`), single or by a
 *  variable. */
const useSegmentThickness = (noun: string): ThicknessModel => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const fields = useFieldLevels()
	const length = configs.length ?? DEFAULT_LENGTH_CONFIG
	const thickness = length.segmentThickness ?? DEFAULT_SEGMENT_THICKNESS
	const update = (next: Partial<LengthConfig>) =>
		setConfigs((prev) => ({
			...prev,
			length: { ...(prev.length ?? DEFAULT_LENGTH_CONFIG), ...next },
		}))
	const stored = length.segmentThicknessField ?? null
	const field = stored && fields.has(stored) ? stored : null
	return {
		noun,
		value: thickness,
		resetTo: DEFAULT_SEGMENT_THICKNESS,
		changed: thickness !== DEFAULT_SEGMENT_THICKNESS || !!field,
		min: MIN_LINE_THICKNESS,
		// Negative typed input is ignored; 0 hides the segments.
		set: (n) => {
			if (n >= 0) update({ segmentThickness: n })
		},
		varyBy: {
			field,
			fields: fields.names.filter((name) => VARY_BY_TYPES.has(fields.typeOf(name))),
			levels: field ? fields.levelsOf(field) : [],
			byValue: length.segmentThicknessByValue ?? {},
			pick: (next) =>
				update(
					next === null
						? { segmentThicknessField: null, segmentThicknessByValue: {} }
						: {
								segmentThicknessField: next,
								segmentThicknessByValue: thicknessByLevel(fields.levelsOf(next), thickness),
							}
				),
			setFor: (level, n) => {
				if (n >= 0)
					update({
						segmentThicknessByValue: { ...(length.segmentThicknessByValue ?? {}), [level]: n },
					})
			},
		},
	}
}

/** The shape slice, seeded from the theme like the Shape panel's writes. */
const useShapeConfig = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const cfg: ShapeConfig = { ...shapeConfigFromTheme(theme), ...configs.shape }
	const update = (next: Partial<ShapeConfig>) =>
		setConfigs((prev) => ({
			...prev,
			shape: { ...shapeConfigFromTheme(theme), ...prev.shape, ...next },
		}))
	return { cfg, update, theme }
}

/** The marks' own outline (`shape.outlineWidth`): a point's ring, a bar's,
 *  slice's, cell's, region's or node's outline. It can vary by a variable
 *  (`outlineWidthField` / `outlineWidthByValue`): each mark takes its
 *  level's thickness, a mark built from many rows reading its first. On a
 *  flow diagram only the endpoint columns have a value per node, so only
 *  they are offered (`useVaryByFieldFilter`). */
const useOutlineThickness = (noun: string): ThicknessModel => {
	const { cfg, update, theme } = useShapeConfig()
	const fields = useFieldLevels()
	const canVary = useVaryByFieldFilter()
	const stored = cfg.outlineWidthField ?? null
	const field = stored && fields.has(stored) ? stored : null
	const byValue = cfg.outlineWidthByValue ?? {}
	return {
		noun,
		value: cfg.outlineWidth,
		resetTo: theme.outlineWidth,
		changed: valueChanged(cfg.outlineWidth, theme.outlineWidth) || field !== null,
		min: 0,
		max: 10,
		clamp: true,
		set: (outlineWidth) => update({ outlineWidth }),
		varyBy: {
			field,
			fields: fields.names.filter(
				(name) => VARY_BY_TYPES.has(fields.typeOf(name)) && canVary(name, field)
			),
			levels: field ? fields.levelsOf(field) : [],
			byValue,
			pick: (next) =>
				update(
					next === null
						? { outlineWidthField: null, outlineWidthByValue: {} }
						: {
								outlineWidthField: next,
								outlineWidthByValue: thicknessByLevel(fields.levelsOf(next), cfg.outlineWidth),
							}
				),
			setFor: (level, n) => update({ outlineWidthByValue: { ...byValue, [level]: n } }),
		},
	}
}

/** The violin / box overlay's strokes (`shape.distributionOutlineWidth`),
 *  independent of the marks' own outline. */
const useViolinOutlineThickness = (noun: string): ThicknessModel => {
	const { cfg, update } = useShapeConfig()
	const dflt = DEFAULT_SHAPE_CONFIG.distributionOutlineWidth ?? 1
	return {
		noun,
		value: cfg.distributionOutlineWidth ?? dflt,
		resetTo: dflt,
		changed: valueChanged(cfg.distributionOutlineWidth, DEFAULT_SHAPE_CONFIG.distributionOutlineWidth),
		min: 0,
		max: 10,
		clamp: true,
		set: (distributionOutlineWidth) => update({ distributionOutlineWidth }),
	}
}

/** The regression line (`x.regression.strokeWidth`; the fit is y-on-x, so
 *  only the x axis carries it). */
const useRegressionThickness = (noun: string): ThicknessModel => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const themeRegression: RegressionConfig =
		axisConfigFromTheme(theme, "x").regression ?? DEFAULT_REGRESSION_CONFIG
	const regression: RegressionConfig = { ...themeRegression, ...configs.x?.regression }
	return {
		noun,
		value: regression.strokeWidth,
		resetTo: themeRegression.strokeWidth,
		changed: valueChanged(configs.x?.regression?.strokeWidth, themeRegression.strokeWidth),
		min: 0,
		max: 12,
		clamp: true,
		// The same theme-seeding merge the X-axis panel uses, so untouched
		// fields keep matching the changed-dot baseline.
		set: (strokeWidth) =>
			setConfigs((prev) => ({
				...prev,
				x: {
					...axisConfigFromTheme(theme, "x"),
					...prev.x,
					regression: { ...regression, strokeWidth },
				},
			})),
	}
}

/** A dot map's regions (`shape.regionOutlineWidth`). Untouched, they
 *  draw at the points' outline thickness, as they always have; a value
 *  here sets them apart, and reset goes back to following the points. */
const useRegionOutlineThickness = (noun: string): ThicknessModel => {
	const { cfg, update } = useShapeConfig()
	const own = cfg.regionOutlineWidth
	return {
		noun,
		value: own ?? cfg.outlineWidth,
		resetTo: cfg.outlineWidth,
		changed: own !== undefined,
		min: 0,
		max: 10,
		clamp: true,
		set: (regionOutlineWidth) => update({ regionOutlineWidth }),
		reset: () => update({ regionOutlineWidth: undefined }),
	}
}

/** The stems that connect marks to an axis (`connection.stemThickness`).
 *  Untouched they draw at the line's thickness, as they always have; a
 *  value here sets them apart, and reset goes back to following it. */
const useStemThickness = (noun: string): ThicknessModel => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const cfg: ConnectionConfig = { ...connectionConfigFromTheme(theme), ...configs.connection }
	const update = (next: Partial<ConnectionConfig>) =>
		setConfigs((prev) => ({
			...prev,
			connection: { ...connectionConfigFromTheme(theme), ...prev.connection, ...next },
		}))
	const own = configs.connection?.stemThickness
	return {
		noun,
		value: own ?? cfg.thickness,
		resetTo: cfg.thickness,
		changed: own !== undefined,
		min: MIN_LINE_THICKNESS,
		set: (n) => {
			if (n >= 0) update({ stemThickness: n })
		},
		reset: () => update({ stemThickness: undefined }),
	}
}

/** The density curve's line (`shape.densityCurveOutlineWidth`). */
const useDensityCurveThickness = (noun: string): ThicknessModel => {
	const { cfg, update } = useShapeConfig()
	const value = cfg.densityCurveOutlineWidth ?? DEFAULT_DENSITY_CURVE_WIDTH
	return {
		noun,
		value,
		resetTo: DEFAULT_DENSITY_CURVE_WIDTH,
		changed: value !== DEFAULT_DENSITY_CURVE_WIDTH,
		min: 0,
		max: 12,
		clamp: true,
		set: (densityCurveOutlineWidth) => update({ densityCurveOutlineWidth }),
	}
}

const THICKNESS_STORE: Record<SizeSection["kind"], (noun: string) => ThicknessModel> = {
	regionOutline: useRegionOutlineThickness,
	densityOutline: useDensityCurveThickness,
	outline: useOutlineThickness,
	line: useLineThickness,
	stem: useStemThickness,
	segment: useSegmentThickness,
	violinOutline: useViolinOutlineThickness,
	regressionLine: useRegressionThickness,
}

/** The control every thickness section shows. */
const ThicknessControl = ({
	model,
	offerVaryBy,
}: {
	model: ThicknessModel
	offerVaryBy: boolean
}) => {
	const varyBy = offerVaryBy ? model.varyBy : undefined
	const single = (
		<div className="flex items-center gap-2 text-sm">
			<NumberInput
				label="Thickness"
				labelClassName={LABEL_COL}
				changed={model.changed}
				value={model.value}
				min={model.min}
				max={model.max}
				step={0.5}
				clamp={model.clamp}
				onChange={model.set}
				inputClassName="w-16"
				suffix="px"
			/>
			{(model.reset ? model.changed : model.value !== model.resetTo) && (
				<ResetLink
					ariaLabel={`Reset ${model.noun.toLowerCase()} thickness`}
					onClick={model.reset ?? (() => model.set(model.resetTo))}
				/>
			)}
		</div>
	)
	if (!varyBy) return single
	return (
		<div className="flex flex-col gap-2">
			<SelectInput
				label="Vary by"
				labelClassName={LABEL_COL}
				changed={varyBy.field !== null}
				value={varyBy.field ?? ""}
				options={[
					{ value: "", label: "— none —" },
					...varyBy.fields.map((name) => ({ value: name, label: name })),
				]}
				onChange={(next) => varyBy.pick(next === "" ? null : next)}
				selectClassName="flex-1"
			/>
			{varyBy.field === null ? (
				single
			) : (
				<div className="flex flex-col gap-1.5">
					{varyBy.levels.map((level) => {
						const value = varyBy.byValue[level] ?? model.value
						return (
							<div key={level} className="flex items-center gap-2 text-sm">
								<span className="w-24 shrink-0 truncate vc-text" title={level}>
									{level}
								</span>
								<NumberInput
									label={`${model.noun} thickness for ${level}`}
									labelClassName="sr-only"
									value={value}
									min={model.min}
									max={model.max}
									step={0.5}
									clamp={model.clamp}
									onChange={(n) => varyBy.setFor(level, n)}
									inputClassName="w-16"
									suffix="px"
								/>
								{value !== model.value && (
									// Back to the single value WITHOUT removing the key, so a
									// map saved before the field was stored stays populated
									// (its last key going would silently end "vary by").
									<ResetLink onClick={() => varyBy.setFor(level, model.value)} />
								)}
							</div>
						)
					})}
					{varyBy.levels.length === 0 && (
						<p className="vc-help">No {varyBy.field} values in the data yet.</p>
					)}
				</div>
			)}
		</div>
	)
}

const ThicknessSection = ({ section }: { section: SizeSection }) => {
	// One store per kind; a section's kind never changes (it is its key).
	const useThickness = THICKNESS_STORE[section.kind]
	const model = useThickness(section.title)
	const parts = useDrawnParts()
	return (
		<CollapsibleSubsection
			title={section.title}
			changed={model.changed}
			jumpId={sizeJumpId(section.kind)}
		>
			<ThicknessControl model={model} offerVaryBy={section.varyBy} />
			{section.kind === "stem" && !model.changed && parts.line && (
				<p className="vc-help">Following the line&apos;s thickness.</p>
			)}
			{section.kind === "regionOutline" && !model.changed && (
				<p className="vc-help">Following the points&apos; outline thickness.</p>
			)}
		</CollapsibleSubsection>
	)
}

/** The thickness sections of the chart being edited. Renders nothing when
 *  the chart draws no stroke with a thickness to set. */
export const SizeThicknessSections = () => {
	const ctx = usePartsContext()
	const sections = useMemo(() => sizeSections(ctx), [ctx])
	return (
		<>
			{sections.map((section) => (
				<ThicknessSection key={section.kind} section={section} />
			))}
		</>
	)
}
