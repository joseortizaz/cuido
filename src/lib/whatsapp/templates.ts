/**
 * Validación y armado de plantillas de WhatsApp (utilidad) según las reglas de Meta. Lógica
 * pura, sin Next ni Supabase (scripts/test-whatsapp-webhook.ts). Meta tiene la última palabra
 * (la revisión puede rechazar igual), pero esto evita enviar a revisión lo que se sabe que
 * falla y malgastar un nombre (al borrar una plantilla aprobada, su nombre queda bloqueado 30
 * días).
 *
 * Solo plantillas de TEXTO (cuerpo + pie opcional + botones de respuesta rápida) con variables
 * posicionales {{1}}, {{2}}…: lo que necesitan los recordatorios de citas.
 */

export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LANGUAGE_PATTERN = /^[a-z]{2,3}(_[A-Z]{2})?$/;
export const BODY_MAX = 1024;
export const FOOTER_MAX = 60;
export const BUTTON_TEXT_MAX = 25;
export const QUICK_REPLY_MAX = 3;

export type TemplateInput = {
  name: string;
  language: string;
  body: string;
  /** Un ejemplo por variable, en orden ({{1}}, {{2}}…). */
  examples: string[];
  footer?: string;
  /** Textos de botones de respuesta rápida. */
  buttons?: string[];
};

export type MetaTemplatePayload = {
  name: string;
  language: string;
  category: "UTILITY";
  components: (
    | { type: "BODY"; text: string; example?: { body_text: string[][] } }
    | { type: "FOOTER"; text: string }
    | { type: "BUTTONS"; buttons: { type: "QUICK_REPLY"; text: string }[] }
  )[];
};

export type TemplateValidation =
  | { ok: true; payload: MetaTemplatePayload; variableCount: number }
  | { ok: false; errors: string[] };

/** Números de las variables {{n}} del texto, en orden de aparición. */
export function variableNumbers(text: string): number[] {
  return Array.from(text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => Number(m[1]));
}

export function validateTemplate(input: TemplateInput): TemplateValidation {
  const errors: string[] = [];
  const name = input.name.trim();
  const language = input.language.trim();
  const body = input.body.trim();
  const footer = (input.footer ?? "").trim();
  const buttons = (input.buttons ?? []).map((b) => b.trim()).filter((b) => b !== "");
  const examples = input.examples.map((e) => e.trim());

  if (!TEMPLATE_NAME_PATTERN.test(name)) {
    errors.push("El nombre solo puede tener minúsculas, números y guiones bajos (sin espacios ni acentos).");
  }
  if (!TEMPLATE_LANGUAGE_PATTERN.test(language)) {
    errors.push("El código de idioma no es válido (por ejemplo «es» o «es_MX»).");
  }

  if (body === "") {
    errors.push("El cuerpo es requerido.");
  } else {
    if (body.length > BODY_MAX) errors.push(`El cuerpo no puede pasar de ${BODY_MAX} caracteres.`);

    const nums = variableNumbers(body);
    const expected = nums.map((_, i) => i + 1);
    if (nums.length > 0 && nums.some((n, i) => n !== expected[i])) {
      errors.push("Las variables deben ser {{1}}, {{2}}, {{3}}… en orden, sin saltos ni repeticiones.");
    }
    if (/^\s*\{\{/.test(body)) errors.push("El cuerpo no puede empezar con una variable.");
    if (/\}\}\s*$/.test(body)) errors.push("El cuerpo no puede terminar con una variable.");
    if (/\}\}\{\{/.test(body)) errors.push("Dos variables no pueden ir pegadas.");

    if (nums.length > 0 && examples.length !== nums.length) {
      errors.push(`Falta un ejemplo por variable: el cuerpo tiene ${nums.length} y se dieron ${examples.length}.`);
    } else if (nums.length > 0 && examples.some((e) => e === "")) {
      errors.push("Los ejemplos de las variables no pueden estar vacíos.");
    }
    if (nums.length === 0 && examples.some((e) => e !== "")) {
      errors.push("Se dieron ejemplos pero el cuerpo no tiene variables.");
    }
  }

  if (footer.length > FOOTER_MAX) errors.push(`El pie no puede pasar de ${FOOTER_MAX} caracteres.`);
  if (/\{\{/.test(footer)) errors.push("El pie no puede tener variables.");

  if (buttons.length > QUICK_REPLY_MAX) errors.push(`Máximo ${QUICK_REPLY_MAX} botones de respuesta rápida.`);
  if (buttons.some((b) => b.length > BUTTON_TEXT_MAX)) {
    errors.push(`Cada botón puede tener hasta ${BUTTON_TEXT_MAX} caracteres.`);
  }
  if (new Set(buttons.map((b) => b.toLowerCase())).size !== buttons.length) {
    errors.push("Los botones no pueden repetirse.");
  }

  if (errors.length > 0) return { ok: false, errors };

  const variableCount = variableNumbers(body).length;
  const components: MetaTemplatePayload["components"] = [
    variableCount > 0
      ? { type: "BODY", text: body, example: { body_text: [examples] } }
      : { type: "BODY", text: body },
  ];
  if (footer !== "") components.push({ type: "FOOTER", text: footer });
  if (buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: buttons.map((text) => ({ type: "QUICK_REPLY", text })) });
  }

  return { ok: true, payload: { name, language, category: "UTILITY", components }, variableCount };
}
