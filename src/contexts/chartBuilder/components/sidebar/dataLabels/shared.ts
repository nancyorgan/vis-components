import type { DataLabelsEncodings } from "../../../lib/types"

export type DataLabelsChannel = keyof DataLabelsEncodings

/** Preset arrangements for a multi-field label, built from the first two
 *  selected fields, joined with ", " (e.g. `{Region}, {Share}`). This
 *  pre-fills the editable template so the user starts from a working
 *  arrangement instead of an empty box, and stays in sync with the
 *  checklist until they hand-edit it. */
export const defaultLabelTemplate = (fields: string[]): string =>
	fields.map((f) => `{${f}}`).join(", ")
