"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ALLOWED_STUDY_MIME_TYPES,
  MAX_STUDY_FILE_BYTES,
  formatFileSize,
  sniffStudyMime,
} from "@/lib/domain/study-results";
import {
  finalizeStudyFileUpload,
  prepareStudyFileUpload,
  voidStudy,
  voidStudyAttachment,
  type StudyFormState,
} from "../actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";
const buttonClass =
  "rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]";
const dangerClass =
  "rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";

type Line = { name: string; status: "subiendo" | "listo" | "error"; message?: string };

/**
 * Subida de archivos del estudio. El archivo va DIRECTO del navegador a Storage con una URL firmada de subida que
 * el servidor genera para una ruta que él mismo elige; el servidor luego verifica el tipo real y el tamaño y
 * registra el adjunto. Así no depende del límite de ~4.5 MB del cuerpo de una función de Vercel.
 */
export function StudyUploader({ patientId, studyId, disabled }: { patientId: string; studyId: string; disabled: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setLines(files.map((f) => ({ name: f.name, status: "subiendo" })));
    const supabase = createClient();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const update = (patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
      try {
        // Validación previa en el navegador (Storage y el servidor vuelven a validar).
        if (file.size === 0) throw new Error("está vacío.");
        if (file.size > MAX_STUDY_FILE_BYTES) throw new Error("pasa de 10 MB.");
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const mime = sniffStudyMime(head);
        if (!mime) throw new Error("no es un PDF, JPG o PNG válido.");
        if (!(ALLOWED_STUDY_MIME_TYPES as readonly string[]).includes(mime)) throw new Error("tipo no admitido.");

        const prepared = await prepareStudyFileUpload(studyId, file.name, file.size, mime);
        if ("error" in prepared) throw new Error(prepared.error);
        const { error } = await supabase.storage.from("study-results").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: mime });
        if (error) throw new Error("no se pudo subir.");
        const done = await finalizeStudyFileUpload(patientId, studyId, prepared.path, file.name);
        if (done.error) throw new Error(done.error);
        update({ status: "listo" });
      } catch (e) {
        update({ status: "error", message: e instanceof Error ? e.message : "falló." });
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          disabled={disabled || busy}
          aria-label="Archivos del resultado"
          className="text-sm"
        />
        <button type="button" onClick={upload} disabled={disabled || busy} className={buttonClass}>
          {busy ? "Subiendo…" : "Subir archivos"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">PDF, JPG o PNG, hasta {formatFileSize(MAX_STUDY_FILE_BYTES)} cada uno (máximo 10 por estudio).</p>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {lines.map((l, i) => (
            <li key={i} className={l.status === "error" ? "text-red-600 dark:text-red-400" : l.status === "listo" ? "text-green-700 dark:text-green-400" : "text-zinc-500"}>
              {l.status === "subiendo" ? "Subiendo" : l.status === "listo" ? "Listo" : "No se subió"}: {l.name}
              {l.status === "error" && l.message ? ` — ${l.message}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VoidAttachmentForm({ patientId, studyId, attachmentId, disabled }: { patientId: string; studyId: string; attachmentId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<StudyFormState, FormData>(
    voidStudyAttachment.bind(null, patientId, studyId, attachmentId),
    undefined
  );
  const [reason, setReason] = useState("");
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-zinc-500">Retirar</summary>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" className={`${inputClass} text-xs`} />
        <button type="submit" disabled={pending || disabled} className={dangerClass}>
          {pending ? "Retirando…" : "Retirar adjunto"}
        </button>
        {state?.error && <span className="text-red-600 dark:text-red-400">{state.error}</span>}
      </form>
    </details>
  );
}

export function VoidStudyForm({ patientId, studyId, disabled }: { patientId: string; studyId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<StudyFormState, FormData>(voidStudy.bind(null, patientId, studyId), undefined);
  const [reason, setReason] = useState("");
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Anular un estudio lo deja visible como «Anulado», con su motivo; sus datos y su historial se conservan.
      </p>
      <label htmlFor="void_study_reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Motivo (obligatorio)
      </label>
      <input id="void_study_reason" name="reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} max-w-md`} />
      <div>
        <button type="submit" disabled={pending || disabled} className={dangerClass}>
          {pending ? "Anulando…" : "Anular estudio"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
