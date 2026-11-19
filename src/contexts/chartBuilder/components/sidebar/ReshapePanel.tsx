import { useAtomValue, useSetAtom } from "jotai"
import { useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "../../../../components/ui/Button"
import { Checkbox } from "../../../../components/ui/Checkbox"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { Input } from "../../../../components/ui/Input"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { Segmented } from "../../../../components/ui/Segmented"
import { splitDerivedVariablesAroundReshape } from "../../lib/derivedReshapeStages"
import { bakeTransforms } from "../../lib/materializeTransforms"
import { nameCollides } from "../../lib/nameUniqueness"
import {
	DEFAULT_PIVOT_CONFIG,
	pivotApplies,
	pivotDataset,
	pivotGroups,
	pivotIssues,
	type PivotConfig,
	type PivotGroup,
} from "../../lib/pivot"
import {
	DEFAULT_RESHAPE_CONFIG,
	defaultGroupValueName,
	defaultGroupVariableName,
	presentGroupFields,
	reshapeApplies,
	reshapeGroups,
	reshapeIssues,
	type ReshapeConfig,
	type ReshapeGroup,
} from "../../lib/reshape"
import type { DatasetView, Field } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentFieldOverridesAtom,
	currentReshapeConfigAtom,
	datasetIndexAtom,
	derivedVariableEditorAtom,
	reshapePanelOpenAtom,
} from "../../store/atoms"
import { saveModeFor, suggestedCopyName } from "../../store/commitDatasetVersion"
import { currentRawDatasetViewAtom } from "../../store/useCurrentDatasetView"
import { useApplyReshape, type ReshapeDraft } from "../../store/useMaterializeVersion"
import { IconButton } from "../../../../components/ui/IconButton"

/** Reshape options under Data, shown by the data tray's "Reshape" button.
 * A Direction toggle picks the form: **Wide → long** (the default — a melt:
 * combine several columns into a category + value pair) or **Long → wide**
 * (a pivot: spread one column's values out into columns of their own). The
 * checkboxes are a DRAFT: nothing changes until "Apply reshape", which
 * reshapes the version shown and saves the result as a NEW DATA VERSION
 * (`store/useMaterializeVersion.ts`) — the first change to imported data
 * forks a working copy, a change to a working copy appends a version — then
 * closes the menu. The stored table is never rewritten; the version list
 * takes you back to it. The lists hold the columns of the version shown
 * plus, for a visual saved before reshapes became versions, the live
 * derived variables that can be computed from them (ƒ-marked, after the
 * data columns like the tray; such a visual's live melt seeds the wide→long
 * draft, and applying folds it all into the version). Half-configured
 * drafts (nothing checked yet, name collisions) just disable Apply, with
 * the reason shown.
 *
 * Wide → long: "+ Add another group" adds a second Combine list with its
 * own pair of names: its columns pair with the first group's by position
 * (the i-th column of every group lands on the same row), and a shorter
 * group gets blank cells past its last column — the panel says so. Blanked
 * name boxes fall back to the "category" / "value" defaults shown as
 * placeholders.
 *
 * Long → wide: the checked **Split out** column's values name the new
 * columns, the checked **Fill with** column's cells fill them, and rows
 * sharing the same ID cells become one row. Two or more split-out columns
 * name a column by their values together; two or more value columns put
 * the value column's name in front ("sales 2023"). "+ Add another group"
 * adds a second Split out + Fill with pair whose new columns sit beside
 * the first group's on the same ID rows — the mirror of the melt's paired
 * groups.
 *
 * In every list a column lives in one place only: checking it anywhere
 * withdraws it from the others. */
export const ReshapePanel = () => {
	const open = useAtomValue(reshapePanelOpenAtom)
	const raw = useAtomValue(currentRawDatasetViewAtom)
	if (!open || !raw) return null
	// Mounted only while the menu is open, and keyed by what it reshapes, so
	// every opening starts a fresh draft from the stored state.
	return <ReshapeMenu key={`${raw.id}:${raw.versionId}`} raw={raw} />
}

type Direction = "melt" | "pivot"

const DIRECTIONS: ReadonlyArray<{ key: Direction; label: string }> = [
	{ key: "melt", label: "Wide → long" },
	{ key: "pivot", label: "Long → wide" },
]

const ReshapeMenu = ({ raw }: { raw: DatasetView }) => {
	const [direction, setDirection] = useState<Direction>("melt")
	return (
		// mt-2: the Data section body has no gap of its own and the upload
		// controls render directly above.
		<div className="vc-option-panel mt-2">
			{/* defaultOpen: the panel only mounts right after the tray's Reshape
			 *  button enables it, and that click should reveal the options. */}
			<CollapsibleSubsection title="Reshape" defaultOpen>
				<div className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL}>Direction</span>
					<Segmented
						ariaLabel="Reshape direction"
						value={direction}
						segments={DIRECTIONS}
						onChange={setDirection}
					/>
				</div>
				{/* Each form keeps its own draft; switching direction starts the
				 *  other one fresh. */}
				{direction === "melt" ? <MeltForm raw={raw} /> : <PivotForm raw={raw} />}
			</CollapsibleSubsection>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Shared by both forms
// ---------------------------------------------------------------------------

/** Where Apply lands — a fork of imported data (with a name box) or an
 *  append to a working copy — and the fork's name. */
const useSaveTarget = (raw: DatasetView) => {
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const meta = datasetId ? datasetIndex[datasetId] : undefined
	const mode = meta ? saveModeFor(meta) : "fork"
	const [name, setName] = useState(() =>
		mode === "fork" ? suggestedCopyName(raw.name, "reshaped") : raw.name
	)
	// Same-named data sets are allowed (the id is the identity); a collision
	// only warns. Appending keeps the data set, so its own name doesn't count.
	const collides = nameCollides(
		name,
		Object.values(datasetIndex),
		mode === "append" ? (datasetId ?? undefined) : undefined
	)
	return { mode, name, setName, collides }
}
type SaveTarget = ReturnType<typeof useSaveTarget>

/** Running Apply: the busy flag, the error line, and closing the menu on
 *  success. */
const useApplyDraft = (name: string) => {
	const setOpen = useSetAtom(reshapePanelOpenAtom)
	const applyReshape = useApplyReshape()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const run = async (draft: ReshapeDraft) => {
		setBusy(true)
		setError(null)
		const result = await applyReshape(draft, name)
		setBusy(false)
		if (!result.ok) {
			setError(result.error)
			return
		}
		setOpen(false)
	}
	return { busy, error, run }
}

/** The columns a form's lists offer: the version's columns plus the live
 *  derived variables that can run before the reshape (only the names matter
 *  to the checks; the type is a stand-in). */
const withCandidates = (
	fields: readonly Field[],
	candidates: ReadonlyArray<{ name: string }>
): Field[] => [
	...fields,
	...candidates.map(
		(c): Field => ({ name: c.name, inferredType: "categorical", derived: true })
	),
]

/** The checkbox label: the ƒ edit marker (derived variables only) then the
 *  truncating column name. The marker is a button inside the label, so a
 *  click on it edits without toggling the box — a derived variable under
 *  Combine has no column of its own after the melt, so this is where it's
 *  reachable. */
const useColumnLabel = (candidates: ReadonlyArray<{ id: string; name: string }>) => {
	const setDerivedEditor = useSetAtom(derivedVariableEditorAtom)
	const derivedIdByName = new Map(candidates.map((c) => [c.name, c.id]))
	return (f: Field): ReactNode => (
		<>
			{f.derived ? (
				<button
					type="button"
					onClick={(e) => {
						e.preventDefault()
						const id = derivedIdByName.get(f.name)
						if (id) setDerivedEditor({ mode: "edit", id })
					}}
					title="Edit calculation"
					aria-label={`Edit derived variable ${f.name}`}
					className="flex-shrink-0 font-serif text-xs italic text-brand-500 hover:text-brand-700 dark:text-indigo-400 dark:hover:text-indigo-300"
				>
					ƒ
				</button>
			) : null}
			<span className="min-w-0 truncate">
				{f.name}
			</span>
		</>
	)
}

const CHECKBOX_CLASS =
	"min-w-0 [&>label]:flex [&>label]:min-w-0 [&>label]:items-center [&>label]:gap-2"

const Issues = ({ issues }: { issues: string[] }) => (
	<>
		{issues.map((issue) => (
			<p key={issue} className="text-xs text-amber-600 dark:text-amber-400">
				{issue}
			</p>
		))}
	</>
)

/** What Apply would save: the counts line. */
const CountsLine = ({
	from,
	to,
}: {
	from: { rows: unknown[]; fields: unknown[] }
	to: { rows: unknown[]; fields: unknown[] }
}) => (
	<p className="vc-help">
		{from.rows.length} rows × {from.fields.length} columns → {to.rows.length}{" "}
		rows × {to.fields.length} columns.
	</p>
)

/** The bottom of either form: where the version lands (and the fork's name
 *  box), the error line, Apply and Cancel. */
const ApplyFooter = ({
	raw,
	target,
	error,
	canApply,
	onApply,
}: {
	raw: DatasetView
	target: SaveTarget
	error: string | null
	canApply: boolean
	onApply: () => void
}) => {
	const setOpen = useSetAtom(reshapePanelOpenAtom)
	const { mode, name, setName, collides } = target
	return (
		<>
			{mode === "fork" ? (
				<>
					<p className="vc-help">
						Reshaping creates a new data set version.{" "}
						<span className="font-medium vc-text">&ldquo;{raw.name}&rdquo;</span>{" "}
						stays as it is, and this visualization moves to the reshaped
						copy.
					</p>
					<label className="flex flex-col gap-1 text-sm">
						<span className="vc-text">Data set name</span>
						<Input
							type="text"
							className="w-full"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					{collides && (
						<p className="vc-notice-warning text-xs">
							A data set named &ldquo;{name.trim()}&rdquo; already exists.
							This will be saved as a separate data set with the same name.
						</p>
					)}
				</>
			) : (
				<p className="vc-help">
					Reshaping adds a new version of this data set.
				</p>
			)}
			{error && (
				<p
					role="alert"
					className="vc-notice-error text-xs"
				>
					{error}
				</p>
			)}
			<div className="flex gap-2">
				<Button compact onClick={onApply} disabled={!canApply} className="flex-1">
					Apply reshape
				</Button>
				{/* Same as re-clicking the tray's Reshape button: hides this menu
				 *  and drops the draft. */}
				<Button compact onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------
// Wide → long (melt)
// ---------------------------------------------------------------------------

const MeltForm = ({ raw }: { raw: DatasetView }) => {
	const legacy = useAtomValue(currentReshapeConfigAtom)
	const legacyDerived = useAtomValue(currentDerivedVariablesAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const target = useSaveTarget(raw)
	const apply = useApplyDraft(target.name)
	// The draft: seeded from the live config an older visual still carries
	// (so its reshape can be saved as it stands), the defaults otherwise.
	const [config, setConfig] = useState<ReshapeConfig>(legacy)
	// Render keys for the extra groups (they have no identity of their own in
	// the config), so removing one from the middle keeps the others' boxes.
	const nextGroupKey = useRef((legacy.extraGroups ?? []).length)
	const [extraKeys, setExtraKeys] = useState<number[]>(() =>
		(legacy.extraGroups ?? []).map((_, i) => i)
	)

	// Which live derived variables the draft could list and would compute
	// before the melt — see derivedReshapeStages.ts. Empty for a visual
	// made since derived variables became data versions.
	const stages = useMemo(
		() => splitDerivedVariablesAroundReshape(raw.fields, legacyDerived, config),
		[raw, legacyDerived, config]
	)
	// The columns the lists offer, the draft's naming issues, and what Apply
	// would save — the counts line reads it out. One memo, so the melt
	// reruns on a draft change, not on every keystroke in the name box.
	const { fields, issues, applies, baked } = useMemo(() => {
		const all = withCandidates(raw.fields, stages.candidates)
		const ok = reshapeApplies(all, config)
		return {
			fields: all,
			issues: reshapeIssues(all, config),
			applies: ok,
			baked: ok ? bakeTransforms(raw, overrides, config, legacyDerived) : null,
		}
	}, [raw, stages, config, overrides, legacyDerived])
	const columnLabel = useColumnLabel(stages.candidates)
	const idSet = new Set(config.idFields)
	const groups = reshapeGroups(config)
	// Each group's Combine list offers the columns no other list claims —
	// not an ID column, not combined by another group.
	const claimedBy = new Map<string, number>()
	groups.forEach((g, i) => {
		for (const n of g.meltFields) if (!claimedBy.has(n)) claimedBy.set(n, i)
	})
	const combineCandidates = (index: number) =>
		fields.filter(
			(f) => !idSet.has(f.name) && (claimedBy.get(f.name) ?? index) === index
		)
	// Groups that melt something, with how many columns each — a shorter
	// group pads with blanks, which the panel points out.
	const groupSizes = presentGroupFields(fields, config)
		.map((own) => own.length)
		.filter((n) => n > 0)
	const padded = groupSizes.length > 1 && new Set(groupSizes).size > 1
	const canApply = applies && !apply.busy && target.name.trim() !== ""

	/** The draft with every group's Combine list passed through `fn`
	 * (index 0 is the config's own list). */
	const withGroups = (
		prev: ReshapeConfig,
		fn: (group: ReshapeGroup, index: number) => ReshapeGroup
	): ReshapeConfig => {
		const [first, ...rest] = reshapeGroups(prev).map(fn)
		return {
			...prev,
			...first,
			...(prev.extraGroups ? { extraGroups: rest } : {}),
		}
	}
	const without = (g: ReshapeGroup, fieldName: string): ReshapeGroup =>
		g.meltFields.includes(fieldName)
			? { ...g, meltFields: g.meltFields.filter((n) => n !== fieldName) }
			: g
	const toggleId = (fieldName: string, on: boolean) =>
		setConfig((prev: ReshapeConfig) =>
			// A column can't be both kept and combined — checking it as an ID
			// column withdraws it from every Combine list.
			withGroups(
				{
					...prev,
					idFields: on
						? [...prev.idFields, fieldName]
						: prev.idFields.filter((n) => n !== fieldName),
				},
				(g) => (on ? without(g, fieldName) : g)
			)
		)
	const toggleMelt = (index: number, fieldName: string, on: boolean) =>
		setConfig((prev: ReshapeConfig) =>
			// Checking a column in one group withdraws it from the others.
			withGroups(prev, (g, i) => {
				const cleared = without(g, fieldName)
				return i === index && on
					? { ...cleared, meltFields: [...cleared.meltFields, fieldName] }
					: cleared
			})
		)
	const setGroupName = (
		index: number,
		key: "variableName" | "valueName",
		value: string
	) =>
		setConfig((prev: ReshapeConfig) =>
			withGroups(prev, (g, i) => (i === index ? { ...g, [key]: value } : g))
		)
	const addGroup = () => {
		setExtraKeys((keys) => [...keys, nextGroupKey.current++])
		setConfig((prev: ReshapeConfig) => {
			const index = (prev.extraGroups?.length ?? 0) + 1
			return {
				...prev,
				extraGroups: [
					...(prev.extraGroups ?? []),
					{
						meltFields: [],
						variableName: defaultGroupVariableName(index),
						valueName: defaultGroupValueName(index),
					},
				],
			}
		})
	}
	const removeGroup = (index: number) => {
		setExtraKeys((keys) => keys.filter((_, i) => i !== index - 1))
		setConfig((prev: ReshapeConfig) => {
			const extraGroups = (prev.extraGroups ?? []).filter(
				(_, i) => i !== index - 1
			)
			const { extraGroups: _dropped, ...rest } = prev
			return extraGroups.length > 0 ? { ...rest, extraGroups } : rest
		})
	}

	return (
		<>
			<p className="vc-help">
				Combine several columns into category/value pair of columns, aka
				long format. The reshaped table will be saved as a new data version.
			</p>
			<div className="vc-divider-group">
				<span className="vc-group-header">ID columns</span>
				<p className="vc-help">Kept as-is on every row (not combined).</p>
				{fields.map((f) => (
					<Checkbox
						key={f.name}
						className={CHECKBOX_CLASS}
						label={columnLabel(f)}
						checked={idSet.has(f.name)}
						onChange={(on) => toggleId(f.name, on)}
					/>
				))}
			</div>
			{groups.map((g, index) => {
				const candidates = combineCandidates(index)
				const suffix = index === 0 ? "" : ` (group ${index + 1})`
				return (
					<div
						key={index === 0 ? "first" : `extra-${extraKeys[index - 1] ?? index}`}
						className="vc-divider-group"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="vc-group-header">Combine{suffix}</span>
							{index > 0 && (
								<IconButton
									onClick={() => removeGroup(index)}
									className="px-1"
									aria-label={`Remove group ${index + 1}`}
								>
									×
								</IconButton>
							)}
						</div>
						<p className="vc-help">
							{index === 0
								? "Each checked column becomes rows of the new pair. Columns that aren't checked at all get left out."
								: "Pairs with the first group by position: the first column here shares a row with the first column there, and so on."}
						</p>
						{candidates.length === 0 ? (
							<p className="vc-help">
								{index === 0
									? "Every column is an ID column. Uncheck some above to combine them."
									: "Every column is already in a list. Uncheck some above to combine them here."}
							</p>
						) : (
							candidates.map((f) => (
								<Checkbox
									key={f.name}
									className={CHECKBOX_CLASS}
									label={columnLabel(f)}
									checked={g.meltFields.includes(f.name)}
									onChange={(on) => toggleMelt(index, f.name, on)}
								/>
							))
						)}
						<label className="flex flex-col gap-1 text-sm">
							<span className="vc-text">Combined variable name{suffix}</span>
							<Input
								type="text"
								className="w-full"
								placeholder={defaultGroupVariableName(index)}
								value={g.variableName}
								onChange={(e) =>
									setGroupName(index, "variableName", e.target.value)
								}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							<span className="vc-text">Value variable name{suffix}</span>
							<Input
								type="text"
								className="w-full"
								placeholder={defaultGroupValueName(index)}
								value={g.valueName}
								onChange={(e) =>
									setGroupName(index, "valueName", e.target.value)
								}
							/>
						</label>
					</div>
				)
			})}
			<button
				type="button"
				onClick={addGroup}
				className="self-end text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				+ Add another group
			</button>
			{padded && (
				<p className="vc-help">
					The groups differ in size: a shorter group gets blank cells on
					the rows past its last column.
				</p>
			)}
			<Issues issues={issues} />
			{baked && <CountsLine from={baked.wide} to={baked} />}
			<ApplyFooter
				raw={raw}
				target={target}
				error={apply.error}
				canApply={canApply}
				onApply={() => void apply.run({ kind: "melt", config })}
			/>
		</>
	)
}

// ---------------------------------------------------------------------------
// Long → wide (pivot)
// ---------------------------------------------------------------------------

/** How many minted names the "New columns" line spells out before "… and N
 *  more". */
const MINTED_PREVIEW = 6

const PivotForm = ({ raw }: { raw: DatasetView }) => {
	const legacyDerived = useAtomValue(currentDerivedVariablesAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const target = useSaveTarget(raw)
	const apply = useApplyDraft(target.name)
	const [config, setConfig] = useState<PivotConfig>(DEFAULT_PIVOT_CONFIG)
	const nextGroupKey = useRef(0)
	const [extraKeys, setExtraKeys] = useState<number[]>([])

	// Live derived variables that could be listed (computed before the
	// pivot) — see derivedReshapeStages.ts.
	const stages = useMemo(
		() =>
			splitDerivedVariablesAroundReshape(
				raw.fields,
				legacyDerived,
				DEFAULT_RESHAPE_CONFIG,
				config
			),
		[raw, legacyDerived, config]
	)
	// The columns the lists offer, and — once something is checked in both
	// lists — the pivot over the table it would actually see (`baked.wide`:
	// the version's rows plus the before-pivot variables): the new columns'
	// names, the collisions with kept ID columns, how many rows repeat an
	// earlier row's ID + split-out cells, and what Apply would save.
	const { fields, issues, baked, preview } = useMemo(() => {
		const all = withCandidates(raw.fields, stages.candidates)
		if (!pivotApplies(all, config))
			return { fields: all, issues: [], baked: null, preview: null }
		const baked = bakeTransforms(
			raw,
			overrides,
			DEFAULT_RESHAPE_CONFIG,
			legacyDerived,
			config
		)
		const source = baked.wide
		return {
			fields: all,
			issues: pivotIssues(source.fields, source.rows, config),
			baked,
			preview: pivotDataset(source.fields, source.rows, config),
		}
	}, [raw, stages, config, overrides, legacyDerived])
	const columnLabel = useColumnLabel(stages.candidates)
	const idSet = new Set(config.idFields)
	const groups = pivotGroups(config)
	// Every list offers the columns no other list claims — not an ID
	// column, not split out or filled with by any group.
	const claimedBy = new Map<string, string>()
	groups.forEach((g, i) => {
		for (const n of g.keyFields) if (!claimedBy.has(n)) claimedBy.set(n, `key:${i}`)
		for (const n of g.valueFields) if (!claimedBy.has(n)) claimedBy.set(n, `value:${i}`)
	})
	const candidatesFor = (list: keyof PivotGroup, index: number) =>
		fields.filter((f) => {
			if (idSet.has(f.name)) return false
			const owner = claimedBy.get(f.name)
			return owner === undefined || owner === `${list === "keyFields" ? "key" : "value"}:${index}`
		})
	const minted = preview
		? preview.fields.filter((f) => !idSet.has(f.name)).map((f) => f.name)
		: []
	const canApply =
		baked !== null && issues.length === 0 && !apply.busy && target.name.trim() !== ""

	/** The draft with every group passed through `fn` (index 0 is the
	 *  config's own lists). */
	const withGroups = (
		prev: PivotConfig,
		fn: (group: PivotGroup, index: number) => PivotGroup
	): PivotConfig => {
		const [first, ...rest] = pivotGroups(prev).map(fn)
		return {
			...prev,
			...first,
			...(prev.extraGroups ? { extraGroups: rest } : {}),
		}
	}
	const without = (g: PivotGroup, fieldName: string): PivotGroup =>
		g.keyFields.includes(fieldName) || g.valueFields.includes(fieldName)
			? {
					keyFields: g.keyFields.filter((n) => n !== fieldName),
					valueFields: g.valueFields.filter((n) => n !== fieldName),
				}
			: g
	const toggleId = (fieldName: string, on: boolean) =>
		setConfig((prev: PivotConfig) =>
			// Checking a column as an ID withdraws it from every group's lists.
			withGroups(
				{
					...prev,
					idFields: on
						? [...prev.idFields, fieldName]
						: prev.idFields.filter((n) => n !== fieldName),
				},
				(g) => (on ? without(g, fieldName) : g)
			)
		)
	/** Check (or uncheck) a column in one group's list, withdrawing it from
	 *  every other list — a column lives in one list only. */
	const toggleIn = (
		list: keyof PivotGroup,
		index: number,
		fieldName: string,
		on: boolean
	) =>
		setConfig((prev: PivotConfig) =>
			withGroups(prev, (g, i) => {
				const cleared = without(g, fieldName)
				return i === index && on
					? { ...cleared, [list]: [...cleared[list], fieldName] }
					: cleared
			})
		)
	// Render keys for the extra groups (they have no identity of their own),
	// so removing one from the middle keeps the others' boxes.
	const addGroup = () => {
		setExtraKeys((keys) => [...keys, nextGroupKey.current++])
		setConfig((prev: PivotConfig) => ({
			...prev,
			extraGroups: [...(prev.extraGroups ?? []), { keyFields: [], valueFields: [] }],
		}))
	}
	const removeGroup = (index: number) => {
		setExtraKeys((keys) => keys.filter((_, i) => i !== index - 1))
		setConfig((prev: PivotConfig) => {
			const extraGroups = (prev.extraGroups ?? []).filter((_, i) => i !== index - 1)
			const { extraGroups: _dropped, ...rest } = prev
			return extraGroups.length > 0 ? { ...rest, extraGroups } : rest
		})
	}

	const checklist = (
		candidates: Field[],
		checked: ReadonlyArray<string>,
		onToggle: (fieldName: string, on: boolean) => void,
		empty: string
	) =>
		candidates.length === 0 ? (
			<p className="vc-help">{empty}</p>
		) : (
			candidates.map((f) => (
				<Checkbox
					key={f.name}
					className={CHECKBOX_CLASS}
					label={columnLabel(f)}
					checked={checked.includes(f.name)}
					onChange={(on) => onToggle(f.name, on)}
				/>
			))
		)
	const groupLabel = (index: number) => (index === 0 ? "" : ` (group ${index + 1})`)
	/** A group's render key: the extra groups have none of their own in the
	 *  config, so `extraKeys` gives them one. */
	const groupKey = (index: number) =>
		index === 0 ? "first" : `extra-${extraKeys[index - 1] ?? index}`

	return (
		<>
			<p className="vc-help">
				Spread one column&rsquo;s values out into columns of their own (wide
				format). The reshaped table is saved as a new data version; the
				data as it is now is never changed, and the version list takes you
				back to the long table.
			</p>
			<div className="vc-divider-group">
				<span className="vc-group-header">ID columns</span>
				<p className="vc-help">
					Kept as-is; rows that share the same ID cells become one row.
				</p>
				{checklist(fields, config.idFields, toggleId, "")}
			</div>
			{groups.map((g, index) => {
				const suffix = groupLabel(index)
				return (
					<div key={groupKey(index)} className="vc-divider-group">
						<div className="flex items-center justify-between gap-2">
							<span className="vc-group-header">Split out{suffix}</span>
							{index > 0 && (
								<IconButton
									onClick={() => removeGroup(index)}
									className="px-1"
									aria-label={`Remove group ${index + 1}`}
								>
									×
								</IconButton>
							)}
						</div>
						<p className="vc-help">
							{index === 0
								? "Each value of the checked column becomes a column of its own. With two or more checked, their values together name the column."
								: "Its new columns sit beside the first group's, on the same ID rows."}
						</p>
						{checklist(
							candidatesFor("keyFields", index),
							g.keyFields,
							(name, on) => toggleIn("keyFields", index, name, on),
							"Every column is already in a list — uncheck some to split one out here."
						)}
						<span className="vc-group-header">Fill with{suffix}</span>
						<p className="vc-help">
							{index === 0
								? "The cells that fill the new columns. With two or more checked, each new column is named by its value column too (“sales 2023”). Columns checked in no list are left out."
								: "The cells that fill this group's new columns."}
						</p>
						{checklist(
							candidatesFor("valueFields", index),
							g.valueFields,
							(name, on) => toggleIn("valueFields", index, name, on),
							"Every column is already in a list — uncheck some to fill with one here."
						)}
					</div>
				)
			})}
			<button
				type="button"
				onClick={addGroup}
				className="self-end text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				+ Add another group
			</button>
			{minted.length > 0 && (
				<p className="vc-help">
					New columns: {minted.slice(0, MINTED_PREVIEW).join(", ")}
					{minted.length > MINTED_PREVIEW
						? ` … and ${minted.length - MINTED_PREVIEW} more`
						: ""}
					.
				</p>
			)}
			{preview?.overwritten.map((count, index) =>
				count > 0 ? (
					<p key={groupKey(index)} className="vc-help">
						{count} {count === 1 ? "row repeats" : "rows repeat"} an earlier
						row&rsquo;s ID and split-out{groupLabel(index)} cells; the later
						row wins.
					</p>
				) : null
			)}
			<Issues issues={issues} />
			{baked && <CountsLine from={baked.wide} to={baked} />}
			<ApplyFooter
				raw={raw}
				target={target}
				error={apply.error}
				canApply={canApply}
				onApply={() => void apply.run({ kind: "pivot", config })}
			/>
		</>
	)
}
