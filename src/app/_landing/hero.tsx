import { DEMO_MAILTO } from "./constants";

export function LandingHero() {
  return (
    <section className="flex flex-col items-center px-4 pb-16 pt-28 text-center sm:pb-24 sm:pt-36">
      <span className="rounded-full bg-brand-teal/10 px-4 py-1.5 text-sm font-medium text-brand-teal">
        Hecho para clínicas dominicanas
      </span>

      <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight text-brand-navy sm:text-5xl md:text-6xl">
        La plataforma de gestión clínica hecha para República Dominicana
      </h1>

      <p className="mt-6 max-w-2xl text-base text-zinc-600 sm:text-lg">
        Historias clínicas configurables por especialidad, cumplimiento
        e-CF/DGII y gestión de equipo — todo en un solo lugar, pensado para
        cómo trabajan las clínicas dominicanas.
      </p>

      <a
        href={DEMO_MAILTO}
        className="mt-8 rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-brand-blue/20 transition-opacity hover:opacity-90 sm:text-lg"
      >
        Solicitar una demo
      </a>

      <p className="mt-8 text-sm font-medium tracking-wide text-brand-navy/70">
        Gestión que cuida, salud que crece
      </p>
    </section>
  );
}
