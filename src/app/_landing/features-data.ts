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
 * "12 especialidades" (no 17, como se sugirió al pedir el rediseño de
 * landing) -- verificado contra specialty_templates en el proyecto
 * Supabase real antes de escribir esta copia: 19 filas/plantillas, pero 12
 * especialidades distintas (algunas tienen más de una plantilla -- p. ej.
 * Cirugía General tiene nota preoperatoria y descripción postoperatoria
 * como plantillas separadas de la misma especialidad).
 */
export const FEATURES = [
  {
    icon: ClipboardIcon,
    title: "Historias Clínicas Digitales",
    description:
      "12 especialidades, con 19 plantillas clínicas alineadas a la normativa del Ministerio de Salud Pública.",
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
