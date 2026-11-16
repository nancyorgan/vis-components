import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"

import {
	DEFAULT_SHAPE,
	type CustomGlyph,
	type ShapeConfig,
} from "../../../lib/channelConfig"
import { CUSTOM_GLYPH_BASE } from "../../../lib/customGlyphs"
import { SHAPE_PALETTE } from "../../../lib/scales"
import {
	resetShapeCategoryOverrides,
	shapeCategoryHasOverride,
} from "../../../lib/shapeColors"
import { orderedLevels } from "../../../lib/smartSort"
import { shapeConfigFromTheme } from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useDrawnParts } from "../../../store/usePartsContext"

import { ResetLink } from "../../../../../components/ui/ResetLink"
import { PLAIN_ROWS } from "../../../../../components/ui/rowGroup"
import { SidebarJumpText, channelJump } from "../../../../../components/ui/SidebarJumpLink"

import { CustomGlyphChips, CustomGlyphEditor } from "./customGlyphEditor"
import { sizeJumpId } from "./SizeThicknessSections"
import {
	CategoryRow,
	ShapeGlyph,
	shapeName,
	swatchChipClass,
} from "./glyphShared"
import { useUniqueValuesForChannel } from "./useUniqueValuesForChannel"

/** Row key for the Default-shape row's custom-glyph editor — distinct from
 *  any category value (categories come from data cell strings). */
const DEFAULT_GLYPH_ROW = "\u0000__default-shape__"

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
export const ShapeOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fieldMapped = !!encodings.shape?.field
	// Only glyph modes (scatter, radar, combo points) draw a shape on each
	// mark. Everywhere else — cells (bars, tiles, hexbins) and outline
	// modes (wedges, regions, packed / nested circles, ribbons) — the
	// Default-shape and per-category pickers would be inert, so the panel
	// says there is no shape to pick. Declared per mode as
	// `canvas.shapeRole`; the legend follows the same rule (no Shape
	// section, circle fallback swatches — see Legend.tsx). The outline's
	// THICKNESS is under Size, with every other thickness.
	const modeDef = useChartModeDef()
	// What the chart draws now: a glyph mode whose points are not drawn (a
	// pure density curve, line segments, a line with its points switched
	// off) has no glyph to pick either.
	const parts = useDrawnParts()
	const glyphsInert = modeDef.canvas.shapeRole !== "glyph" || !parts.glyphs
	// Same defensive merge: older visualizations may be missing outlineColor /
	// outlineWidth / overrides when the config was first introduced.
	const cfg: ShapeConfig = {
		...shapeConfigFromTheme(theme),
		...configs.shape,
	}
	const fieldValues = useUniqueValuesForChannel("shape")

	const updateCfg = (next: Partial<ShapeConfig>) => {
		// Seed untouched fields from the THEME (outline color / width) so the
		// stored slice matches the "changed" dot's theme baseline — seeding from
		// the built-in `DEFAULT_SHAPE_CONFIG` (white outline) would diverge from
		// a theme with a custom outline color and light the dot on first edit.
		setConfigs((prev) => ({
			...prev,
			shape: { ...shapeConfigFromTheme(theme), ...prev.shape, ...next },
		}))
	}

	const setOverride = (value: string, idx: number) =>
		updateCfg({ overrides: { ...cfg.overrides, [value]: idx } })
	const resetCategory = (value: string) =>
		updateCfg(resetShapeCategoryOverrides(cfg, value))

	const defaultShapeIdx = configs.defaultShape ?? DEFAULT_SHAPE
	// The default shape's reset sits after its swatches, on their line. (It used to be a panel-wide link under everything that also
	// put the outline COLOR back — a setting of the Color menu, which has a
	// reset of its own there.)
	const defaultShapeChanged = defaultShapeIdx !== theme.defaultShape

	// Which row's "+" custom-glyph editor is open — the DEFAULT_GLYPH_ROW
	// sentinel for the Default-shape row, a category value for per-category
	// rows, null when closed. Open-before-created, like the Pattern panel's
	// custom-dash box.
	const [glyphEditorFor, setGlyphEditorFor] = useState<string | null>(null)
	const customGlyphs = cfg.customGlyphs ?? []

	/** Create a glyph (reusing the first tombstoned slot, else appending)
	 *  and select it for the row that opened the editor — one atomic write
	 *  so undo/persist never see the glyph without its selection. */
	const addCustomGlyph = (g: CustomGlyph, forRow: string) => {
		setConfigs((prev) => {
			const shapePrev: ShapeConfig = {
				...shapeConfigFromTheme(theme),
				...prev.shape,
			}
			const list = [...(shapePrev.customGlyphs ?? [])]
			let slot = list.indexOf(null)
			if (slot === -1) {
				slot = list.length
				list.push(g)
			} else {
				list[slot] = g
			}
			const idx = CUSTOM_GLYPH_BASE + slot
			const shape: ShapeConfig =
				forRow === DEFAULT_GLYPH_ROW
					? { ...shapePrev, customGlyphs: list }
					: {
							...shapePrev,
							customGlyphs: list,
							overrides: { ...shapePrev.overrides, [forRow]: idx },
						}
			return {
				...prev,
				shape,
				...(forRow === DEFAULT_GLYPH_ROW ? { defaultShape: idx } : {}),
			}
		})
	}

	/** Tombstone (never splice) so other rows' indices stay stable; any row
	 *  still pointing at the slot falls back to the circle symbol. */
	const deleteCustomGlyph = (slot: number) =>
		updateCfg({
			customGlyphs: customGlyphs.map((g, i) => (i === slot ? null : g)),
		})

	const customChipsFor = (rowKey: string, activeIdx: number, pick: (idx: number) => void) => (
		<CustomGlyphChips
			glyphs={customGlyphs}
			activeIdx={activeIdx}
			onPick={pick}
			onDelete={deleteCustomGlyph}
			onAdd={() =>
				setGlyphEditorFor((open) => (open === rowKey ? null : rowKey))
			}
		/>
	)

	// Which thickness the Size menu holds for this chart, to point at.
	const thicknessLink = parts.outline ? (
		<p className="vc-help">
			Set the outline thickness under{" "}
			<SidebarJumpText target={channelJump("area", sizeJumpId("outline"))}>Size</SidebarJumpText>
			{" "}and its color under{" "}
			<SidebarJumpText target={channelJump("hue")}>Color</SidebarJumpText>.
		</p>
	) : null

	if (glyphsInert)
		return (
			<div className="vc-option-panel">
				<p className="vc-help">
					This chart draws no point markers, so there is no shape to pick.
				</p>
				{thicknessLink}
			</div>
		)

	return (
		<div className="vc-option-panel">
			{!fieldMapped && (
				<>
					<div className={`${PLAIN_ROWS} text-sm`}>
						<span className="vc-group-header">Default shape</span>
						<div className="flex flex-wrap items-center gap-1">
							{SHAPE_PALETTE.map((_, idx) => {
								const selected = idx === defaultShapeIdx
								return (
									<button
										// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
										key={idx}
										type="button"
										onClick={() =>
											setConfigs((prev) => ({
												...prev,
												defaultShape: idx,
											}))
										}
										aria-pressed={selected}
										aria-label={`Default shape: ${shapeName(idx)}`}
										className={swatchChipClass(selected, "w-7")}
									>
										<ShapeGlyph idx={idx} selected={selected} />
									</button>
								)
							})}
							{customChipsFor(DEFAULT_GLYPH_ROW, defaultShapeIdx, (idx) =>
								setConfigs((prev) => ({
									...prev,
									defaultShape: idx,
								}))
							)}
							{defaultShapeChanged && (
								<ResetLink
									ariaLabel="Reset default shape"
									className="ml-1"
									onClick={() =>
										setConfigs((prev) => ({
											...prev,
											defaultShape: theme.defaultShape,
										}))
									}
								/>
							)}
						</div>
						{glyphEditorFor === DEFAULT_GLYPH_ROW && (
							<CustomGlyphEditor
								onCreate={(g) => addCustomGlyph(g, DEFAULT_GLYPH_ROW)}
								onClose={() => setGlyphEditorFor(null)}
							/>
						)}
					</div>
				</>
			)}
			{fieldMapped && fieldValues && fieldValues.values.length > 0 && (
				<>
					{/* Shape choice per category only. Per-category FILL / OUTLINE
					 *  color lives in the unified Color menu (Fill / Outline
					 *  subheaders → "Vary by" the shape field) — see the note above.
					 *  Legacy `fillOverrides` / `strokeOverrides` on saved visuals are
					 *  still honored by the renderer and cleared by this row's reset. */}
					{orderedLevels(
						fieldValues.values,
						fieldValues.type,
						fieldValues.order
					).map(({ value: v, index: i }) => {
						const activeIdx =
							cfg.overrides[v] ?? i % SHAPE_PALETTE.length
						return (
							<div key={v} className="flex flex-col gap-1">
								<CategoryRow
									value={v}
									paletteSize={SHAPE_PALETTE.length}
									activeIdx={activeIdx}
									hasAnyOverride={shapeCategoryHasOverride(cfg, v)}
									Glyph={ShapeGlyph}
									onPick={(idx) => setOverride(v, idx)}
									onReset={() => resetCategory(v)}
									extraChips={customChipsFor(v, activeIdx, (idx) =>
										setOverride(v, idx)
									)}
								/>
								{glyphEditorFor === v && (
									<CustomGlyphEditor
										onCreate={(g) => addCustomGlyph(g, v)}
										onClose={() => setGlyphEditorFor(null)}
									/>
								)}
							</div>
						)
					})}
				</>
			)}
			{thicknessLink}
		</div>
	)
}
