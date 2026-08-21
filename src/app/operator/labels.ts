export const BUSINESS_MODEL_LABELS: Record<string, string> = {
  modelo_c: "Modelo C — Setup fee + suscripción por tramo",
  modelo_e: "Modelo E — Canal asociativo / franquicia",
  modelo_f: "Modelo F — Freemium con upsell",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  al_dia: "Al día",
  pendiente: "Pendiente",
  vencido: "Vencido",
};

export function formatPrice(price: number | string | null): string {
  if (price === null || price === undefined) return "—";
  const value = typeof price === "string" ? Number(price) : price;
  if (Number.isNaN(value)) return "—";
  return `RD$ ${value.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`;
}
