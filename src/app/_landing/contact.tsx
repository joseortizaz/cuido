import { ContactForm } from "./contact-form";

export function LandingContact() {
  return (
    <section id="contactenos" className="scroll-mt-24 px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-xl">
        <div className="text-center">
          <span className="rounded-full bg-brand-teal/10 px-4 py-1.5 text-sm font-medium text-brand-teal">
            Contáctenos
          </span>
          <h2 className="mt-4 text-2xl font-bold text-brand-navy sm:text-3xl">
            Solicita una demo
          </h2>
          <p className="mt-3 text-base text-zinc-600">
            Cuéntanos sobre tu clínica y te contactamos para mostrarte Cuido en acción.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
