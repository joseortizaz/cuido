/**
 * Sección "Quiénes Somos" -- ancla dentro de la landing.
 *
 * Contenido deliberadamente breve: solo lo que se confirmó explícitamente
 * al pedir este rediseño (Narnia Tech Solution SRL, fundador con perfil
 * dual psicología + software, enfoque en tecnología de salud en RD). Sin
 * años de experiencia, cifras ni logros inventados -- si se quiere ampliar
 * este texto, es contenido pendiente de que el usuario lo redacte o lo
 * confirme, no algo que deba decidir unilateralmente.
 */
export function LandingAbout() {
  return (
    <section id="quienes-somos" className="scroll-mt-24 px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl text-center">
        <span className="rounded-full bg-brand-blue/10 px-4 py-1.5 text-sm font-medium text-brand-blue">
          Quiénes Somos
        </span>
        <h2 className="mt-4 text-2xl font-bold text-brand-navy sm:text-3xl">
          Narnia Tech Solution, SRL
        </h2>
        <p className="mt-6 text-base text-zinc-600 sm:text-lg">
          Cuido es desarrollado por Narnia Tech Solution, SRL, fundada por un desarrollador con un
          perfil dual en psicología y software, enfocado en construir tecnología para el sector
          salud en República Dominicana.
        </p>
      </div>
    </section>
  );
}
