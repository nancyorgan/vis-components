import { useMemo, useRef, useState } from "react"

import { CATEGORICAL_HUE_PALETTE } from "../../contexts/chartBuilder/lib/scales"
import { resolveTextPickerPalette } from "../../contexts/chartBuilder/lib/themeConfig"
import { useCurrentTheme } from "../../contexts/chartBuilder/store/useCurrentTheme"

import { DisclosureChevron } from "./Chevron"

/** Circular-arrow button that opens a swatch popover of the palette's
 *  colors — a quick on-palette alternative to the open-ended color picker
 *  beside it. Swatches wrap at 6 per row; picking one commits it and closes
 *  the popover. (Replaces the old step-to-next-color cycling, where
 *  overshooting a color meant clicking all the way around again.) A
 *  disclosure chevron at the popover's bottom expands it with the theme's
 *  OTHER palettes (categorical + ordinal), one whitespace-separated swatch
 *  group per palette, for borrowing a color from a palette the swatch isn't
 *  on. */
export const PalettePickerButton = ({
	palette: paletteProp,
	paletteKind = "categorical",
	current,
	onPick,
	label,
}: {
	/** Colors the popover offers. Omit for the theme palette `paletteKind`
	 *  names — the colors a fresh chart draws with, which is the right answer
	 *  for any swatch that isn't part of a specific scheme. */
	palette?: readonly string[]
	/** Which theme palette leads the popover when `palette` is omitted.
	 *  `"text"` = the theme's designated TEXT palette (shades chosen to stay
	 *  legible at text sizes), for any swatch that colors TEXT — tick labels,
	 *  titles, captions, annotation text, data labels. Falls back to the
	 *  default categorical palette when the theme sets no text palette. The
	 *  other theme palettes stay one chevron away either way. */
	paletteKind?: "categorical" | "text"
	current: string
	onPick: (color: string) => void
	label: string
}) => {
	const [open, setOpen] = useState(false)
	const [showOthers, setShowOthers] = useState(false)
	const theme = useCurrentTheme()
	const palette =
		paletteProp ??
		(paletteKind === "text"
			? resolveTextPickerPalette(theme)
			: theme.categoricalPalettes.find(
					(p) => p.id === theme.defaultCategoricalPaletteId
				)?.colors) ??
		CATEGORICAL_HUE_PALETTE
	const containerRef = useRef<HTMLDivElement>(null)
	// Every theme palette except the one already shown, deduped by color
	// content (not id — `palette` arrives as bare colors, and the same
	// colors can back several entries).
	const otherPalettes = useMemo(() => {
		const key = (colors: readonly string[]) =>
			colors.map((c) => c.toLowerCase()).join("|")
		const seen = new Set([key(palette)])
		return [
			...theme.categoricalPalettes,
			...(theme.ordinalPalettes ?? []),
		].filter((p) => {
			if (p.colors.length === 0 || seen.has(key(p.colors))) return false
			seen.add(key(p.colors))
			return true
		})
	}, [theme, palette])
	// Close when focus leaves the button + popover entirely (tab away or
	// click elsewhere); moving focus onto a swatch keeps it open. Attached
	// to each button (not the wrapper div) so the wrapper stays inert.
	const close = () => {
		setOpen(false)
		setShowOthers(false)
	}
	const closeIfFocusLeft = (e: React.FocusEvent) => {
		if (!containerRef.current?.contains(e.relatedTarget as Node)) {
			close()
		}
	}
	const closeOnEscape = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") close()
	}
	const swatchGroup = (colors: readonly string[]) => (
		<div className="flex flex-wrap gap-1">
			{colors.map((c, i) => {
				const isCurrent = c.toLowerCase() === current.toLowerCase()
				return (
					<button
						// eslint-disable-next-line react/no-array-index-key -- palettes may repeat a color
						key={`${i}-${c}`}
						type="button"
						onClick={() => {
							onPick(c)
							close()
						}}
						onBlur={closeIfFocusLeft}
						onKeyDown={closeOnEscape}
						aria-label={`Use ${c}`}
						title={c}
						className={`h-5 w-5 flex-shrink-0 rounded ${
							isCurrent
								? "ring-1 ring-stone-900 dark:ring-white"
								: ""
						}`}
						style={{ backgroundColor: c }}
					/>
				)
			})}
		</div>
	)
	if (palette.length === 0) return null
	return (
		<div ref={containerRef} className="relative flex-shrink-0">
			<button
				type="button"
				onClick={() => (open ? close() : setOpen(true))}
				onBlur={closeIfFocusLeft}
				onKeyDown={closeOnEscape}
				aria-label={label}
				aria-haspopup="true"
				aria-expanded={open}
				title="Pick a palette color"
				className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
			>
				<svg
					viewBox="0 0 24 24"
					width={15}
					height={15}
					aria-hidden="true"
					fill="none"
					stroke="currentColor"
					strokeWidth={2.4}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Open ~300° arc (clear gap top-right) ending in a distinct
					 *  arrowhead so the control reads as "palette", not a closed
					 *  circle. */}
					<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
					<polyline points="23 4 23 10 17 10" />
				</svg>
			</button>
			{open && (
				/* w-max is load-bearing: an abs-positioned box shrink-to-fits
				 *  against its containing block — here the tiny button wrapper —
				 *  which would collapse the row to one swatch per line (a
				 *  vertical stack). max-content sizing lays the swatches out
				 *  horizontally; max-w then caps each group's line at exactly 6
				 *  h-5 swatches (6×1.25rem + 5×0.25rem gap + p-1.5 + border), so
				 *  longer palettes wrap at 6 per row. The column's gap-2 is the
				 *  whitespace separating one palette's swatch group from the
				 *  next. Anchored to the button's right edge so it stays inside
				 *  the sidebar. */
				<div className="absolute right-0 top-full z-20 mt-1 flex w-max max-w-[10rem] flex-col gap-2 rounded border border-stone-300 bg-white p-1.5 shadow-lg dark:border-stone-600 dark:bg-stone-800">
					{swatchGroup(palette)}
					{showOthers &&
						otherPalettes.map((p) => (
							<div key={p.id}>{swatchGroup(p.colors)}</div>
						))}
					{otherPalettes.length > 0 && (
						<button
							type="button"
							onClick={() => setShowOthers((s) => !s)}
							onBlur={closeIfFocusLeft}
							onKeyDown={closeOnEscape}
							aria-label={
								showOthers
									? "Hide other theme palettes"
									: "Show other theme palettes"
							}
							aria-expanded={showOthers}
							title={
								showOthers
									? "Hide other theme palettes"
									: "Show other theme palettes"
							}
							className="-my-0.5 flex h-4 w-full flex-shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
						>
							<DisclosureChevron open={showOthers} />
						</button>
					)}
				</div>
			)}
		</div>
	)
}
