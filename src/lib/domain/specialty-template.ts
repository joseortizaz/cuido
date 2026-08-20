import { z } from "zod";

/**
 * Motor de plantillas por especialidad. Debe reflejar el shape que se
 * siembra en `specialty_templates.schema` (jsonb) — ver
 * supabase/migrations/20260820111106_clinical_core_and_templates.sql.
 *
 * "La especialidad es configuración, no código" (CLAUDE.md): agregar una
 * especialidad nueva es una fila nueva en `specialty_templates`, no una
 * página ni un tipo nuevos. Este archivo solo sabe interpretar la forma
 * genérica de un campo — nunca conoce los campos de una especialidad en
 * particular.
 */

export const TEMPLATE_FIELD_TYPES = ["text", "textarea", "number", "select", "date"] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export type TemplateField = {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  options?: string[];
};

export type TemplateSchema = {
  fields: TemplateField[];
};

/**
 * Valida en runtime que el jsonb leído de la base tiene la forma esperada
 * de un TemplateSchema. No confiamos ciegamente en el contenido de la
 * columna solo porque TypeScript lo tipe como `TemplateSchema` — el jsonb
 * pudo haberse insertado a mano o por una migración futura con un typo.
 */
const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(TEMPLATE_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const templateSchemaSchema = z.object({
  fields: z.array(templateFieldSchema),
});

export function parseTemplateSchema(raw: unknown): TemplateSchema {
  return templateSchemaSchema.parse(raw);
}

/**
 * Construye, en runtime, el schema Zod que valida los valores enviados
 * para specialty_data a partir de la definición de campos del template —
 * la validación misma es configuración, no código nuevo por especialidad.
 *
 * Todo llega como string (FormData) — para "number" se valida y convierte
 * explícitamente en vez de usar z.coerce.number(), que convierte "" a 0 y
 * dejaría pasar un campo numérico requerido vacío como si fuera válido.
 */
export function buildZodSchemaForTemplate(fields: TemplateField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    const requiredMsg = `${field.label} es requerido.`;

    if (field.type === "number") {
      const numberSchema = z
        .string()
        .trim()
        .refine((v) => v === "" || !Number.isNaN(Number(v)), {
          message: `${field.label} debe ser un número.`,
        })
        .transform((v) => (v === "" ? undefined : Number(v)));
      shape[field.key] = field.required
        ? numberSchema.refine((v) => v !== undefined, { message: requiredMsg })
        : numberSchema;
      continue;
    }

    const isSelect = field.type === "select" && (field.options?.length ?? 0) > 0;

    if (isSelect) {
      let selectSchema: z.ZodTypeAny = z.enum(field.options as [string, ...string[]]);
      if (!field.required) selectSchema = selectSchema.optional().or(z.literal(""));
      shape[field.key] = selectSchema;
      continue;
    }

    let stringSchema: z.ZodTypeAny = z.string();
    stringSchema = field.required
      ? (stringSchema as z.ZodString).min(1, requiredMsg)
      : stringSchema.optional().or(z.literal(""));
    shape[field.key] = stringSchema;
  }

  return z.object(shape);
}
