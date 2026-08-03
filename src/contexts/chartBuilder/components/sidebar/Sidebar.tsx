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
import { ThemePanel } from "./ThemePanel"
import { TooltipPanel } from "./TooltipPanel"

export const Sidebar = () => {
	return (
		<aside className="bg-vc-sidebar flex h-full flex-col gap-3 overflow-y-auto px-2 py-5">
			<AsideSection title="Data">
				<DataUpload />
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
				<div className="vc-option-panel flex flex-col gap-3">
					<ThemePanel />
					<AestheticsPanel />
				</div>
			</AsideSection>
		</aside>
	)
}
