import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import {
  DELETION_WAIT_DAYS,
  DELETION_WARNING_TEXT,
  FISCAL_ARCHIVE_YEARS,
  deletionStep,
  type DeletionStatus,
} from "@/lib/domain/data-deletion";
import { ConfirmExportForm, RequestForm, WithdrawForm } from "./deletion-forms";

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("es-DO", { dateStyle: "long" });
}

export default async function DataDeletionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");

  const { data: today } = await supabase.rpc("dr_today");
  const { data: open } = await supabase
    .from("clinic_deletion_requests")
    .select("id, status, requested_at, export_confirmed_at, scheduled_for, channel")
    .eq("clinic_id", membership.clinicId)
    .eq("status", "solicitada")
    .maybeSingle();

  const step = deletionStep(
    open
      ? {
          status: open.status as DeletionStatus,
          exportConfirmedAt: open.export_confirmed_at,
          scheduledFor: open.scheduled_for,
        }
      : null,
    (today as string | null) ?? new Date().toISOString().slice(0, 10)
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Eliminar los datos de la clínica</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Solo el administrador puede solicitarlo. Es una acción irreversible, así que ocurre en pasos y con una espera
          de {DELETION_WAIT_DAYS} días.
        </p>
      </div>

      <section className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <h2 className="text-lg font-medium">Cómo funciona</h2>
        <ol className="list-decimal pl-5">
          <li>Aceptas una advertencia y solicitas la eliminación.</li>
          <li>Descargas el libro completo de tu clínica y confirmas que lo verificaste.</li>
          <li>
            Pasados {DELETION_WAIT_DAYS} días desde esa confirmación, Narnia Tech Solution elimina los datos. Hasta
            entonces puedes seguir trabajando y puedes desistir.
          </li>
        </ol>
        <p>
          Se elimina todo (pacientes, consultas, citas, consentimientos, reclamaciones, mensajes y el equipo). Los
          comprobantes fiscales electrónicos (e-CF) se conservan archivados {FISCAL_ARCHIVE_YEARS} años por obligación
          fiscal, solo con sus datos fiscales y sin vínculo con ningún paciente ni expediente.
        </p>
      </section>

      {step === "solicitar" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">1. Solicitar la eliminación</h2>
          <RequestForm warningText={DELETION_WARNING_TEXT} />
        </section>
      )}

      {open && step === "descargar" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">2. Descarga y confirma</h2>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Solicitud registrada el {new Date(open.requested_at).toLocaleDateString("es-DO", { dateStyle: "long" })}. Descarga
            el libro completo (todas las hojas) y ábrelo para verificarlo. La descarga debe hacerse después de la
            solicitud.
          </p>
          <div>
            {/* <a> normal, no <Link>: descarga un archivo (Route Handler con Content-Disposition). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/patients/export/records?dataset=all" className="text-brand-blue hover:underline">
              Descargar el libro completo (.xlsx)
            </a>
          </div>
          <ConfirmExportForm requestId={open.id} />
          <WithdrawForm requestId={open.id} />
        </section>
      )}

      {open && (step === "en_espera" || step === "lista") && open.scheduled_for && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">3. Eliminación programada</h2>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {step === "lista"
              ? "Ya se cumplió la espera: Narnia Tech Solution puede eliminar los datos de tu clínica en cualquier momento."
              : `Los datos de tu clínica se eliminarán a partir del ${formatDate(open.scheduled_for)}.`}{" "}
            Mientras tanto puedes seguir trabajando. Puedes desistir hasta que se ejecute.
          </p>
          <WithdrawForm requestId={open.id} />
        </section>
      )}
    </div>
  );
}
