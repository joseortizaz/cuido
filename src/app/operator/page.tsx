import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { BUSINESS_MODEL_LABELS, PAYMENT_STATUS_LABELS, formatPrice } from "./labels";

export default async function OperatorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await requireOperatorPage(supabase);

  const [{ data: clinics }, { data: subscriptions }, { data: members }] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, name, province, business_model, is_active")
      .order("name"),
    supabase.from("clinic_subscriptions").select("*"),
    supabase.from("clinic_members").select("clinic_id"),
  ]);

  const subByClinic = new Map((subscriptions ?? []).map((s) => [s.clinic_id, s]));
  const memberCountByClinic = new Map<string, number>();
  for (const m of members ?? []) {
    memberCountByClinic.set(m.clinic_id, (memberCountByClinic.get(m.clinic_id) ?? 0) + 1);
  }

  // Caso operador + admin de su propia clínica -- ver nota en src/app/page.tsx.
  const ownMembership = await getCurrentClinicMembership(supabase);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clínicas</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {clinics?.length ?? 0} clínica{clinics?.length === 1 ? "" : "s"} en la plataforma.
          </p>
        </div>
        {ownMembership && (
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
            Ir a tu clínica →
          </Link>
        )}
      </div>

      {!clinics || clinics.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no hay clínicas registradas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-4">Clínica</th>
                <th className="py-2 pr-4">Provincia</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Precio</th>
                <th className="py-2 pr-4">Próximo pago</th>
                <th className="py-2 pr-4">Estado de pago</th>
                <th className="py-2 pr-4">Miembros</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {clinics.map((clinic) => {
                const sub = subByClinic.get(clinic.id);
                return (
                  <tr key={clinic.id}>
                    <td className="py-3 pr-4">
                      <Link href={`/operator/${clinic.id}`} className="font-medium hover:underline">
                        {clinic.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">{clinic.province}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          clinic.is_active
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-700 dark:text-red-400"
                        }
                      >
                        {clinic.is_active ? "Activa" : "Desactivada"}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {BUSINESS_MODEL_LABELS[clinic.business_model]?.split(" — ")[0] ?? clinic.business_model}
                    </td>
                    <td className="py-3 pr-4">{formatPrice(sub?.price ?? null)}</td>
                    <td className="py-3 pr-4">{sub?.next_payment_due_on ?? "—"}</td>
                    <td className="py-3 pr-4">
                      {sub ? (PAYMENT_STATUS_LABELS[sub.payment_status] ?? sub.payment_status) : "—"}
                    </td>
                    <td className="py-3 pr-4">{memberCountByClinic.get(clinic.id) ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
