import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { channelAccepts } from "../../../lib/channels"
import { withFacetPairSide } from "../../../lib/facetEncoding"
import {
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	quickStartStateAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

/** The Facet panel's "Two variables…" pickers — the first block of the
 *  panel while the pair is in play: a Row select and a Column select
 *  over `facetRow` / `facetCol`. The two sides never
 *  offer each other's variable. A half-filled pair is a
 *  row-only / column-only grid (one strip) until the other side is
 *  picked. */
export const FacetPairPickers = () => {
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const setQuickStartState = useSetAtom(quickStartStateAtom)
	const dataset = useCurrentDatasetView()
	// Same type rule as the Facet dropdown (all three facet channels accept
	// the same discrete types).
	const fields = (dataset?.fields ?? [])
		.filter((f) => channelAccepts("facet", overrides[f.name] ?? f.inferredType))
		.map((f) => f.name)
	const rowField = encodings.facetRow?.field ?? null
	const colField = encodings.facetCol?.field ?? null
	const options = (exclude: string | null) => [
		{ value: "", label: "— none —" },
		...fields.filter((f) => f !== exclude).map((f) => ({ value: f, label: f })),
	]
	// A manual edit means the encodings are no longer a pristine scaffold —
	// same flag the shelf rows clear.
	const edited = () =>
		setQuickStartState((prev) =>
			prev.lastSetByScaffold ? { ...prev, lastSetByScaffold: false } : prev
		)
	const pick = (side: "row" | "col", next: string) => {
		setEncodings((prev) => withFacetPairSide(prev, side, next === "" ? null : next))
		edited()
	}
	const mappedClass = "text-vc-section-header font-semibold"
	return (
		<div className="flex flex-col gap-2" data-tip="facet-pair">
			<SelectInput
				label="Row"
				labelClassName={LABEL_COL}
				value={rowField ?? ""}
				options={options(colField)}
				onChange={(next) => pick("row", next)}
				disabled={!dataset}
				selectClassName={`min-w-0 flex-1 ${rowField ? mappedClass : "vc-text"}`}
			/>
			<SelectInput
				label="Column"
				labelClassName={LABEL_COL}
				value={colField ?? ""}
				options={options(rowField)}
				onChange={(next) => pick("col", next)}
				disabled={!dataset}
				selectClassName={`min-w-0 flex-1 ${colField ? mappedClass : "vc-text"}`}
			/>
		</div>
	)
}
