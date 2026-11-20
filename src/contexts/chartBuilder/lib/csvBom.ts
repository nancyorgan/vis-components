/** UTF-8 byte-order mark, written at the head of every CSV the app
 *  downloads. It is what makes Excel read the file as UTF-8: without it,
 *  accented letters, curly quotes and symbols like "≥" open garbled
 *  ("‚Äú"). The app's own upload drops it again (`lib/parseCsv.ts`), as do
 *  other spreadsheet and data tools. */
export const CSV_BOM = "﻿"
