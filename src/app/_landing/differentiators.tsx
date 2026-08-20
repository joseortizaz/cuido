import { DocumentCheckIcon, LayersIcon, LockIcon, ShieldCheckIcon } from "./icons";

const ITEMS = [
  {
    icon: DocumentCheckIcon,
    title: "Listo para la DGII",
    description: "Preparado para e-CF y la facturación electrónica obligatoria.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Alineado al MSP",
    description: "Plantillas clínicas revisadas contra la normativa dominicana vigente.",
  },
  {
    icon: LayersIcon,
    title: "Por especialidad",
    description: "Historias clínicas configurables para cada especialidad, no genéricas.",
  },
  {
    icon: LockIcon,
    title: "Seguridad clínica",
    description: "Aislamiento estricto entre clínicas y control de acceso por rol.",
  },
];

export function LandingDifferentiators() {
  return (
    <section className="px-4 py-16 sm:py-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="flex flex-col items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-linear-to-br from-brand-blue/10 to-brand-teal/10 text-brand-blue">
              <Icon className="h-6 w-6" />
            </span>
            <h3 className="text-base font-semibold text-brand-navy">{title}</h3>
            <p className="text-sm text-zinc-600">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
