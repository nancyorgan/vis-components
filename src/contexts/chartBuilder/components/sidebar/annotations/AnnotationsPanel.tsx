import { useMemo, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	newCircle,
	newLineSegment,
	newRectangle,
	newTextAnnotation,
	type AnnotationsConfig,
	type CircleAnnotation,
	type LineSegmentAnnotation,
	type RectangleAnnotation,
	type TextAnnotation,
} from "../../../lib/annotationsConfig"
import {
	boxAnnotationStyleFromTheme,
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
	textAnnotationStyleFromTheme,
} from "../../../lib/themeConfig"
import {
	DEFAULT_FACET_CONFIG,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { effectiveType } from "../../../lib/fieldType"
import { resolveFacetPanels } from "../../../lib/resolveFacetPanels"
import {
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { nameSuggestion, type AxisInfo } from "./axisInfo"
import { CircleEditor } from "./CircleEditor"
import { FacetScopeControl } from "./controls"
import { LineSegmentEditor } from "./LineSegmentEditor"
import { RectangleEditor } from "./RectangleEditor"
import { TextAnnotationEditor } from "./TextAnnotationEditor"

export const AnnotationsPanel = () => {
	const [cfg, setCfg] = useAtom(currentAnnotationsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const modeDef = useChartModeDef()
	// Theme-seeded style defaults: what a freshly-added annotation looks like,
	// and the baseline each style control's reset link compares against /
	// restores to (the live theme, per the theme-derived-UI rule).
	const theme = useCurrentTheme()
	const rectDefaults = useMemo(() => rectangleStyleFromTheme(theme), [theme])
	const circleDefaults = useMemo(
		() => boxAnnotationStyleFromTheme(theme),
		[theme],
	)
	const lineDefaults = useMemo(
		() => lineAnnotationStyleFromTheme(theme),
		[theme],
	)
	const textDefaults = useMemo(
		() => textAnnotationStyleFromTheme(theme),
		[theme],
	)
	// Facet panels for the current chart — same resolver PlotCanvas renders
	// against, so the keys the user scopes to match the rendered panels. When
	// the chart isn't faceted (`mode === "single"`) we hide the scope control.
	const facetCfg = useMemo<FacetConfig>(
		() => ({ ...DEFAULT_FACET_CONFIG, ...channelConfigs.facet }),
		[channelConfigs.facet],
	)
	const facetPanels = useMemo(
		() =>
			resolveFacetPanels(dataset, encodings, levelOrders, overrides, facetCfg),
		[dataset, encodings, levelOrders, overrides, facetCfg],
	)
	const isFaceted = facetPanels.mode !== "single"
	const facetOptions = facetPanels.values
	// Mode gating is trait-driven (never compare mode ids here): the mode def
	// declares which encoding channel backs each value axis and whether value
	// coords are polar. Radar maps onto the same x→angle, y→r convention the
	// renderer uses, so value-mode circle centers read x=angle, y=r. Pies have
	// no value axes; polar modes gray out value mode entirely.
	const { xValueChannel, yValueChannel, polarValueCoords } = modeDef.annotations
	const isRadar = polarValueCoords
	const isPolar = modeDef.canvas.coordFamily === "polar"

	const resolveAxis = (axis: "x" | "y"): AxisInfo => {
		const channel = axis === "x" ? xValueChannel : yValueChannel
		const field = channel ? (encodings[channel]?.field ?? null) : null
		if (!field || !dataset)
			return { field, type: null, categories: null, dataMin: null, dataMax: null }
		const type = effectiveType(dataset, field, overrides)
		// For categorical/string-ordinal axes, expose the unique values
		// so the panel can render a dropdown.
		const isCategoricalLike =
			type === "categorical" ||
			(type === "ordinal" &&
				dataset.rows.every((r) => {
					const v = r[field]
					return v === null || v === undefined || typeof v === "string"
				}))
		const categories = isCategoricalLike
			? [
					...new Set(
						dataset.rows
							.map((r) => r[field])
							.filter((v): v is string => typeof v === "string" && v !== "")
					),
				]
			: null
		// Numeric / temporal data range — only needed for the
		// percent↔values toggle to lerp between data min and max.
		let dataMin: number | null = null
		let dataMax: number | null = null
		if (!isCategoricalLike) {
			const nums: number[] = []
			for (const row of dataset.rows) {
				const raw = row[field]
				if (raw === null || raw === undefined || raw === "") continue
				const n =
					type === "temporal"
						? new Date(String(raw)).getTime()
						: Number(raw)
				if (Number.isFinite(n)) nums.push(n)
			}
			if (nums.length > 0) {
				dataMin = Math.min(...nums)
				dataMax = Math.max(...nums)
			}
		}
		return { field, type, categories, dataMin, dataMax }
	}
	const xAxis = resolveAxis("x")
	const yAxis = resolveAxis("y")

	// Which annotation editors are expanded. Everything starts collapsed so a
	// long list reads as a compact set of name rows; adding a new annotation
	// expands it for immediate editing. Local state (resets on unmount), same
	// trade-off CollapsibleSubsection makes.
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
	const setExpanded = (id: string, open: boolean) =>
		setExpandedIds((prev) => {
			if (prev.has(id) === open) return prev
			const next = new Set(prev)
			if (open) next.add(id)
			else next.delete(id)
			return next
		})

	const update = (next: AnnotationsConfig) => setCfg(next)
	// Older saved configs (pre-circle) may lack `circles` until migrated;
	// treat a missing list as empty so the panel never reads `undefined`.
	const circles = cfg.circles ?? []
	// Same guard for line segments, which were added after circles.
	const lineSegments = cfg.lineSegments ?? []
	// …and for free-standing text labels, added after line segments.
	const texts = cfg.texts ?? []

	const addRectangle = () => {
		const id = `rect-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({
			...cfg,
			rectangles: [...cfg.rectangles, newRectangle(id, rectDefaults)],
		})
		setExpanded(id, true)
	}

	const updateRect = (id: string, patch: Partial<RectangleAnnotation>) => {
		update({
			...cfg,
			rectangles: cfg.rectangles.map((r) =>
				r.id === id ? { ...r, ...patch } : r
			),
		})
	}

	const removeRect = (id: string) => {
		update({ ...cfg, rectangles: cfg.rectangles.filter((r) => r.id !== id) })
		setExpanded(id, false)
	}

	const addCircle = () => {
		const id = `circle-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({ ...cfg, circles: [...circles, newCircle(id, circleDefaults)] })
		setExpanded(id, true)
	}

	const updateCircle = (id: string, patch: Partial<CircleAnnotation>) => {
		update({
			...cfg,
			circles: circles.map((c) => (c.id === id ? { ...c, ...patch } : c)),
		})
	}

	const removeCircle = (id: string) => {
		update({ ...cfg, circles: circles.filter((c) => c.id !== id) })
		setExpanded(id, false)
	}

	const addLineSegment = () => {
		const id = `line-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({
			...cfg,
			lineSegments: [...lineSegments, newLineSegment(id, lineDefaults)],
		})
		setExpanded(id, true)
	}

	const updateLine = (id: string, patch: Partial<LineSegmentAnnotation>) => {
		update({
			...cfg,
			lineSegments: lineSegments.map((l) =>
				l.id === id ? { ...l, ...patch } : l
			),
		})
	}

	const removeLine = (id: string) => {
		update({ ...cfg, lineSegments: lineSegments.filter((l) => l.id !== id) })
		setExpanded(id, false)
	}

	const addText = () => {
		const id = `text-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({ ...cfg, texts: [...texts, newTextAnnotation(id, textDefaults)] })
		setExpanded(id, true)
	}

	const updateText = (id: string, patch: Partial<TextAnnotation>) => {
		update({
			...cfg,
			texts: texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
		})
	}

	const removeText = (id: string) => {
		update({ ...cfg, texts: texts.filter((t) => t.id !== id) })
		setExpanded(id, false)
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={addRectangle}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Rectangle
				</button>
				<button
					type="button"
					onClick={addCircle}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Circle
				</button>
				<button
					type="button"
					onClick={addLineSegment}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Line
				</button>
				<button
					type="button"
					onClick={addText}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Text
				</button>
			</div>
			{cfg.rectangles.length === 0 &&
				circles.length === 0}
			{cfg.rectangles.map((rect, i) => (
				<RectangleEditor
					key={rect.id}
					rect={rect}
					defaults={rectDefaults}
					onChange={(patch) => updateRect(rect.id, patch)}
					onRemove={() => removeRect(rect.id)}
					open={expandedIds.has(rect.id)}
					onToggle={() => setExpanded(rect.id, !expandedIds.has(rect.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					disableValues={isPolar}
					namePlaceholder={nameSuggestion("Rectangle", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={rect.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateRect(rect.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
			{circles.map((circle, i) => (
				<CircleEditor
					key={circle.id}
					circle={circle}
					defaults={circleDefaults}
					onChange={(patch) => updateCircle(circle.id, patch)}
					onRemove={() => removeCircle(circle.id)}
					open={expandedIds.has(circle.id)}
					onToggle={() => setExpanded(circle.id, !expandedIds.has(circle.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					isRadar={isRadar}
					disableValues={isPolar && !isRadar}
					namePlaceholder={nameSuggestion("Circle", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={circle.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateCircle(circle.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
			{lineSegments.map((line, i) => (
				<LineSegmentEditor
					key={line.id}
					line={line}
					defaults={lineDefaults}
					onChange={(patch) => updateLine(line.id, patch)}
					onRemove={() => removeLine(line.id)}
					open={expandedIds.has(line.id)}
					onToggle={() => setExpanded(line.id, !expandedIds.has(line.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					disableValues={isPolar}
					namePlaceholder={nameSuggestion("Line", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={line.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateLine(line.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
			{texts.map((t, i) => (
				<TextAnnotationEditor
					key={t.id}
					anno={t}
					defaults={textDefaults}
					onChange={(patch) => updateText(t.id, patch)}
					onRemove={() => removeText(t.id)}
					open={expandedIds.has(t.id)}
					onToggle={() => setExpanded(t.id, !expandedIds.has(t.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					disableValues={isPolar}
					namePlaceholder={nameSuggestion("Text", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={t.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateText(t.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
		</div>
	)
}
