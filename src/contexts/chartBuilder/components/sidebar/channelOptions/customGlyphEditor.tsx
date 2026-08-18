import { useState } from "react"

import type { CustomGlyph } from "../../../lib/channelConfig"
import {
	CUSTOM_GLYPH_BASE,
	fileToGlyph,
	GlyphMark,
	glyphCharCount,
	MAX_TEXT_GLYPH_CHARS,
	sanitizeGlyphText,
} from "../../../lib/customGlyphs"
import {
	expandEmojiInput,
	expandEmojiShortcodes,
} from "../../../lib/emojiShortcodes"
import { CHIP_INK } from "../../../lib/previewInk"

import { PREVIEW_SIZE } from "./glyphShared"

/** Shared chip-button styling for the shape rows (built-in glyphs inline
 *  the same string; new custom-glyph chips reuse it from here). */
const chipClass = (selected: boolean) =>
	`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
		selected
			? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
			: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
	}`

/** Chip preview for a custom glyph. Text tints like the built-in glyphs;
 *  images render as-is (slightly larger radius so they use the chip). */
const CustomGlyphPreview = ({
	glyph,
	selected,
}: {
	glyph: CustomGlyph
	selected: boolean
}) => (
	<svg
		width={PREVIEW_SIZE}
		height={PREVIEW_SIZE}
		viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
		aria-hidden="true"
	>
		<GlyphMark
			glyph={glyph}
			r={glyph.kind === "image" ? 8 : 5}
			fill={selected ? "currentColor" : CHIP_INK}
			fillOpacity={0.9}
		/>
	</svg>
)

/** The custom-glyph chips appended to every shape row: one selectable chip
 *  per saved glyph (with an ×-on-hover delete) plus the "+" chip that opens
 *  the add-custom editor. Glyph slots are shared chart-wide — a glyph
 *  created from any row is selectable from all of them. */
export const CustomGlyphChips = ({
	glyphs,
	activeIdx,
	onPick,
	onDelete,
	onAdd,
}: {
	glyphs: ReadonlyArray<CustomGlyph | null>
	activeIdx: number
	onPick: (idx: number) => void
	onDelete: (slot: number) => void
	onAdd: () => void
}) => (
	<>
		{glyphs.map((g, slot) => {
			if (!g) return null
			const idx = CUSTOM_GLYPH_BASE + slot
			const selected = idx === activeIdx
			return (
				<span key={idx} className="group relative">
					<button
						type="button"
						onClick={() => onPick(idx)}
						aria-pressed={selected}
						className={chipClass(selected)}
					>
						<CustomGlyphPreview glyph={g} selected={selected} />
					</button>
					<button
						type="button"
						aria-label="Delete custom shape"
						onClick={() => onDelete(slot)}
						className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-stone-500 text-[9px] leading-none text-white group-hover:flex dark:bg-stone-400 dark:text-stone-900"
					>
						×
					</button>
				</span>
			)
		})}
		<button
			type="button"
			onClick={onAdd}
			aria-label="Add custom shape"
			title="Custom shape — type characters or upload an image"
			className={chipClass(false)}
		>
			+
		</button>
	</>
)

/** Inline editor opened by the "+" chip: type a short text glyph or upload
 *  an image. Creation goes through `onCreate`, which also selects the new
 *  glyph for the row that opened the editor. */
export const CustomGlyphEditor = ({
	onCreate,
	onClose,
}: {
	onCreate: (g: CustomGlyph) => void
	onClose: () => void
}) => {
	const [text, setText] = useState("")
	const [error, setError] = useState<string | null>(null)
	// Validate on submit, never truncate while typing — live truncation
	// breaks emoji shortcodes (":joy" was getting chopped to ":jo").
	// Browsers don't expand shortcodes on their own, so the editor does:
	// a complete ":name:" converts on the keystroke (see onChange); a
	// bare ":joy" left in the box converts here at validate/submit time.
	// Counts are user-perceived characters, so one emoji = 1 however
	// many code points compose it.
	const expanded = expandEmojiInput(text)
	const count = glyphCharCount(expanded)
	const tooLong = count > MAX_TEXT_GLYPH_CHARS
	const canSubmit = count > 0 && !tooLong
	const submitText = () => {
		if (!canSubmit) return
		onCreate({ kind: "text", text: sanitizeGlyphText(expanded) })
		onClose()
	}
	return (
		<div className="flex flex-col gap-1 text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<input
					type="text"
					value={text}
					// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the editor the user just opened via the "+" chip
					autoFocus
					onChange={(e) => {
						setError(null)
						// Typing the closing colon of a known :shortcode:
						// converts it in place; anything else passes through
						// untouched (no truncation — see the note above).
						setText(expandEmojiShortcodes(e.target.value))
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") submitText()
					}}
					placeholder="Aa ★ 🔥"
					aria-label="Custom shape text"
					className="w-20 rounded border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-900"
				/>
				<button
					type="button"
					onClick={submitText}
					disabled={!canSubmit}
					className="rounded border border-stone-300 bg-white px-2 py-1 text-stone-700 hover:border-stone-500 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
				>
					Add
				</button>
				<span className="text-stone-500 dark:text-stone-400">or</span>
				<label className="cursor-pointer text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white">
					upload image
					<input
						type="file"
						accept="image/*"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0]
							e.target.value = ""
							if (!file) return
							fileToGlyph(file)
								.then((g) => {
									onCreate(g)
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
					className="text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
				>
					cancel
				</button>
			</div>
			{tooLong ? (
				<span className="text-red-600 dark:text-red-400">
					Up to {MAX_TEXT_GLYPH_CHARS} characters — shorten to add.
				</span>
			) : (
				<span className="vc-help">
					Up to {MAX_TEXT_GLYPH_CHARS} characters — emoji work
					(paste, :fire: shortcodes, or your system emoji picker).
					Spaces count: a lone space makes a blank mark.
				</span>
			)}
			{error && (
				<span className="text-red-600 dark:text-red-400">{error}</span>
			)}
		</div>
	)
}
