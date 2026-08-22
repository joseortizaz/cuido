import { CONTACT_ANCHOR } from "./constants";
import { LandingHeroVisual } from "./hero-visual";

export function LandingHero() {
  return (
    <section className="px-4 pb-16 pt-28 sm:pb-24 sm:pt-36">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-8">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <span className="rounded-full bg-brand-teal/10 px-4 py-1.5 text-sm font-medium text-brand-teal">
            Hecho para clínicas dominicanas
          </span>

          <h1 className="mt-6 max-w-xl text-4xl font-bold leading-tight text-brand-navy sm:text-5xl">
            La plataforma de gestión clínica hecha para República Dominicana
          </h1>

          <p className="mt-6 max-w-xl text-base text-zinc-600 sm:text-lg">
            Historias clínicas configurables por especialidad, cumplimiento
            e-CF/DGII y gestión de equipo — todo en un solo lugar, pensado para
            cómo trabajan las clínicas dominicanas.
          </p>

          <a
            href={CONTACT_ANCHOR}
            className="mt-8 rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-brand-blue/20 transition-opacity hover:opacity-90 sm:text-lg"
          >
            Solicitar una demo
          </a>

          <p className="mt-8 text-sm font-medium tracking-wide text-brand-navy/70">
            Gestión que cuida, salud que crece
          </p>
        </div>

        <LandingHeroVisual />
      </div>
    </section>
  );
}
