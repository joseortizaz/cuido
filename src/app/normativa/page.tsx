import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { NORMATIVA } from "@/lib/normativa";

export default function NormativaPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-brand-navy sm:text-4xl">
            Directorio de Normas y Guías de Salud
          </h1>
          <p className="mt-3 text-base text-zinc-600">
            Los documentos oficiales del Ministerio de Salud Pública que respaldan las plantillas
            clínicas de Cuido, por especialidad. Cada plantilla se construyó verificando el texto
            exacto de la norma correspondiente, no una interpretación de segunda mano.
          </p>

          <ul className="mt-10 flex flex-col divide-y divide-zinc-200">
            {NORMATIVA.map((entry) => (
              <li key={entry.title} className="flex flex-col gap-2 py-6">
                <h2 className="text-lg font-semibold text-brand-navy">{entry.title}</h2>
                <p className="text-sm text-zinc-600">
                  {entry.issuer} · {entry.year}
                </p>
                <div className="flex flex-wrap gap-2">
                  {entry.specialties.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-brand-teal/30 bg-brand-teal/5 px-3 py-1 text-xs font-medium text-brand-navy"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                {entry.note && <p className="text-xs text-zinc-500">{entry.note}</p>}
                {entry.url ? (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 text-sm font-medium text-brand-blue hover:underline"
                  >
                    Ver fuente oficial →
                  </a>
                ) : (
                  <span className="mt-1 text-sm font-medium text-zinc-400">
                    Fuente oficial pendiente de confirmar
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
