/**
 * Reemplaza el testimonio del boceto (atribuido a "Dr. Luis Pérez, Director
 * Médico, Centro Médico Avanzado" -- una persona/clínica que no existe).
 * Mismo layout visual (fondo con degradado, cita destacada), pero el
 * contenido es una afirmación verificable sobre el proceso de construcción
 * del producto, sin atribuir a nadie. Texto tal como se propuso al pedir
 * este rediseño -- no inventado en esta pasada.
 */
export function LandingQuote() {
  return (
    <section className="px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl rounded-3xl bg-linear-to-r from-brand-blue to-brand-teal px-6 py-14 text-white sm:px-12">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-white/60" aria-hidden="true">
          <path d="M7.5 6C4.5 7.7 3 10 3 12.8c0 2.4 1.5 4 3.5 4 1.7 0 3-1.3 3-3s-1.2-2.8-2.7-2.9c.3-1.5 1.6-3 3.5-3.9L9 6Zm9 0c-3 1.7-4.5 4-4.5 6.8 0 2.4 1.5 4 3.5 4 1.7 0 3-1.3 3-3s-1.2-2.8-2.7-2.9c.3-1.5 1.6-3 3.5-3.9L16.5 6Z" />
        </svg>
        <p className="mt-4 text-xl font-medium leading-relaxed sm:text-2xl">
          Cada plantilla clínica de Cuido fue construida verificando el texto exacto de la
          normativa oficial del Ministerio de Salud Pública.
        </p>
      </div>
    </section>
  );
}
