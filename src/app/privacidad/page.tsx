import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { LegalNotice } from "@/app/_landing/legal-notice";
import { CONTACT_EMAIL } from "@/app/_landing/constants";

/**
 * Política de Privacidad -- primera versión real basada en lo que la
 * plataforma hace hoy (verificado contra el esquema de Supabase y el
 * código antes de escribir cada afirmación, no texto de relleno
 * genérico). Requerida por Meta como parte de la configuración de la App
 * de WhatsApp Business (ver /eliminacion-datos, requisito hermano).
 *
 * Nota sobre la sección de WhatsApp: a la fecha de esta versión, la
 * integración con la API de WhatsApp Business de Meta NO está construida
 * en el producto (verificado: cero referencias a WhatsApp en el código,
 * cero Edge Functions relacionadas) -- está en proceso de aprobación
 * ante Meta, que es precisamente por lo que esta página existe. Se
 * describe la función honestamente como "en proceso de integración, aún
 * no activa para ninguna clínica", no como algo ya operando.
 *
 * Corrección respecto al encargo original: el marco legal cita el
 * "Reglamento Técnico para la Gestión del Expediente Clínico" del MSP
 * SIN número de resolución -- verificado contra src/lib/normativa.ts y
 * las migraciones que lo citan (20260820171621_specialty_templates_normativa_msp.sql):
 * ninguna menciona una resolución para ese reglamento. La "Resolución
 * 0013-2023" pertenece a un documento distinto (la Guía de Manejo de
 * Enfermedad Renal Crónica, específica de Nefrología) -- no se repite
 * esa cita incorrecta aquí.
 */
export default function PrivacidadPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-brand-navy sm:text-4xl">Política de Privacidad</h1>
          <LegalNotice lastUpdated="23 de agosto de 2026" />

          <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed text-zinc-700 sm:text-base">
            <section>
              <h2 className="text-lg font-semibold text-brand-navy">1. Responsable del tratamiento</h2>
              <p className="mt-2">
                Cuido es desarrollado y operado por <strong>Narnia Tech Solution, SRL</strong> (RNC
                1-33-74485-6), empresa dominicana. Para cualquier consulta sobre esta política o
                sobre tus datos, puedes escribir a{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand-blue hover:underline">
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">2. Qué datos recolectamos</h2>
              <ul className="mt-2 flex flex-col gap-3">
                <li>
                  <strong className="text-brand-navy">Datos de cuenta:</strong> correo electrónico y
                  nombre de las personas que usan la plataforma (personal de cada clínica).
                </li>
                <li>
                  <strong className="text-brand-navy">Datos de la clínica:</strong> nombre, provincia,
                  modelo de negocio y datos de suscripción/plan.
                </li>
                <li>
                  <strong className="text-brand-navy">Datos de pacientes</strong>, ingresados por el
                  personal de cada clínica: nombre, fecha de nacimiento, sexo, cédula o pasaporte
                  (cuando aplica), teléfono y correo de contacto, y los datos clínicos que el
                  personal registra en cada consulta según la especialidad (por ejemplo, alergias,
                  medicamentos activos, hallazgos, diagnósticos y plan de tratamiento, entre otros
                  campos definidos por cada plantilla clínica).
                </li>
                <li>
                  <strong className="text-brand-navy">Datos de consentimientos informados</strong>{" "}
                  firmados digitalmente: el texto exacto firmado, un hash criptográfico que ata el
                  documento a quién firmó y cuándo, la dirección IP y la fecha/hora de la firma.
                </li>
                <li>
                  <strong className="text-brand-navy">
                    Datos vía WhatsApp para recordatorios de citas
                  </strong>{" "}
                  (en proceso de integración): Cuido está integrando la API de WhatsApp Business de
                  Meta para enviar recordatorios de citas. Esta función <strong>todavía no está
                  activa para ninguna clínica</strong> -- se documenta aquí porque forma parte del
                  proceso de aprobación de esa integración ante Meta. Cuando esté disponible, y solo
                  para las clínicas que decidan activarla, se usará el número de teléfono del
                  paciente y el contenido de mensajes de plantilla previamente aprobados por Meta
                  (por ejemplo, el recordatorio de una cita).
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">3. Marco legal</h2>
              <p className="mt-2">
                El tratamiento de datos personales en Cuido se rige por la Ley No. 172-13 sobre
                Protección de Datos Personales de la República Dominicana. El manejo de datos
                clínicos sigue además el Reglamento Técnico para la Gestión del Expediente Clínico
                del Ministerio de Salud Pública (MSP).
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">
                4. Aislamiento entre clínicas
              </h2>
              <p className="mt-2">
                Cada clínica que usa Cuido solo puede acceder a los datos de sus propios pacientes y
                su propio personal. Esto no es solo una regla de la aplicación: está impuesto a
                nivel de base de datos mediante políticas de seguridad a nivel de fila (Row Level
                Security) en Postgres, verificadas con pruebas automatizadas en cada cambio de
                código. El personal de una clínica no puede ver los datos de otra clínica, ni por
                error.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">
                5. Control de acceso reforzado para Salud Mental
              </h2>
              <p className="mt-2">
                Dentro de una misma clínica, las notas clínicas de la especialidad Salud Mental /
                Psicología tienen una capa adicional de protección: solo el profesional que atendió
                directamente al paciente puede leerlas. Cualquier otro médico de la misma clínica
                necesita que un administrador le otorgue acceso explícito, caso por caso, con un
                motivo registrado -- ni siquiera un administrador puede leer esas notas solo por su
                rol.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">6. Con quién compartimos datos</h2>
              <ul className="mt-2 flex flex-col gap-2">
                <li>
                  <strong className="text-brand-navy">Supabase</strong> — base de datos, autenticación
                  e infraestructura donde se almacenan los datos.
                </li>
                <li>
                  <strong className="text-brand-navy">Vercel</strong> — hosting de la aplicación web.
                </li>
                <li>
                  <strong className="text-brand-navy">Meta / WhatsApp Business API</strong> — solo el
                  número de teléfono y el contenido del mensaje de plantilla aprobado, y solo para
                  clínicas que activen la función de recordatorios (ver sección 2 -- aún no
                  disponible).
                </li>
              </ul>
              <p className="mt-3">No vendemos datos personales a terceros ni los usamos con fines publicitarios.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">7. Tus derechos</h2>
              <p className="mt-2">
                Puedes solicitar acceso a tus datos, su rectificación, o su eliminación. El proceso
                de eliminación, incluyendo la distinción entre datos de cuenta y datos de pacientes
                dentro de una clínica, se explica en detalle en nuestra{" "}
                <a href="/eliminacion-datos" className="font-medium text-brand-blue hover:underline">
                  Política de Eliminación de Datos
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
