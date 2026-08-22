import { CONTACT_ANCHOR } from "./constants";

export function LandingFinalCta() {
  return (
    <section className="px-4 py-16 sm:py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 rounded-3xl bg-linear-to-r from-brand-blue to-brand-teal px-6 py-14 text-center sm:px-12">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          ¿Listo para llevar la gestión de tu clínica al siguiente nivel?
        </h2>
        <p className="max-w-xl text-sm text-white/85 sm:text-base">
          Solicita una demo gratuita y descubre todo lo que Cuido puede hacer por tu centro de
          salud.
        </p>
        <a
          href={CONTACT_ANCHOR}
          className="rounded-full bg-white px-8 py-3.5 text-base font-semibold text-brand-navy shadow-md transition-opacity hover:opacity-90 sm:text-lg"
        >
          Solicitar demo gratuita
        </a>
      </div>
    </section>
  );
}
