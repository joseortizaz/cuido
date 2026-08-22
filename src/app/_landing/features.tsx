import { FEATURES } from "./features-data";

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
