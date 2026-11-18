import { z } from "zod";
import { ENCOUNTER_TYPES, type EncounterType } from "./encounter-types";

/**
 * Motor de plantillas por especialidad. Debe reflejar el shape que se
 * siembra en `specialty_templates.schema` (jsonb) — ver
 * supabase/migrations/20260820031102_core_tenant_model.sql y las
 * migraciones posteriores que insertan/actualizan filas de esta tabla.
 *
 * "La especialidad es configuración, no código" (CLAUDE.md): agregar una
 * especialidad nueva es una fila nueva en `specialty_templates`, no una
 * página ni un tipo nuevos. Este archivo solo sabe interpretar la forma
 * genérica de un campo — nunca conoce los campos de una especialidad en
 * particular.
 *
 * Dos mecanismos de organización, deliberadamente distintos (ver revisión
 * de normativa MSP en docs/normativa-msp/):
 *   - `section`: agrupación puramente visual dentro de UNA nota (p. ej. la
 *     anamnesis de Medicina Interna tiene 5 subcampos). No afecta validación.
 *   - `appliesTo`: lista de tipos de consulta (inicial, seguimiento…) en los que se pide el
 *     campo; sin `appliesTo` se pide en todos. Es la forma de que el seguimiento no repita la
 *     línea base de la especialidad (PR de tipos de consulta).
 *   - `legacy`: el campo YA NO se pide (p. ej. los antecedentes, que ahora viven en el
 *     expediente), pero se sigue mostrando en las consultas viejas y en las exportaciones.
 *   - `condition`: un campo solo aplica si otro campo del MISMO formulario
 *     tiene cierto valor (p. ej. "detalle de transfusión" solo si
 *     "hubo transfusión" = "Sí"). Para notas que ocurren en momentos
 *     clínicos distintos (preoperatorio vs. postoperatorio, consulta
 *     prenatal vs. puerperio) NO se usa `condition` — se modelan como
 *     filas separadas de specialty_templates, seleccionables en el picker.
 */

export const TEMPLATE_FIELD_TYPES = ["text", "textarea", "number", "select", "date"] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export type TemplateFieldCondition = {
  field: string;
  equals: string;
};

export type TemplateField = {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  options?: string[];
  /** Título del grupo visual al que pertenece este campo (opcional). */
  section?: string;
  /** Este campo solo aplica si `condition.field` tiene el valor `condition.equals`. */
  condition?: TemplateFieldCondition;
  /** Tipos de consulta en los que se pide este campo; sin él, en todos. */
  appliesTo?: EncounterType[];
  /** Ya no se pide; se conserva para mostrar y exportar lo que ya se guardó. */
  legacy?: boolean;
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
const templateFieldConditionSchema = z.object({
  field: z.string().min(1),
  equals: z.string(),
});

const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(TEMPLATE_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  section: z.string().optional(),
  condition: templateFieldConditionSchema.optional(),
  appliesTo: z.array(z.enum(ENCOUNTER_TYPES)).optional(),
  legacy: z.boolean().optional(),
});

const templateSchemaSchema = z.object({
  fields: z.array(templateFieldSchema),
});

export function parseTemplateSchema(raw: unknown): TemplateSchema {
  return templateSchemaSchema.parse(raw);
}

/** ¿Se pide este campo en una consulta de este tipo? (los legacy nunca; sin `appliesTo`, en todos). */
export function isFieldActive(field: TemplateField, type: EncounterType): boolean {
  if (field.legacy) return false;
  return !field.appliesTo || field.appliesTo.includes(type);
}

/** Los campos que se piden en una consulta de este tipo, en el orden de la plantilla. */
export function activeFieldsForType(fields: TemplateField[], type: EncounterType): TemplateField[] {
  return fields.filter((f) => isFieldActive(f, type));
}

/**
 * Campos para VALIDAR algo que no pasa por el formulario (la importación de consultas históricas): los
 * campos que aplican al tipo conservan su exigencia y los demás (legacy o de otro tipo) se aceptan pero
 * nunca se exigen. Sin tipo (consulta «sin clasificar») se usa la línea base (`inicial`).
 */
export function fieldsForValidation(fields: TemplateField[], type: EncounterType | null): TemplateField[] {
  const t = type ?? "inicial";
  return fields.map((f) => (isFieldActive(f, t) ? f : { ...f, required: false }));
}

/**
 * Agrupa campos por `section`, preservando el orden de primera aparición.
 * Los campos sin `section` van en un grupo `undefined` (el llamador decide
 * cómo titularlo, o lo renderiza sin encabezado).
 */
export function groupFieldsBySection(fields: TemplateField[]): Array<[string | undefined, TemplateField[]]> {
  const order: (string | undefined)[] = [];
  const groups = new Map<string | undefined, TemplateField[]>();
  for (const field of fields) {
    const key = field.section;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(field);
  }
  return order.map((key) => [key, groups.get(key)!]);
}

/**
 * Construye, en runtime, el schema Zod que valida los valores enviados
 * para specialty_data a partir de la definición de campos del template —
 * la validación misma es configuración, no código nuevo por especialidad.
 *
 * Todo llega como string (FormData) — para "number" se valida y convierte
 * explícitamente en vez de usar z.coerce.number(), que convierte "" a 0 y
 * dejaría pasar un campo numérico requerido vacío como si fuera válido.
 *
 * Campos con `condition`: nunca se exigen a nivel de campo individual
 * (aceptan vacío), incluso si `required: true` — la exigencia condicional
 * ("requerido SOLO si la condición se cumple") se aplica en un
 * `superRefine` sobre el objeto completo, porque Zod necesita ver el valor
 * del campo controlador para decidir.
 */
export function buildZodSchemaForTemplate(fields: TemplateField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    const requiredMsg = `${field.label} es requerido.`;
    const effectivelyRequired = field.required && !field.condition;

    if (field.type === "number") {
      const numberSchema = z
        .string()
        .trim()
        .refine((v) => v === "" || !Number.isNaN(Number(v)), {
          message: `${field.label} debe ser un número.`,
        })
        .transform((v) => (v === "" ? undefined : Number(v)));
      shape[field.key] = effectivelyRequired
        ? numberSchema.refine((v) => v !== undefined, { message: requiredMsg })
        : numberSchema;
      continue;
    }

    const isSelect = field.type === "select" && (field.options?.length ?? 0) > 0;

    if (isSelect) {
      let selectSchema: z.ZodTypeAny = z.enum(field.options as [string, ...string[]]);
      if (!effectivelyRequired) selectSchema = selectSchema.optional().or(z.literal(""));
      shape[field.key] = selectSchema;
      continue;
    }

    let stringSchema: z.ZodTypeAny = z.string();
    stringSchema = effectivelyRequired
      ? (stringSchema as z.ZodString).min(1, requiredMsg)
      : stringSchema.optional().or(z.literal(""));
    shape[field.key] = stringSchema;
  }

  let schema: z.ZodTypeAny = z.object(shape);

  const conditionalRequired = fields.filter((f) => f.required && f.condition);
  if (conditionalRequired.length > 0) {
    schema = schema.superRefine((data, ctx) => {
      const record = data as Record<string, unknown>;
      for (const field of conditionalRequired) {
        const controllingValue = record[field.condition!.field];
        const conditionMet = controllingValue === field.condition!.equals;
        if (!conditionMet) continue;
        const value = record[field.key];
        const isEmpty = value === undefined || value === "" || value === null;
        if (isEmpty) {
          ctx.addIssue({
            code: "custom",
            message: `${field.label} es requerido.`,
            path: [field.key],
          });
        }
      }
    });
  }

  return schema;
}
