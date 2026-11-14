import { createContext } from "react"

/** The angle the layout solver decided for the x tick labels of the panel
 *  being rendered (`SolverPanelOutput.xLabelAngleDeg`), provided by
 *  PlotCanvas around each panel.
 *
 *  The axis draws this angle rather than working one out again: the solver
 *  reserved the room for exactly it, so the two cannot disagree (LAYOUT.md
 *  §11). `null` outside the canvas — a renderer mounted on its own in a
 *  test — where the axis decides for itself from its real tick positions. */
export const SolvedXTickAngleContext = createContext<number | null>(null)
