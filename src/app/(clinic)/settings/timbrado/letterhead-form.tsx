"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MAX_LOGO_BYTES, sniffLogoMime } from "@/lib/domain/prescriptions";
import {
  finalizeLetterheadLogo,
  prepareLetterheadLogoUpload,
  removeLetterheadLogo,
  saveLetterhead,
  type LetterheadState,
} from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]";

type Fields = { name: string; address: string; phones: string; email: string; rnc: string };

export function LetterheadForm({
  initial,
  hasLetterhead,
  hasLogo,
  disabled,
}: {
  initial: Fields;
  hasLetterhead: boolean;
  hasLogo: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<LetterheadState, FormData>(saveLetterhead, undefined);
  const [f, setF] = useState<Fields>(initial);
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const fileRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ error?: string; success?: string }>({});

  // El logo va directo del navegador a Storage (URL firmada de subida); el servidor verifica el tipo real y el tamaño.
  async function uploadLogo() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    setLogoMsg({});
    try {
      if (file.size === 0) throw new Error("El archivo está vacío.");
      if (file.size > MAX_LOGO_BYTES) throw new Error("El logo no puede pasar de 2 MB.");
      const mime = sniffLogoMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (!mime) throw new Error("El logo debe ser un PNG o JPG válido.");
      const prepared = await prepareLetterheadLogoUpload(file.name, file.size, mime);
      if ("error" in prepared) throw new Error(prepared.error);
      const { error } = await createClient().storage.from("clinic-letterhead").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: mime });
      if (error) throw new Error("No se pudo subir el logo.");
      const done = await finalizeLetterheadLogo(prepared.path);
      if (done?.error) throw new Error(done.error);
      setLogoMsg({ success: done?.success ?? "Logo actualizado." });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setLogoMsg({ error: e instanceof Error ? e.message : "No se pudo subir el logo." });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setLogoMsg({});
    const res = await removeLetterheadLogo();
    setLogoMsg(res ?? {});
    setLogoBusy(false);
    router.refresh();
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="lh_name" className="text-sm font-medium">
            Nombre de la clínica o consultorio
          </label>
          <input id="lh_name" name="name" required minLength={2} maxLength={120} value={f.name} onChange={set("name")} disabled={disabled} className={inputClass} />
          <p className="text-xs text-zinc-500">Si el médico trabaja de forma independiente, aquí va el nombre del médico.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lh_address" className="text-sm font-medium">
            Dirección
          </label>
          <textarea id="lh_address" name="address" rows={2} maxLength={300} value={f.address} onChange={set("address")} disabled={disabled} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lh_phones" className="text-sm font-medium">
            Teléfonos
          </label>
          <input id="lh_phones" name="phones" maxLength={120} value={f.phones} onChange={set("phones")} disabled={disabled} placeholder="809-555-0100 / 829-555-0101" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lh_email" className="text-sm font-medium">
            Correo
          </label>
          <input id="lh_email" name="email" type="email" maxLength={120} value={f.email} onChange={set("email")} disabled={disabled} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lh_rnc" className="text-sm font-medium">
            RNC (opcional)
          </label>
          <input id="lh_rnc" name="rnc" maxLength={20} value={f.rnc} onChange={set("rnc")} disabled={disabled} className={inputClass} />
        </div>
        {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
        <div>
          <button
            type="submit"
            disabled={pending || disabled}
            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {pending ? "Guardando…" : "Guardar timbrado"}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-panel-border pt-4">
        <h2 className="text-sm font-semibold">Logo (opcional)</h2>
        {!hasLetterhead ? (
          <p className="text-xs text-zinc-500">Guarda primero los datos del timbrado; después podrás subir el logo.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={disabled || logoBusy} aria-label="Archivo del logo" className="text-sm" />
              <button type="button" onClick={uploadLogo} disabled={disabled || logoBusy} className={buttonClass}>
                {logoBusy ? "Procesando…" : hasLogo ? "Cambiar logo" : "Subir logo"}
              </button>
              {hasLogo && (
                <button type="button" onClick={removeLogo} disabled={disabled || logoBusy} className={buttonClass}>
                  Quitar logo
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500">PNG o JPG, hasta 2 MB. Se imprime en blanco y negro o a color según la impresora.</p>
          </>
        )}
        {logoMsg.error && <p className="text-sm text-red-600 dark:text-red-400">{logoMsg.error}</p>}
        {logoMsg.success && <p className="text-sm text-green-700 dark:text-green-400">{logoMsg.success}</p>}
      </div>
    </div>
  );
}
