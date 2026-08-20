# Cuido

Plataforma SaaS de gestión clínica multiespecialidad para el mercado dominicano.
Ver [CLAUDE.md](./CLAUDE.md) para el contexto completo del producto, modelo de
negocio y filosofía de desarrollo (seguridad y multi-tenancy antes que MVP).

**Estado actual: Fase 1 (arranque) — autenticación y alta de clínica.**
Fase 0 (infraestructura, RLS, CI) está cerrada. Este incremento agrega el
único flujo de producto que existe hasta ahora: registro/login y creación
de una clínica (el usuario que la crea queda como su admin). El núcleo
clínico (pacientes, agenda, expedientes) y las especialidades todavía no
existen — son los siguientes incrementos de Fase 1.

## Stack

- Next.js (App Router, TypeScript) — desplegado en Vercel
- Supabase (Postgres, Auth, RLS) — proyecto `pieueeejyehuufbdxdeb`
- GitHub Actions — lint, type-check, prueba de aislamiento entre tenants

## Setup local

```bash
npm install
cp .env.local.example .env.local   # rellenar con las credenciales del proyecto
npm run dev
```

Las credenciales de Supabase se leen únicamente de variables de entorno
(`src/lib/supabase/env.ts`) — nunca hardcodeadas. `.env.local` no se versiona.

## Base de datos y migraciones

El CLI de Supabase está inicializado (`supabase/`). Para trabajar contra el
proyecto remoto:

```bash
supabase login --token <tu-personal-access-token>   # una vez por máquina
supabase link --project-ref pieueeejyehuufbdxdeb
supabase db push                                     # aplica migrations/ al remoto
```

Para desarrollo/pruebas locales (recomendado — nunca contra datos reales):

```bash
supabase start        # requiere Docker Desktop corriendo
supabase db reset      # reaplica todas las migraciones desde cero
```

**Regla no negociable (ver CLAUDE.md):** ninguna tabla nueva se crea sin su
política de RLS correspondiente en el mismo commit/migración.

## Autenticación y alta de clínica

`clinics`/`clinic_members` no tienen política de INSERT para `authenticated`
a propósito (ver la migración de Fase 0) — la única forma de crear una
clínica es el RPC `create_clinic_with_admin`
([supabase/migrations/20260820042919_clinic_onboarding.sql](supabase/migrations/20260820042919_clinic_onboarding.sql)),
que crea la clínica y autoasigna a quien la llama como admin en la misma
transacción. `user_id` y `role` nunca los decide el cliente.

Dos caminos para llegar a ese RPC (o a su equivalente por service_role):

- **Signup público**: `/signup` → confirmar correo → `/login` →
  `/onboarding` (llama al RPC) → `/dashboard`. Rutas en `src/app/`,
  refresco de sesión en [src/proxy.ts](src/proxy.ts) (convención `proxy` de
  Next.js 16, antes `middleware.ts`).
- **Aprovisionamiento interno** (piloto, Modelo E/canal asociativo):

  ```bash
  npm run provision:clinic -- \
    --name "Clínica Ejemplo" \
    --province "Distrito Nacional" \
    --business-model modelo_c \
    --admin-email admin@clinica-ejemplo.com
  ```

  Usa `SUPABASE_SERVICE_ROLE_KEY`, invita al admin por correo (nunca
  genera ni conoce una contraseña) y bypassa RLS intencionalmente — script
  de confianza, no expuesto como endpoint.

## Prueba de aislamiento entre tenants

```bash
npm run test:tenant-isolation
```

Crea dos clínicas y usuarios sintéticos, confirma que ninguno puede leer ni
escribir datos del otro tenant, y limpia los datos al terminar. Corre contra
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` del entorno — en CI, contra un stack local
efímero (`supabase start`), nunca contra producción.

## CI

`.github/workflows/ci.yml` corre en cada PR a `main`: `lint`, `typecheck` y
`tenant-isolation`. Deben configurarse como *required status checks* en
GitHub (Settings → Branches → Branch protection rules para `main`).
