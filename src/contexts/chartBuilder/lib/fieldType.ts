import type { DatasetView, FieldType } from "./types"

export const effectiveType = (
	dataset: DatasetView,
	fieldName: string,
	overrides: Record<string, FieldType>
): FieldType =>
	overrides[fieldName] ??
	dataset.fields.find((f) => f.name === fieldName)?.inferredType ??
	"categorical"
