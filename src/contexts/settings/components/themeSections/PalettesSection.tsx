import { useId, useState } from "react"

import type { SavedCategoricalPalette } from "../../../chartBuilder/lib/types"
import { ColorInput as UiColorInput } from "../../../../components/ui/ColorInput"

import { Section, SectionGroup } from "./controls"
import {
	reorderPaletteColors,
	updateCategoricalPalette,
} from "./paletteHelpers"
import type { ThemeSectionProps } from "./types"

/** One editable palette card — star (set-as-default), name, swatch row with
 *  add / remove-last and drag-to-reorder. Shared by the categorical and ordinal lists, which
 *  differ only in which theme key holds the default, how a patch is applied,
 *  and what a swatch is called ("Hue" vs "Step"). */
const PaletteCard = ({
	palette,
	isDefault,
	swatchNoun,
	deleteDisabled,
	isReadOnly,
	onMakeDefault,
	onUpdate,
	onDelete,
}: {
	palette: SavedCategoricalPalette
	isDefault: boolean
	/** Singular noun for a color slot, used in the swatch's screen-reader
	 *  label ("Hue 1" / "Step 1"). */
	swatchNoun: string
	deleteDisabled: boolean
	/** The surrounding fieldset disables the inputs, but not a drag on the
	 *  swatch wrappers — so read-only has to switch dragging off here. */
	isReadOnly: boolean
	onMakeDefault: () => void
	onUpdate: (patch: Partial<SavedCategoricalPalette>) => void
	onDelete: () => void
}) => {
	// Drag-to-reorder state, mirroring the level list in FieldList: the
	// swatch being dragged and the insertion gap (0..n) under the pointer.
	const [dragIndex, setDragIndex] = useState<number | null>(null)
	const [dropSlot, setDropSlot] = useState<number | null>(null)
	const endDrag = () => {
		setDragIndex(null)
		setDropSlot(null)
	}
	// Only gaps that would actually move the swatch get an indicator.
	const activeSlot =
		dragIndex !== null &&
		dropSlot !== null &&
		dropSlot !== dragIndex &&
		dropSlot !== dragIndex + 1
			? dropSlot
			: null
	const lastIndex = palette.colors.length - 1

	return (
	<div className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
		<div className="flex items-center gap-2">
			<button
				type="button"
				title={isDefault ? "Default palette" : "Set as default"}
				aria-label={isDefault ? "Default palette" : "Set as default"}
				aria-pressed={isDefault}
				onClick={onMakeDefault}
				className={`text-lg leading-none ${isDefault ? "text-amber-500" : "text-stone-300 hover:text-amber-400 dark:text-stone-600"}`}
			>
				{isDefault ? "★" : "☆"}
			</button>
			<input
				type="text"
				value={palette.name}
				aria-label="Palette name"
				onChange={(e) => onUpdate({ name: e.target.value })}
				className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			/>
			<button
				type="button"
				disabled={deleteDisabled}
				onClick={onDelete}
				className="ml-auto text-sm text-stone-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:text-red-400"
			>
				Delete
			</button>
		</div>
		<div className="flex flex-wrap gap-1">
			{palette.colors.map((color, i) => (
				<div
					// eslint-disable-next-line react/no-array-index-key
					key={i}
					data-testid="palette-swatch"
					draggable={!isReadOnly}
					title={isReadOnly ? undefined : "Drag to reorder"}
					onDragStart={(e) => {
						if (isReadOnly) {
							e.preventDefault()
							return
						}
						setDragIndex(i)
						setDropSlot(null)
						// Firefox refuses to start a drag with no payload, even
						// though the drop reads the index from local state.
						e.dataTransfer.setData("text/plain", color)
						e.dataTransfer.effectAllowed = "move"
					}}
					onDragOver={(e) => {
						if (dragIndex === null) return
						// preventDefault is what marks this swatch a valid target.
						e.preventDefault()
						e.dataTransfer.dropEffect = "move"
						// Swatches flow left-to-right, so the pointer's half picks
						// the gap before or after this swatch.
						const rect = e.currentTarget.getBoundingClientRect()
						const after = e.clientX - rect.left > rect.width / 2
						setDropSlot(after ? i + 1 : i)
					}}
					onDrop={(e) => {
						if (dragIndex === null) return
						e.preventDefault()
						if (dropSlot !== null) {
							const patch = reorderPaletteColors(palette, dragIndex, dropSlot)
							if (patch) onUpdate(patch)
						}
						endDrag()
					}}
					onDragEnd={endDrag}
					className={`relative rounded ${isReadOnly ? "" : "cursor-grab"} ${
						dragIndex === i ? "opacity-50" : ""
					}`}
				>
					{/* Drop indicator: a vertical line centered in the 4px gap
					 *  beside this swatch, marking where the drag will land. The
					 *  trailing gap hangs off the last swatch's right edge. */}
					{activeSlot === i && (
						<span
							aria-hidden
							data-testid="palette-drop-indicator"
							className="pointer-events-none absolute -inset-y-1 -left-[3px] w-0.5 rounded-full bg-indigo-500"
						/>
					)}
					{activeSlot === palette.colors.length && i === lastIndex && (
						<span
							aria-hidden
							data-testid="palette-drop-indicator"
							className="pointer-events-none absolute -inset-y-1 -right-[3px] w-0.5 rounded-full bg-indigo-500"
						/>
					)}
					<UiColorInput
						label={`${swatchNoun} ${i + 1}`}
						labelClassName="sr-only"
						showHexInput={false}
						// These swatches ARE the palette — a picker offering the theme's
						// palette colors to define a palette color is circular.
						showPalettePicker={false}
						value={color}
						onChange={(hex) => {
							const next = [...palette.colors]
							next[i] = hex
							onUpdate({ colors: next })
						}}
					/>
				</div>
			))}
			<button
				type="button"
				onClick={() => {
					const colors = [...palette.colors, "#888888"]
					const inks = palette.patternInks
						? [...palette.patternInks, null]
						: undefined
					onUpdate({
						colors,
						...(inks ? { patternInks: inks } : {}),
					})
				}}
				className="flex h-6 w-10 items-center justify-center self-start rounded border border-dashed border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 dark:border-stone-700"
				title="Add color"
				aria-label="Add color"
			>
				+
			</button>
		</div>
		{palette.colors.length > 2 && (
			<button
				type="button"
				onClick={() => {
					const colors = palette.colors.slice(0, -1)
					const inks = palette.patternInks?.slice(0, -1)
					onUpdate({
						colors,
						...(inks ? { patternInks: inks } : {}),
					})
				}}
				className="self-start text-sm text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-white"
			>
				Remove last color
			</button>
		)}
	</div>
	)
}

export const PalettesSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => {
	// Stable id linking the "Default text label palette" label to its select
	// (the label and control are separated by a description paragraph, so a
	// wrapping <label> would drag the prose into the accessible name).
	const textPaletteSelectId = useId()

	// --- Categorical palette helpers ---
	const updateCatPalette = (
		id: string,
		patch: Partial<SavedCategoricalPalette>
	) => updateCategoricalPalette(theme, set, id, patch)

	const addCatPalette = () => {
		const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("categoricalPalettes", [
			...theme.categoricalPalettes,
			{
				id,
				name: "New palette",
				colors: ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f"],
			},
		])
	}

	const deleteCatPalette = (id: string) => {
		const next = theme.categoricalPalettes.filter((p) => p.id !== id)
		if (next.length === 0) return
		set("categoricalPalettes", next)
		if (theme.defaultCategoricalPaletteId === id) {
			set("defaultCategoricalPaletteId", next[0].id)
		}
	}

	// --- Ordinal palette helpers (mirror the categorical helpers) ---
	const ordinalPalettes = theme.ordinalPalettes ?? []
	const updateOrdPalette = (
		id: string,
		patch: Partial<SavedCategoricalPalette>,
	) =>
		set(
			"ordinalPalettes",
			ordinalPalettes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
		)

	const addOrdPalette = () => {
		const id = `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("ordinalPalettes", [
			...ordinalPalettes,
			{
				id,
				name: "New ordinal palette",
				colors: ["#deebf7", "#9ecae1", "#4292c6", "#2171b5"],
			},
		])
	}

	const deleteOrdPalette = (id: string) => {
		const next = ordinalPalettes.filter((p) => p.id !== id)
		if (next.length === 0) return
		set("ordinalPalettes", next)
		if (theme.defaultOrdinalPaletteId === id) {
			set("defaultOrdinalPaletteId", next[0].id)
		}
	}

	return (
		<SectionGroup title="Color palettes" isReadOnly={isReadOnly}>
			{/* Categorical palettes */}
			<Section title="Categorical palettes">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Named color palettes assigned to categories when hue is mapped to
					a categorical field. Mark one as the default for new
					visualizations. Drag swatches to reorder.
				</p>
				{theme.categoricalPalettes.map((palette) => (
					<PaletteCard
						key={palette.id}
						palette={palette}
						isDefault={palette.id === theme.defaultCategoricalPaletteId}
						swatchNoun="Hue"
						deleteDisabled={theme.categoricalPalettes.length <= 1}
						isReadOnly={isReadOnly}
						onMakeDefault={() =>
							set("defaultCategoricalPaletteId", palette.id)
						}
						onUpdate={(patch) => updateCatPalette(palette.id, patch)}
						onDelete={() => deleteCatPalette(palette.id)}
					/>
				))}
				<button
					type="button"
					onClick={addCatPalette}
					className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
				>
					Add palette
				</button>
				<div className="flex flex-col gap-1 border-t border-stone-200 pt-3 dark:border-stone-700">
					<label
						htmlFor={textPaletteSelectId}
						className="text-sm font-medium text-stone-700 dark:text-stone-300"
					>
						Default text palette
					</label>
					<p className="text-xs text-stone-500 dark:text-stone-400">
						Offered by text color pickers — per-category label colors and
						per-facet title colors. Pick a palette of darker shades that
						pair with your default categorical palette and stay legible as
						text. Without one, those pickers offer the default categorical
						palette (text-encoded labels fall back to a single color).
					</p>
					<select
						id={textPaletteSelectId}
						value={theme.defaultTextPaletteId ?? "__none__"}
						onChange={(e) =>
							set(
								"defaultTextPaletteId",
								e.target.value === "__none__" ? null : e.target.value
							)
						}
						className="self-start rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					>
						<option value="__none__">
							No palette (single fallback color)
						</option>
						{theme.categoricalPalettes.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</div>
			</Section>

			{/* Ordinal palettes — separate from categorical so themes can
			 *  supply sequential (lighter→darker) ramps for ordered
			 *  discrete fields. See spec §4.1 / §12. */}

			<Section title="Ordinal palettes">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Discrete palettes used when hue is mapped to an ordinal field.
					Use these for ordered categories (e.g., &quot;low / medium / high&quot;)
					where a sequential ramp reads as ordered, instead of the
					arbitrary colors a categorical palette uses. Drag swatches to
					reorder.
				</p>
				{ordinalPalettes.map((palette) => (
					<PaletteCard
						key={palette.id}
						palette={palette}
						isDefault={palette.id === theme.defaultOrdinalPaletteId}
						swatchNoun="Step"
						deleteDisabled={ordinalPalettes.length <= 1}
						isReadOnly={isReadOnly}
						onMakeDefault={() => set("defaultOrdinalPaletteId", palette.id)}
						onUpdate={(patch) => updateOrdPalette(palette.id, patch)}
						onDelete={() => deleteOrdPalette(palette.id)}
					/>
				))}
				<button
					type="button"
					onClick={addOrdPalette}
					className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
				>
					Add ordinal palette
				</button>
			</Section>
		</SectionGroup>
	)
}
