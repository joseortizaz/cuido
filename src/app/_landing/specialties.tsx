const SPECIALTIES = [
  "Medicina Interna",
  "Pediatría",
  "Ginecología y Obstetricia",
  "Cirugía General",
  "Anestesiología",
];

export function LandingSpecialties() {
  return (
    <section className="px-4 py-16 sm:py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <h2 className="text-2xl font-bold text-brand-navy sm:text-3xl">
          Especialidades disponibles hoy
        </h2>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {SPECIALTIES.map((specialty) => (
            <span
              key={specialty}
              className="rounded-full border border-brand-teal/30 bg-brand-teal/5 px-5 py-2 text-sm font-medium text-brand-navy sm:text-base"
            >
              {specialty}
            </span>
          ))}
        </div>

        <p className="mt-6 text-sm text-zinc-500">Y seguimos sumando más.</p>
      </div>
    </section>
  );
}
