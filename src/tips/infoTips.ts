import { atom } from "jotai"

/** The header's Info tips toggle: while on, every helper bubble for the
 *  current view shows at once (TipBoard), and the paced tips wait. In
 *  memory only, like the editor's other header toggles. */
export const infoTipsAtom = atom(false)

/** Marks the header toggle; the board keeps the header clear of bubbles. */
export const INFO_TIPS_TOGGLE_ATTR = "data-info-tips-toggle"
