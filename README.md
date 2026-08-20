# Cuido

Plataforma SaaS de gestión clínica multiespecialidad para el mercado dominicano.
Ver [CLAUDE.md](./CLAUDE.md) para el contexto completo del producto, modelo de
negocio y filosofía de desarrollo (seguridad y multi-tenancy antes que MVP).

**Estado actual: Fase 0 — infraestructura y seguridad base.** Sin pantallas ni
funcionalidad visible todavía; el objetivo de esta fase es el aislamiento
multi-tenant, RLS y el pipeline de CI.

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
