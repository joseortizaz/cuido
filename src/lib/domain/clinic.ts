/**
 * Debe mantenerse en sync manualmente con las CHECK constraints de
 * supabase/migrations/20260820031102_core_tenant_model.sql (columna
 * `province` de `clinics`) y con el enum `clinic_business_model`. No hay
 * generación automática todavía — si cambia la migración, actualizar aquí.
 */

export const DOMINICAN_PROVINCES = [
  "Azua",
  "Bahoruco",
  "Barahona",
  "Dajabón",
  "Distrito Nacional",
  "Duarte",
  "El Seibo",
  "Elías Piña",
  "Espaillat",
  "Hato Mayor",
  "Hermanas Mirabal",
  "Independencia",
  "La Altagracia",
  "La Romana",
  "La Vega",
  "María Trinidad Sánchez",
  "Monseñor Nouel",
  "Monte Cristi",
  "Monte Plata",
  "Pedernales",
  "Peravia",
  "Puerto Plata",
  "Samaná",
  "San Cristóbal",
  "San José de Ocoa",
  "San Juan",
  "San Pedro de Macorís",
  "Sánchez Ramírez",
  "Santiago",
  "Santiago Rodríguez",
  "Santo Domingo",
  "Valverde",
] as const;

export type DominicanProvince = (typeof DOMINICAN_PROVINCES)[number];

export const CLINIC_BUSINESS_MODELS = [
  { value: "modelo_c", label: "Modelo C — Setup fee + suscripción por tramo" },
  { value: "modelo_e", label: "Modelo E — Canal asociativo / franquicia" },
  { value: "modelo_f", label: "Modelo F — Freemium con upsell" },
] as const;

export type ClinicBusinessModel = (typeof CLINIC_BUSINESS_MODELS)[number]["value"];
