import { planLegendSwatches } from "./legendSwatchPlan"
import { useLegendPanelBase } from "./useLegendPanelBase"

/** The Legend panel's shared model: the base reads plus the swatch plan.
 *  Computed once per render in `LegendPanel` and handed to each subsection. */
export const useLegendPanelModel = () => {
	const base = useLegendPanelBase()
	return { ...base, ...planLegendSwatches(base) }
}

export type LegendPanelModel = ReturnType<typeof useLegendPanelModel>
