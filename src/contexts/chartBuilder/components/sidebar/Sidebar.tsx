import { AsideSection } from "../../../../components/ui/AsideSection"
import { AestheticsPanel } from "./AestheticsPanel"
import { AnnotationsPanel } from "./AnnotationsPanel"
import { CaptionPanel } from "./CaptionPanel"
import { DataLabelsPanel } from "./DataLabelsPanel"
import { DataUpload } from "./DataUpload"
import { EncodingShelves } from "./EncodingShelves"
import { FieldList } from "./FieldList"
import { LabelsPanel } from "./LabelsPanel"
import { LegendPanel } from "./LegendPanel"
import { MapsSection } from "./MapsSection"
import { ReshapePanel } from "./ReshapePanel"
import { ThemePanel } from "./ThemePanel"
import { TooltipPanel } from "./TooltipPanel"

export const Sidebar = () => {
	return (
		// The aside is the ONLY scroll region in the sidebar, on BOTH axes —
		// panels never get inner scrollers. The inner wrapper carries the
		// stack rhythm plus a min-width floor, so the aside scrolls past it
		// instead of the rows squeezing.
		//
		// `min-w-80` (320px) is that floor: control rows are a fixed label
		// column (LABEL_COL's `w-24`) plus fixed-width controls, and the
		// widest canonical row — a color row of hex box + swatch + palette
		// picker, ~280px — needs 320px once the section's `px-3` and the
		// panel's `p-2` are paid. Below it the flexible dropdowns used to
		// collapse to ~40% of their width and trailing controls slid out of
		// reach. The default sidebar width (lib/storage.ts) sits just above
		// 320 + this aside's `px-2`, so the default view opens with no
		// horizontal scrollbar.
		<aside className="bg-vc-sidebar h-full overflow-auto px-2 py-5">
			<div className="flex min-w-80 flex-col gap-3">
				<AsideSection title="Data">
					<DataUpload />
					<ReshapePanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Fields">
					<FieldList />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Encodings">
					<EncodingShelves />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Maps" defaultCollapsed>
					<MapsSection />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Data Labels" defaultCollapsed>
					<DataLabelsPanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Legend" defaultCollapsed>
					<LegendPanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Axis Labels and Titles">
					<LabelsPanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Tooltips and hover">
					<TooltipPanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Caption" defaultCollapsed>
					<CaptionPanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Annotations" defaultCollapsed>
					<AnnotationsPanel />
				</AsideSection>
				<hr className="mx-3 border-stone-200 dark:border-stone-700" />
				<AsideSection title="Aesthetics & Theme">
					<div className="vc-option-panel">
						<ThemePanel />
						<AestheticsPanel />
					</div>
				</AsideSection>
			</div>
		</aside>
	)
}
