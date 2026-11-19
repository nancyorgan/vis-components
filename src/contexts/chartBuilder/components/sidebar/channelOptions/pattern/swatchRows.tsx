import {
	DEFAULT_PATTERN_ROTATION,
	DEFAULT_PATTERN_SCALE,
} from "../../../../lib/channelConfig"

import { LabeledChipRow } from "../../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../../components/ui/ResetLink"

import { CustomPatternChips, CustomPatternEditor } from "../customPatternEditor"
import { LineDashGlyph, PatternGlyph, swatchChipClass } from "../glyphShared"

import type { FillTargetState } from "./fillTargetState"
import type { PatternPanel } from "./usePatternPanel"

/** The custom chips + "+" for one fill swatch row, and (below the row)
 *  its upload editor while open. */
const customPatternControls = (
	p: PatternPanel,
	rowKey: string,
	row: {
		activeIdx: number | null
		select: (idx: number) => void
		ink: string
		bg: string
		scale?: number | null
		rotation?: number | null
		ariaName: string
	}
) => ({
	chips: (
		<CustomPatternChips
			patterns={p.customPatterns}
			activeIdx={row.activeIdx}
			onPick={row.select}
			onDelete={p.deleteCustomPattern}
			onAdd={() =>
				p.setPatternEditorFor((open) => (open === rowKey ? null : rowKey))
			}
			inkColor={row.ink}
			bgColor={row.bg}
			scale={row.scale}
			rotation={row.rotation}
			ariaName={row.ariaName}
		/>
	),
	editor: p.patternEditorFor === rowKey && (
		<CustomPatternEditor
			onCreate={(pattern) => p.addCustomPattern(pattern, row.select)}
			onClose={() => p.setPatternEditorFor(null)}
		/>
	),
})

export type DefaultSwatchTarget = {
	activeIdx: number | null
	setIdx: (next: number | null) => void
	ink: string
	/** Tile zoom / rotation previewed in the chips. */
	scale: number
	rotation: number
	ariaName: string
	/** Chip tile when the target's isn't the point tile (`previewBg`). */
	bg?: string
}

/** A fill target's twin of the default point-fill row: same swatches,
 *  writing the target's own default (`pattern.defaultPolygonPattern` /
 *  `defaultViolinPattern`) instead. */
export const targetDefaultRow = (
	p: PatternPanel,
	t: FillTargetState,
	ariaName: string,
	tile?: string
): DefaultSwatchTarget => ({
	activeIdx: t.defaultIdx,
	setIdx: t.setDefaultIdx,
	ink: t.defaultInk ?? (tile ? p.pairedInkForTile(tile) : p.defaultInk),
	scale: t.defaultScale ?? DEFAULT_PATTERN_SCALE,
	rotation: t.defaultRotation ?? DEFAULT_PATTERN_ROTATION,
	ariaName,
	bg: tile,
})

/** The default (no Pattern variable) swatch row: None + the palette + the
 *  custom uploads, writing `target` (the marks' own default pattern when
 *  omitted). */
export const DefaultSwatchRow = ({
	p,
	label,
	palette,
	Glyph,
	showNone,
	target: targetProp,
}: {
	p: PatternPanel
	label: string | null
	palette: readonly unknown[]
	Glyph: typeof PatternGlyph | typeof LineDashGlyph
	showNone: boolean
	target?: DefaultSwatchTarget
}) => {
	const target: DefaultSwatchTarget = targetProp ?? {
		activeIdx: p.defaultPatternIdx,
		setIdx: p.setDefaultPattern,
		ink: p.defaultInk,
		scale: p.defaultScale,
		rotation: p.defaultRotation,
		ariaName: "Pattern option",
	}
	// Fill rows (not line-dash rows) take custom uploaded patterns too.
	const custom =
		Glyph === PatternGlyph
			? customPatternControls(p, `default:${target.ariaName}`, {
					activeIdx: target.activeIdx,
					select: target.setIdx,
					ink: target.ink,
					bg: target.bg ?? p.previewBg,
					scale: target.scale,
					rotation: target.rotation,
					ariaName: target.ariaName,
				})
			: null
	// The pick's own reset, beside it: after the swatches, on their line.
	const patternReset = showNone && target.activeIdx !== null && (
		<ResetLink
			ariaLabel={`Reset ${target.ariaName.toLowerCase()}`}
			className="ml-1"
			onClick={() => target.setIdx(null)}
		/>
	)
	const chips = (
		<>
			{showNone && (
				<button
					type="button"
					onClick={() => target.setIdx(null)}
					aria-pressed={target.activeIdx === null}
					className={swatchChipClass(target.activeIdx === null, "px-2 text-sm")}
				>
					None
				</button>
			)}
			{palette.map((_, idx) => {
				const selected = idx === target.activeIdx
				return (
					<button
						// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
						key={idx}
						type="button"
						onClick={() => target.setIdx(idx)}
						aria-pressed={selected}
						aria-label={`${target.ariaName} ${idx + 1}`}
						className={swatchChipClass(selected, "w-7")}
					>
						<Glyph
							idx={idx}
							selected={selected}
							inkColor={target.ink}
							bgColor={target.bg ?? p.previewBg}
							scale={target.scale}
							rotation={target.rotation}
						/>
					</button>
				)
			})}
			{custom?.chips}
			{patternReset}
		</>
	)
	// Labeled ("Default pattern"): the chips start on the label's line,
	// in the control column the Ink color / Scale / Rotate rows under
	// them use, and wrap under the first chip. Unlabeled (inside a
	// titled card): the chips alone.
	return label ? (
		<LabeledChipRow label={label} chips={chips}>
			{custom?.editor}
		</LabeledChipRow>
	) : (
		<div className="flex flex-col gap-1 text-sm">
			<div className="flex flex-wrap items-center gap-1">{chips}</div>
			{custom?.editor}
		</div>
	)
}

/** One category's swatch row: its name in the label column with its chips
 *  starting on the same line (`LabeledChipRow`) — they wrap under the first
 *  chip, on the control column its Ink color / Scale / Rotate rows use. The
 *  category's reset follows the last chip, on the chips' line. */
export const SwatchRow = ({
	p,
	v,
	palette,
	Glyph,
	isNone,
	activeIdx,
	ink,
	scale,
	rotation,
	bg,
	setIdx,
	setNone,
	ariaKind,
	label,
	canReset,
	onReset,
}: {
	p: PatternPanel
	v: string
	palette: readonly unknown[]
	Glyph: typeof PatternGlyph | typeof LineDashGlyph
	isNone: boolean
	activeIdx: number
	ink: string
	/** Tile zoom / rotation previewed in the chips (×1 / 0° when unset). */
	scale?: number | null
	rotation?: number | null
	/** Chip background (the category's hue color when pattern shares hue's
	 *  field); the panel's Background when unset. */
	bg?: string
	setIdx: (idx: number) => void
	setNone: () => void
	/** Accessible-name prefix for the row's buttons ("pattern" by default).
	 *  The Polygon-fill rows pass "polygon pattern" so they stay
	 *  distinguishable from the Point-fill rows beside them. */
	ariaKind?: string
	/** The category's name, in the label column (its display text when the
	 *  key isn't user-friendly, e.g. "Level 1"). */
	label: string
	/** Something is picked for the category: its reset ends the chips. */
	canReset: boolean
	/** Clears everything picked for the category (pattern, ink, scale,
	 *  rotation). */
	onReset: () => void
}) => {
	const kind = ariaKind ?? "pattern"
	const optionName = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} option`
	const custom =
		Glyph === PatternGlyph
			? customPatternControls(p, `${kind}:${v}`, {
					activeIdx: isNone ? null : activeIdx,
					select: setIdx,
					ink,
					bg: bg ?? p.previewBg,
					scale: scale ?? DEFAULT_PATTERN_SCALE,
					rotation: rotation ?? DEFAULT_PATTERN_ROTATION,
					ariaName: optionName,
				})
			: null
	return (
		<LabeledChipRow
			label={label}
			chips={
				<>
					<button
						type="button"
						onClick={setNone}
						aria-pressed={isNone}
						aria-label={`No ${kind} for ${v}`}
						className={swatchChipClass(isNone, "px-2 text-sm")}
					>
						None
					</button>
					{palette.map((_, idx) => {
						const selected = !isNone && idx === activeIdx
						return (
							<button
								// eslint-disable-next-line react/no-array-index-key -- palette is a fixed static list
								key={idx}
								type="button"
								onClick={() => setIdx(idx)}
								aria-pressed={selected}
								aria-label={`${optionName} ${idx + 1}`}
								className={swatchChipClass(selected, "w-7")}
							>
								<Glyph
									idx={idx}
									selected={selected}
									inkColor={ink}
									bgColor={bg ?? p.previewBg}
									scale={scale ?? DEFAULT_PATTERN_SCALE}
									rotation={rotation ?? DEFAULT_PATTERN_ROTATION}
								/>
							</button>
						)
					})}
					{custom?.chips}
					{canReset && (
						<ResetLink
							ariaLabel={`Reset ${kind} for ${v}`}
							className="ml-1"
							onClick={onReset}
						/>
					)}
				</>
			}
		>
			{custom?.editor}
		</LabeledChipRow>
	)
}
