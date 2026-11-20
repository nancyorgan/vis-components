import { UnderlineTabs } from "../../../components/ui/UnderlineTabs"
import type { LibraryKind } from "../lib/libraryKind"

/** Visuals | Templates | Data. "visuals" is the clean URL (no ?kind=). */
export const KindToggle = ({
	kind,
	onChange,
}: {
	kind: LibraryKind | undefined
	onChange: (next: LibraryKind | undefined) => void
}) => (
	<UnderlineTabs
		// Pushes whatever shares the row (Grid / Table) to the right edge.
		className="mr-auto"
		ariaLabel="Show visualizations, templates, or data sets"
		tipAnchor="library-kind"
		value={kind ?? "visuals"}
		segments={[
			{ key: "visuals", label: "Visuals" },
			{ key: "templates", label: "Templates" },
			{ key: "data", label: "Data" },
		]}
		onChange={(next) => onChange(next === "visuals" ? undefined : next)}
	/>
)
