import type { PaletteName } from "../../../chartBuilder/lib/channelConfig"
import type {
	SavedDivergingGradient,
	SavedLinearGradient,
} from "../../../chartBuilder/lib/types"

import { Section, SectionGroup, SelectInput } from "./controls"
import type { ThemeSectionProps } from "./types"

const PALETTE_NAMES: PaletteName[] = [
	"viridis",
	"plasma",
	"inferno",
	"magma",
	"blues",
	"BrBG",
	"PiYG",
	"PRGn",
	"PuOr",
	"RdBu",
	"RdYlBu",
	"Spectral",
]

type GradientStop = {
	label: string
	value: string
	onChange: (hex: string) => void
}

/** One editable gradient card — star (set-as-default), name, a preview bar,
 *  and a color input per stop. Linear and diverging gradients differ only in
 *  how many stops they carry, so both lists render through this. */
const GradientCard = ({
	name,
	isDefault,
	stops,
	onMakeDefault,
	onRename,
	onDelete,
}: {
	name: string
	isDefault: boolean
	/** Ordered low → high; the preview bar interpolates through them. */
	stops: GradientStop[]
	onMakeDefault: () => void
	onRename: (name: string) => void
	onDelete: () => void
}) => (
	<div className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
		<div className="flex items-center gap-2">
			<button
				type="button"
				title={isDefault ? "Default gradient" : "Set as default gradient"}
				aria-label={isDefault ? "Default gradient" : "Set as default gradient"}
				aria-pressed={isDefault}
				onClick={onMakeDefault}
				className={`text-lg leading-none ${isDefault ? "text-amber-500" : "text-stone-300 hover:text-amber-400 dark:text-stone-600"}`}
			>
				{isDefault ? "★" : "☆"}
			</button>
			<input
				type="text"
				value={name}
				aria-label="Gradient name"
				onChange={(e) => onRename(e.target.value)}
				className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			/>
			<button
				type="button"
				onClick={onDelete}
				className="ml-auto text-sm text-stone-500 hover:text-red-600 dark:text-stone-400 dark:hover:text-red-400"
			>
				Delete
			</button>
		</div>
		<div
			className="h-6 w-full rounded"
			style={{
				background: `linear-gradient(to right, ${stops.map((s) => s.value).join(", ")})`,
			}}
		/>
		<div className="flex justify-between">
			{stops.map((stop) => (
				<label
					key={stop.label}
					className="flex flex-col items-center gap-0.5"
				>
					<input
						type="color"
						value={stop.value}
						onChange={(e) => stop.onChange(e.target.value)}
						className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
					/>
					<span className="text-sm text-stone-600 dark:text-stone-400">
						{stop.label}
					</span>
				</label>
			))}
		</div>
	</div>
)

export const GradientsSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => {
	// --- Linear gradient helpers ---
	const updateLinGradient = (id: string, patch: Partial<SavedLinearGradient>) =>
		set(
			"linearGradients",
			theme.linearGradients.map((g) => (g.id === id ? { ...g, ...patch } : g))
		)

	const addLinGradient = () => {
		const id = `lin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("linearGradients", [
			...theme.linearGradients,
			{ id, name: "New gradient", low: "#f7fbff", high: "#08306b" },
		])
	}

	const deleteLinGradient = (id: string) => {
		const next = theme.linearGradients.filter((g) => g.id !== id)
		set("linearGradients", next)
		if (theme.defaultGradientPalette === id) {
			set("defaultGradientPalette", "viridis")
		}
	}

	// --- Diverging gradient helpers ---
	const updateDivGradient = (
		id: string,
		patch: Partial<SavedDivergingGradient>
	) =>
		set(
			"divergingGradients",
			theme.divergingGradients.map((g) =>
				g.id === id ? { ...g, ...patch } : g
			)
		)

	const addDivGradient = () => {
		const id = `div-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("divergingGradients", [
			...theme.divergingGradients,
			{
				id,
				name: "New diverging",
				low: "#d73027",
				mid: "#ffffbf",
				high: "#1a9850",
			},
		])
	}

	const deleteDivGradient = (id: string) => {
		const next = theme.divergingGradients.filter((g) => g.id !== id)
		set("divergingGradients", next)
		if (theme.defaultGradientPalette === id) {
			set("defaultGradientPalette", "viridis")
		}
	}

	return (
		<SectionGroup title="Gradients" isReadOnly={isReadOnly}>
			<Section title="Default gradient">
				<SelectInput
					label="Default"
					value={theme.defaultGradientPalette}
					onChange={(v) => set("defaultGradientPalette", v)}
					options={[
						...PALETTE_NAMES.map((n) => ({
							label: n,
							value: n,
						})),
						...theme.linearGradients.map((g) => ({
							label: `${g.name} (linear)`,
							value: g.id,
						})),
						...theme.divergingGradients.map((g) => ({
							label: `${g.name} (diverging)`,
							value: g.id,
						})),
					]}
				/>
			</Section>

			{/* Linear gradients */}
			<Section title="Linear gradients">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Two-stop gradients for quantitative fields.
				</p>
				{theme.linearGradients.map((gradient) => (
					<GradientCard
						key={gradient.id}
						name={gradient.name}
						isDefault={gradient.id === theme.defaultGradientPalette}
						onMakeDefault={() =>
							set("defaultGradientPalette", gradient.id)
						}
						onRename={(name) => updateLinGradient(gradient.id, { name })}
						onDelete={() => deleteLinGradient(gradient.id)}
						stops={[
							{
								label: "Low",
								value: gradient.low,
								onChange: (low) => updateLinGradient(gradient.id, { low }),
							},
							{
								label: "High",
								value: gradient.high,
								onChange: (high) => updateLinGradient(gradient.id, { high }),
							},
						]}
					/>
				))}
				<button
					type="button"
					onClick={addLinGradient}
					className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
				>
					Add gradient
				</button>
			</Section>

			{/* Diverging gradients */}
			<Section title="Diverging gradients">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Three-stop gradients for data with a meaningful midpoint.
				</p>
				{theme.divergingGradients.map((gradient) => (
					<GradientCard
						key={gradient.id}
						name={gradient.name}
						isDefault={gradient.id === theme.defaultGradientPalette}
						onMakeDefault={() =>
							set("defaultGradientPalette", gradient.id)
						}
						onRename={(name) => updateDivGradient(gradient.id, { name })}
						onDelete={() => deleteDivGradient(gradient.id)}
						stops={[
							{
								label: "Low",
								value: gradient.low,
								onChange: (low) => updateDivGradient(gradient.id, { low }),
							},
							{
								label: "Mid",
								value: gradient.mid,
								onChange: (mid) => updateDivGradient(gradient.id, { mid }),
							},
							{
								label: "High",
								value: gradient.high,
								onChange: (high) => updateDivGradient(gradient.id, { high }),
							},
						]}
					/>
				))}
				<button
					type="button"
					onClick={addDivGradient}
					className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
				>
					Add gradient
				</button>
			</Section>
		</SectionGroup>
	)
}
