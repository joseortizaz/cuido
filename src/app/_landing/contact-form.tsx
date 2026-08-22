"use client";

import { useState } from "react";
import { CONTACT_EMAIL } from "./constants";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-blue sm:text-base";

/**
 * Mecanismo de envío elegido (decisión explícita, no la única opción
 * posible -- ver el cierre de esta tarea para el razonamiento completo):
 * un mailto: pre-rellenado, construido en el cliente a partir de los
 * campos del formulario, en vez de una Edge Function que envíe el correo.
 *
 * Por qué: enviar un correo real desde una Edge Function requiere un
 * proveedor de envío (Resend, SendGrid, etc.) -- una cuenta, credenciales y
 * variables de entorno nuevas. Eso SÍ es "infraestructura nueva" en el
 * sentido que importa aquí (algo que hay que dar de alta, configurar y
 * mantener), aunque técnicamente sea "solo" una Edge Function. Un mailto:
 * pre-rellenado no depende de nada de eso: abre el cliente de correo que
 * el visitante ya tiene configurado, con asunto y cuerpo ya armados a
 * partir de lo que escribió. Sigue el mismo criterio que ya se usaba para
 * "Solicitar demo" (DEMO_MAILTO, ahora reemplazado por este formulario).
 *
 * Limitación real, sin maquillar: si el visitante no tiene un cliente de
 * correo configurado en su dispositivo (común en algunos navegadores/SO),
 * el botón no hace nada visible. Aceptable para esta ronda -- no hay
 * registro/backend de envíos de todas formas.
 */
export function ContactForm() {
  const [sent, setSent] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const name = String(data.get("name") ?? "");
        const email = String(data.get("email") ?? "");
        const phone = String(data.get("phone") ?? "");
        const message = String(data.get("message") ?? "");

        const body = [
          `Nombre: ${name}`,
          `Correo: ${email}`,
          phone ? `Teléfono: ${phone}` : null,
          "",
          message,
        ]
          .filter((line) => line !== null)
          .join("\n");

        const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
          "Solicitud de demo - Cuido"
        )}&body=${encodeURIComponent(body)}`;

        window.location.href = mailto;
        setSent(true);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-name" className="text-sm font-medium text-brand-navy">
            Nombre
          </label>
          <input id="contact-name" name="name" type="text" required className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-email" className="text-sm font-medium text-brand-navy">
            Correo
          </label>
          <input id="contact-email" name="email" type="email" required className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-phone" className="text-sm font-medium text-brand-navy">
          Teléfono (opcional)
        </label>
        <input id="contact-phone" name="phone" type="tel" className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-message" className="text-sm font-medium text-brand-navy">
          Mensaje
        </label>
        <textarea id="contact-message" name="message" rows={4} required className={inputClass} />
      </div>

      <button
        type="submit"
        className="mt-2 self-start rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-8 py-3 text-base font-semibold text-white shadow-md shadow-brand-blue/20 transition-opacity hover:opacity-90"
      >
        Enviar mensaje
      </button>

      {sent && (
        <p className="text-sm text-brand-teal">
          Se abrió tu cliente de correo con el mensaje listo para enviar a {CONTACT_EMAIL}. Si no
          se abrió nada, puedes escribirnos directamente a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      )}
    </form>
  );
}
