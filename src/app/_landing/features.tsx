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
 * inventada ni aspiracional (regla no negociable de esta ronda). El boceto
 * original incluía "Agenda Inteligente", "Inventario y Suministros" y
 * "Reportes y Analíticas": ninguna de las tres existe en el producto, así
 * que no están aquí.
 *
 * "12 especialidades" (no 17, como se sugirió al pedir este rediseño) --
 * verificado contra specialty_templates en el proyecto Supabase real antes
 * de escribir esta copia: 19 filas/plantillas, pero 12 especialidades
 * distintas (algunas tienen más de una plantilla -- p. ej. Cirugía General
 * tiene nota preoperatoria y descripción postoperatoria como plantillas
 * separadas de la misma especialidad). Ver mensaje de cierre de esta tarea.
 */
const FEATURES = [
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

export function LandingFeatures() {
  return (
    <section className="px-4 py-16 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
        <span className="rounded-full bg-brand-blue/10 px-4 py-1.5 text-sm font-medium text-brand-blue">
          Todo lo que necesitas en un solo lugar
        </span>
        <h2 className="mt-4 max-w-2xl text-2xl font-bold text-brand-navy sm:text-3xl">
          Funcionalidades diseñadas para{" "}
          <span className="text-brand-teal">centros de salud modernos</span>
        </h2>

        <div className="mt-10 grid w-full grid-cols-1 gap-6 text-left sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-linear-to-br from-brand-blue/10 to-brand-teal/10 text-brand-blue">
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="text-base font-semibold text-brand-navy">{title}</h3>
              <p className="text-sm text-zinc-600">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
