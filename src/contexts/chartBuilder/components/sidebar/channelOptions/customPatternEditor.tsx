import { useState } from "react"

import {
	CUSTOM_PATTERN_ACCEPT,
	CUSTOM_PATTERN_BASE,
	fileToCustomPattern,
	type CustomPattern,
} from "../../../lib/customPatterns"

import { PatternGlyph, swatchChipClass } from "./glyphShared"

/** The custom-pattern chips appended to a Pattern swatch row: one
 *  selectable chip per saved pattern (with an ×-on-hover delete) plus the
 *  "+" chip that opens the upload editor. Pattern slots are shared
 *  chart-wide — a pattern uploaded from any row is selectable from all of
 *  them (point fill, polygon fill, violin / box fill). Chips preview with
 *  the row's own ink / background / scale, like the built-in chips. */
export const CustomPatternChips = ({
	patterns,
	activeIdx,
	onPick,
	onDelete,
	onAdd,
	inkColor,
	bgColor,
	scale,
	ariaName,
}: {
	patterns: ReadonlyArray<CustomPattern | null>
	/** The row's current pick (null / -1 = none or a built-in). */
	activeIdx: number | null
	onPick: (idx: number) => void
	onDelete: (slot: number) => void
	onAdd: () => void
	inkColor: string
	bgColor: string
	scale?: number | null
	/** Accessible-name prefix, e.g. "Pattern option" / "Polygon pattern
	 *  option" — the chips read "<prefix> custom 1". */
	ariaName: string
}) => (
	<>
		{patterns.map((p, slot) => {
			if (!p) return null
			const idx = CUSTOM_PATTERN_BASE + slot
			const selected = idx === activeIdx
			return (
				<span key={idx} className="group group/pattern relative">
					<button
						type="button"
						onClick={() => onPick(idx)}
						aria-pressed={selected}
						aria-label={`${ariaName} custom ${slot + 1}`}
						className={swatchChipClass(selected, "w-7")}
					>
						<PatternGlyph
							idx={idx}
							selected={selected}
							inkColor={inkColor}
							bgColor={bgColor}
							scale={scale}
						/>
					</button>
					<button
						type="button"
						aria-label={`Delete custom pattern ${slot + 1}`}
						onClick={() => onDelete(slot)}
						className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-stone-600 text-[11px] leading-none text-white before:absolute before:-inset-1 before:content-[''] group-hover:flex kbd:group-has-focus-visible/pattern:flex dark:bg-stone-400 dark:text-stone-900"
					>
						×
					</button>
				</span>
			)
		})}
		<button
			type="button"
			onClick={onAdd}
			aria-label="Add custom pattern"
			title="Custom pattern — upload a black-and-white image"
			className={swatchChipClass(false, "w-7")}
		>
			+
		</button>
	</>
)

/** Inline editor opened by the "+" chip: upload a black-and-white PNG /
 *  JPEG. Creation goes through `onCreate`, which also selects the new
 *  pattern for the row that opened the editor. */
export const CustomPatternEditor = ({
	onCreate,
	onClose,
}: {
	onCreate: (p: CustomPattern) => void
	onClose: () => void
}) => {
	const [error, setError] = useState<string | null>(null)
	return (
		<div className="flex flex-col gap-1 text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<label className="cursor-pointer underline hover:text-stone-900 dark:hover:text-white vc-muted">
					upload image
					<input
						type="file"
						accept={CUSTOM_PATTERN_ACCEPT}
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0]
							e.target.value = ""
							if (!file) return
							setError(null)
							fileToCustomPattern(file)
								.then((p) => {
									onCreate(p)
									onClose()
								})
								.catch((err: unknown) =>
									setError(
										err instanceof Error
											? err.message
											: "Couldn't read that image"
									)
								)
						}}
					/>
				</label>
				<button
					type="button"
					onClick={onClose}
					className="underline hover:text-stone-900 dark:hover:text-white vc-muted"
				>
					cancel
				</button>
			</div>
			<span className="vc-help">
				A black-and-white PNG or JPEG, used as one repeating tile. Black
				takes the ink color, white the background. Non-square images are
				squeezed to a square. Use Scale to size the tile.
			</span>
			{error && (
				<span className="text-red-600 dark:text-red-400">{error}</span>
			)}
		</div>
	)
}
