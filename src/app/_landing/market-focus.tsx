import { BuildingIcon, FlaskIcon, ScanIcon, StethoscopeIcon, UsersIcon } from "./icons";

/**
 * Reemplaza el bloque "Confían en Cuido" del boceto -- ese bloque implica
 * clientes reales que hoy no existen (regla no negociable de esta ronda:
 * cero contenido aspiracional). En su lugar, describe el MERCADO al que se
 * dirige el producto, sin afirmar tracción. Mismo layout visual (franja con
 * fondo suave + chips con ícono), contenido honesto.
 */
const SEGMENTS = [
  { icon: BuildingIcon, label: "Clínicas Privadas" },
  { icon: StethoscopeIcon, label: "Centros Médicos" },
  { icon: FlaskIcon, label: "Laboratorios" },
  { icon: ScanIcon, label: "Centros Diagnósticos" },
  { icon: UsersIcon, label: "Consultorios Especializados" },
];

export function LandingMarketFocus() {
  return (
    <section className="px-4 py-10 sm:py-12">
      <div className="mx-auto max-w-5xl rounded-2xl bg-zinc-50 px-6 py-8 sm:px-10">
        <p className="text-center text-sm font-medium text-zinc-500">
          Pensado para clínicas privadas, centros médicos, laboratorios y consultorios
          especializados en República Dominicana
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
          {SEGMENTS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-brand-navy/70">
              <Icon className="h-7 w-7" />
              <span className="text-xs font-medium sm:text-sm">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
