/**
 * Bloque de beneficios del boceto -- afirmaciones de propuesta de valor
 * general, no datos de tracción, así que se mantienen tal cual se
 * plantearon. Sin la foto de stock del boceto (no hay un asset propio
 * verificado para usar en su lugar) -- layout de dos columnas con un
 * bloque visual simple en vez de una fotografía.
 */
const BENEFITS = [
  {
    title: "Más tiempo para tus pacientes",
    description: "Automatiza tareas administrativas y enfócate en lo que realmente importa.",
  },
  {
    title: "Cumplimiento normativo",
    description: "Alineado con las regulaciones y guías de salud de la República Dominicana.",
  },
  {
    title: "Información segura y siempre disponible",
    description: "Tus datos protegidos con los más altos estándares de seguridad en la nube.",
  },
  {
    title: "Soporte local, humano y cercano",
    description: "Estamos aquí para ayudarte en cada paso del camino.",
  },
];

export function LandingBenefits() {
  return (
    <section className="px-4 py-16 sm:py-20">
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2 lg:items-center">
        <div className="flex aspect-4/3 items-center justify-center rounded-3xl bg-linear-to-br from-brand-blue/10 to-brand-teal/10">
          <svg viewBox="0 0 24 24" fill="none" className="h-24 w-24 text-brand-blue/40" aria-hidden="true">
            <path
              d="M12 3.5 5 6v5.5c0 4.2 2.9 7.3 7 9 4.1-1.7 7-4.8 7-9V6l-7-2.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="m9 12 2 2 4-4.4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div>
          <span className="rounded-full bg-brand-teal/10 px-4 py-1.5 text-sm font-medium text-brand-teal">
            ¿Por qué elegir Cuido?
          </span>
          <h2 className="mt-4 text-2xl font-bold text-brand-navy sm:text-3xl">
            Beneficios que <span className="text-brand-teal">transforman</span> la gestión de tu
            clínica
          </h2>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {BENEFITS.map(({ title, description }) => (
              <div key={title} className="flex items-start gap-3">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="m8 12.3 2.5 2.5L16 9.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-brand-navy">{title}</h3>
                  <p className="mt-0.5 text-sm text-zinc-600">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
