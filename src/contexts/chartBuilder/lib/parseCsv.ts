import { parse as papaParse } from "papaparse"

export type ParsedCsv = {
	fieldNames: string[]
	rows: Array<Record<string, string>>
}

export const parseCsvFile = async (file: File): Promise<ParsedCsv> => {
	const text = await file.text()
	return parseCsvText(text)
}

export const parseCsvText = (text: string): ParsedCsv => {
	const result = papaParse<Record<string, string>>(text, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: false,
	})
	if (result.errors.length > 0) {
		// "Quotes" is a stray quote inside a field, which the parser recovers
		// from. "Delimiter" means it couldn't tell the delimiter apart and fell
		// back to a comma — which is exactly right for a single-column file or
		// paste, where there is no delimiter to find.
		const firstFatal = result.errors.find(
			(e) => e.type !== "Quotes" && e.type !== "Delimiter"
		)
		if (firstFatal) {
			throw new Error(
				`CSV parse error at row ${firstFatal.row}: ${firstFatal.message}`
			)
		}
	}
	const fieldNames = result.meta.fields ?? []
	return { fieldNames, rows: result.data }
}
