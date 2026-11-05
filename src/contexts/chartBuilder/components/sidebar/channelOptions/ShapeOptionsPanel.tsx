import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"

import {
	DEFAULT_SHAPE,
	DEFAULT_SHAPE_CONFIG,
	type CustomGlyph,
	type ShapeConfig,
} from "../../../lib/channelConfig"
import { overlayOn } from "../../../lib/colorSlots"
import { CUSTOM_GLYPH_BASE } from "../../../lib/customGlyphs"
import { SHAPE_PALETTE } from "../../../lib/scales"
import {
	resetShapeCategoryOverrides,
	shapeCategoryHasOverride,
} from "../../../lib/shapeColors"
import { orderedLevels } from "../../../lib/smartSort"
import { shapeConfigFromTheme, valueChanged } from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentTheme } from "../../../store/useCurrentTheme"

import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"

import { CustomGlyphChips, CustomGlyphEditor } from "./customGlyphEditor"
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
	// modes (wedges, regions, packed / nested circles, ribbons) — the panel
	// is just the outline width; the Default-shape and per-category
	// pickers would be inert, so they're hidden. Declared per mode as
	// `canvas.shapeRole`; the legend follows the same rule (no Shape
	// section, circle fallback swatches — see Legend.tsx).
	const modeDef = useChartModeDef()
	const glyphsInert = modeDef.canvas.shapeRole !== "glyph"
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
	// The panel-wide reset shows only when something it would write differs
	// from that target (same fields the reset writes, below).
	const panelChanged =
		defaultShapeIdx !== theme.defaultShape ||
		cfg.outlineColor !== theme.outlineColor ||
		cfg.outlineWidth !== theme.outlineWidth ||
		cfg.distributionOutlineWidth !==
			DEFAULT_SHAPE_CONFIG.distributionOutlineWidth

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

	return (
		<div className="vc-option-panel">
			<div className="flex items-center gap-2">
				<NumberInput
					label="Outline width"
					labelClassName={LABEL_COL}
					value={cfg.outlineWidth}
					min={0}
					max={10}
					step={0.5}
					clamp
					onChange={(outlineWidth) => updateCfg({ outlineWidth })}
					suffix="px"
					changed={valueChanged(cfg.outlineWidth, theme.outlineWidth)}
				/>
				{cfg.outlineWidth !== theme.outlineWidth && (
					<ResetLink
						ariaLabel="Reset outline width"
						onClick={() => updateCfg({ outlineWidth: theme.outlineWidth })}
						underline
					/>
				)}
			</div>
			{/* Border width for the violin outline / box strokes — its own knob,
			 *  independent of the point marks' outline width above. Only shown
			 *  while a violin/box overlay is actually rendering — the mode draws
			 *  the axis overlays (`canvas.statOverlays`) and one is on. */}
			{modeDef.canvas.statOverlays && overlayOn(configs) && (
				<div className="flex items-center gap-2">
					<NumberInput
						label="Violin / box outline"
						labelClassName={LABEL_COL}
						value={cfg.distributionOutlineWidth ?? 1}
						min={0}
						max={10}
						step={0.5}
						clamp
						onChange={(distributionOutlineWidth) =>
							updateCfg({ distributionOutlineWidth })
						}
						suffix="px"
						changed={valueChanged(
							cfg.distributionOutlineWidth,
							DEFAULT_SHAPE_CONFIG.distributionOutlineWidth
						)}
					/>
					{valueChanged(
						cfg.distributionOutlineWidth,
						DEFAULT_SHAPE_CONFIG.distributionOutlineWidth
					) && (
						<ResetLink
							ariaLabel="Reset violin / box outline"
							onClick={() =>
								updateCfg({
									distributionOutlineWidth:
										DEFAULT_SHAPE_CONFIG.distributionOutlineWidth,
								})
							}
							underline
						/>
					)}
				</div>
			)}
			{/* Outline COLOR now lives in the unified Color menu (Outline
			 *  subheader) — only outline WIDTH remains here. */}
			{!fieldMapped && !glyphsInert && (
				<>
					<div className="vc-divider-group text-sm">
						<span className="vc-group-header">Default shape</span>
						<div className="flex flex-wrap gap-1">
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
			{fieldMapped && !glyphsInert && fieldValues && fieldValues.values.length > 0 && (
				<>
					<hr className="border-stone-200 dark:border-stone-700" />
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
			{panelChanged && (
				<ResetLink
					onClick={() => {
						setConfigs((prev) => ({
							...prev,
							defaultShape: theme.defaultShape,
						}))
						updateCfg({
							outlineColor: theme.outlineColor,
							outlineWidth: theme.outlineWidth,
							distributionOutlineWidth:
								DEFAULT_SHAPE_CONFIG.distributionOutlineWidth,
						})
					}}
					underline
					className="self-start"
				/>
			)}
		</div>
	)
}
