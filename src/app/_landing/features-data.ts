import {
  ClipboardIcon,
  ReceiptIcon,
  UsersIcon,
  SignatureIcon,
  TeamIcon,
  ShieldCheckIcon,
} from "./icons";

/**
 * Las 6 funcionalidades reales del producto hoy, en este orden -- ninguna
 * inventada ni aspiracional (regla no negociable del rediseño de landing).
 * El boceto original incluía "Agenda Inteligente", "Inventario y
 * Suministros" y "Reportes y Analíticas": ninguna de las tres existe en el
 * producto, así que no están aquí.
 *
 * Fuente única -- usada tanto por la sección de Funcionalidades
 * (features.tsx) como por el mockup de laptop del Hero (hero-visual.tsx),
 * para que ambos muestren exactamente los mismos títulos sin
 * duplicar/desincronizar la lista.
 *
 * "14 especialidades, con 21 plantillas" -- contado sobre
 * supabase/migrations/ (inserts en specialty_templates menos las
 * desactivadas), con este criterio:
 *   - Solo plantillas ACTIVAS. Las 2 desactivadas (cirugia_general y
 *     gineco_obstetricia, versiones planas originales reemplazadas en
 *     20260820171621_specialty_templates_normativa_msp.sql) no cuentan.
 *     El conteo original de esta copia ("19 plantillas") sí las incluía.
 *   - Una especialidad con varias plantillas cuenta una vez (p. ej.
 *     Cirugía General: nota preoperatoria + descripción postoperatoria).
 *   - La Orden de Terapia Física cuenta como plantilla de Ortopedia y
 *     Traumatología, no como especialidad aparte (decisión de José).
 * Las 14: Medicina Interna, Pediatría, Ginecología y Obstetricia, Cirugía
 * General, Anestesiología, Gastroenterología, Nefrología, Cardiología,
 * Endocrinología, Neumología, Otorrinolaringología, Salud Mental /
 * Psicología, Ortopedia y Traumatología, Nutriología Clínica.
 * Al agregar o desactivar una plantilla, recontar con este mismo criterio.
 */
export const FEATURES = [
  {
    icon: ClipboardIcon,
    title: "Historias Clínicas Digitales",
    description:
      "14 especialidades, con 21 plantillas clínicas alineadas a la normativa del Ministerio de Salud Pública.",
  },
  {
    icon: ReceiptIcon,
    title: "Facturación Electrónica (e-CF)",
    description: "Preparado para el cumplimiento DGII antes del plazo de noviembre 2026.",
  },
  {
    icon: UsersIcon,
    title: "Gestión de Pacientes",
    description:
      "Expediente centralizado por paciente: datos demográficos, alergias, medicamentos activos e historial de consultas en un solo lugar.",
  },
  {
    icon: SignatureIcon,
    title: "Consentimiento Electrónico",
    description:
      "Firma digital de consentimientos informados, con trazabilidad de hash, IP y fecha/hora en cada firma.",
  },
  {
    icon: TeamIcon,
    title: "Gestión de Equipo y Clínica",
    description: "Invita a médicos y personal de recepción, y administra roles y permisos de tu clínica.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Cumplimiento Normativo",
    description:
      "Plantillas clínicas verificadas contra los documentos oficiales del MSP (Reglamento de Expediente Clínico y protocolos por especialidad), y consentimiento alineado a la Ley 12-06 donde aplica.",
  },
];
