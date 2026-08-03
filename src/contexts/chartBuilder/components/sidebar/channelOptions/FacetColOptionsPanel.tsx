import { FacetAxisOptionsPanel } from "./FacetAxisOptionsPanel"

/** Options panel for the `facetCol` channel — a thin wrapper over the
 *  axis-parameterized `FacetAxisOptionsPanel`, mirroring
 *  `FacetRowOptionsPanel` on the other axis. Hosts only the col-axis-
 *  relevant controls — share, gapX, panelWidth, the sizing toggle, and
 *  per-column axis bound overrides. The "col axis" channel depends on
 *  the chart mode: x for cartesian, angle for radar / pies. Row-axis
 *  controls live on `FacetRowOptionsPanel`; the wrap panel surfaces
 *  both. */
export const FacetColOptionsPanel = () => <FacetAxisOptionsPanel axis="col" />
