import { PATTERN_NONE, PATTERN_PALETTE } from "../../../../lib/patterns"

import { LABEL_COL } from "../../../../../../components/ui/LabeledField"

import { PatternGlyph } from "../glyphShared"

import type { FillTargetState } from "./fillTargetState"
import { CategoryInkPicker, ScaleRotateRows } from "./rows"
import { SwatchRow } from "./swatchRows"
import { categoryState, type PatternPanel } from "./usePatternPanel"

// Each category's block opens with its name in the label column and its
// swatches starting on the same line (`LabeledChipRow`). `display` is the
// name shown when the storage key isn't user-friendly (e.g. the
// Nesting-depth key "1" shows as "Level 1"); picks still key on `v`.

/** One category's Point-fill controls: fill swatches + the per-category ink
 *  color picker, then its Scale and Rotate rows (blank = inherit ×1 / 0° —
 *  the map has no entry; typing writes the entry). Reset clears the fill
 *  override and the ink, scale and rotation overrides. */
export const FillCategory = ({
	p,
	v,
	i,
	display,
}: {
	p: PatternPanel
	v: string
	i: number
	display?: string
}) => {
	const s = categoryState(p, v, i)
	const { patternMode } = p
	return (
		<div className="flex flex-col gap-1 text-sm">
			<SwatchRow
				p={p}
				v={v}
				palette={patternMode === "fill" ? p.activePalette : PATTERN_PALETTE}
				Glyph={patternMode === "fill" ? p.PatternSwatch : PatternGlyph}
				isNone={s.fillIsNone}
				activeIdx={s.fillActiveIdx}
				ink={s.ink}
				scale={s.scale}
				rotation={s.rotation}
				bg={p.effectiveBgFor(i, v)}
				setIdx={(idx) => p.setPaletteOverride(v, idx)}
				setNone={() => p.setPaletteOverride(v, PATTERN_NONE)}
				label={display ?? v}
				canReset={
					s.hasPaletteOverride || s.hasInk || s.hasScale || s.hasRotation
				}
				onReset={() => {
					if (s.hasPaletteOverride) p.resetPaletteOverride(v)
					if (s.hasInk) p.resetCategoryInk(v)
					if (s.hasScale) p.resetCategoryScale(v)
					if (s.hasRotation) p.resetCategoryRotation(v)
				}}
			/>
			{/* Ink, scale and rotation style a pattern: with none picked for
			 *  this category they have nothing to act on. */}
			{!s.fillIsNone && (
				<CategoryInkPicker
					v={v}
					ink={s.ink}
					hasInk={s.hasInk}
					target={{
						set: p.setCategoryInk,
						reset: p.resetCategoryInk,
						ariaKind: "Pattern",
					}}
				/>
			)}
			{!s.fillIsNone && (
				<ScaleRotateRows
					context={v}
					labelClassName={LABEL_COL}
					value={s.scale}
					onChange={(n) => p.setCategoryScale(v, n)}
					onClear={() => p.resetCategoryScale(v)}
					rotation={s.rotation}
					onRotationChange={(n) => p.setCategoryRotation(v, n)}
					onRotationClear={() => p.resetCategoryRotation(v)}
				/>
			)}
		</div>
	)
}

/** One category's controls for a separate fill target (the filled radar's
 *  polygon, the violin / box body, an area chart's points): the same swatch
 *  + ink + scale layout as Point fill, writing the target's own maps. Like
 *  point fills in line-chart context, a category with no pick renders no
 *  pattern. `aria.kind` keeps the rows distinguishable from the Point-fill
 *  rows beside them ("No polygon pattern for X", "Polygon pattern option
 *  N"); `aria.context` names the Scale / Rotate boxes ("polygon fill
 *  <category>"). */
export const TargetCategory = ({
	p,
	t,
	aria,
	v,
	i,
	display,
	preview,
}: {
	p: PatternPanel
	t: FillTargetState
	aria: { kind: string; context: string }
	v: string
	i: number
	display?: string
	/** Preview the chips on this tile (the body's fill) instead of the
	 *  point tile, pairing the default ink on it like the renderer. */
	preview?: { tile: string }
}) => {
	const override = t.overrides[v]
	const isNone = override === undefined || override === PATTERN_NONE
	const activeIdx = typeof override === "number" ? override : -1
	const hasInk = t.inkColors[v] !== undefined
	const ink =
		t.inkColors[v] ??
		(preview ? p.pairedInkForTile(preview.tile) : p.effectiveInkFor(i, v))
	const scale = t.scales[v] ?? null
	const hasScale = scale !== null
	const rotation = t.rotations[v] ?? null
	const hasRotation = rotation !== null
	return (
		<div className="flex flex-col gap-1 text-sm">
			<SwatchRow
				p={p}
				v={v}
				palette={PATTERN_PALETTE}
				Glyph={PatternGlyph}
				isNone={isNone}
				activeIdx={activeIdx}
				ink={ink}
				scale={scale}
				rotation={rotation}
				bg={preview?.tile ?? p.effectiveBgFor(i, v)}
				setIdx={(idx) => t.setOverride(v, idx)}
				setNone={() => t.setOverride(v, PATTERN_NONE)}
				ariaKind={aria.kind}
				label={display ?? v}
				canReset={override !== undefined || hasInk || hasScale || hasRotation}
				onReset={() => {
					if (override !== undefined) t.resetOverride(v)
					if (hasInk) t.resetInk(v)
					if (hasScale) t.resetScale(v)
					if (hasRotation) t.resetRotation(v)
				}}
			/>
			{!isNone && (
				<CategoryInkPicker
					v={v}
					ink={ink}
					hasInk={hasInk}
					target={{
						set: t.setInk,
						reset: t.resetInk,
						ariaKind: `${aria.kind.charAt(0).toUpperCase()}${aria.kind.slice(1)}`,
					}}
				/>
			)}
			{!isNone && (
				<ScaleRotateRows
					context={`${aria.context} ${v}`}
					labelClassName={LABEL_COL}
					value={scale}
					onChange={(n) => t.setScale(v, n)}
					onClear={() => t.resetScale(v)}
					rotation={rotation}
					onRotationChange={(n) => t.setRotation(v, n)}
					onRotationClear={() => t.resetRotation(v)}
				/>
			)}
		</div>
	)
}
