# Cuido

Plataforma SaaS de gestión clínica multiespecialidad para el mercado dominicano.
Ver [CLAUDE.md](./CLAUDE.md) para el contexto completo del producto, modelo de
negocio y filosofía de desarrollo (seguridad y multi-tenancy antes que MVP).

**Estado actual: Fase 1 — 5 especialidades de alta demanda completas.**
Fase 0 (infraestructura, RLS, CI), auth/onboarding y el núcleo clínico +
motor de plantillas están cerrados. Las 5 especialidades priorizadas de
CLAUDE.md ya existen como configuración en `specialty_templates`:
Medicina Interna, Pediatría, Ginecología y Obstetricia, Cirugía General y
Anestesiología. Agregar cada una no requirió tocar código de UI ni
esquema — solo una fila nueva, prueba directa de que el motor de
plantillas funciona como se diseñó.

**Aviso:** los campos de cada plantilla son un primer corte razonable
para probar el patrón de configuración, no un formulario clínico validado
por personal médico real. Deben revisarse con un médico de cada
especialidad antes de usarse con pacientes reales — ver el comentario en
la migración correspondiente.

**Actualización — alineación con normativa MSP** (ver
[docs/normativa-msp/](docs/normativa-msp/): Reglamento Técnico del
Expediente Clínico y Protocolo de Crecimiento y Desarrollo del MSP). Las
plantillas de Medicina Interna, Pediatría, Cirugía General y Ginecología y
Obstetricia se revisaron campo por campo contra la norma
([supabase/migrations/20260820171621_specialty_templates_normativa_msp.sql](supabase/migrations/20260820171621_specialty_templates_normativa_msp.sql)).
Anestesiología queda pendiente. El aviso de arriba sigue aplicando —
acercarse a la norma no reemplaza la validación clínica final.

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

## Núcleo clínico y motor de plantillas por especialidad

Principio de CLAUDE.md: *"la especialidad es configuración, no código"*.
`specialty_templates`
([supabase/migrations/20260820111106_clinical_core_and_templates.sql](supabase/migrations/20260820111106_clinical_core_and_templates.sql))
es un catálogo global (`schema jsonb` con campos dinámicos); agregar una
especialidad nueva es una fila, no una tabla ni una página nuevas — ver
[src/lib/domain/specialty-template.ts](src/lib/domain/specialty-template.ts)
(el motor que interpreta esos campos y construye su validación con Zod en
runtime).

`patients` → `encounters` (+ `vital_signs`, `allergies`, `medications`)
tienen tablas padre, a diferencia de `clinics`/`clinic_members` — un
`clinic_id` enviado por el cliente no basta para aislarlas: hace falta
evitar que alguien inserte, p. ej., una alergia con `patient_id` de otro
tenant pero su propio `clinic_id`. Por eso estas tablas usan triggers
`BEFORE INSERT` (`set_clinic_id_from_patient`/`set_clinic_id_from_encounter`)
que derivan `clinic_id` del registro padre e ignoran lo que mande el
cliente — mismo principio no negociable de CLAUDE.md, un nivel más abajo
del árbol de tenant.

RLS por rol, no solo por tenant: cualquier miembro de la clínica lee y
registra pacientes (recepción incluida), pero solo `admin`/`medico`
(`is_clinic_clinician`) puede escribir contenido clínico (consultas,
vitales, alergias, medicamentos).

Al crear una consulta (`/patients/[id]/encounters/new`), primero se elige
la especialidad (selector — necesario desde que hay más de una plantilla
activa) y luego se renderiza el formulario dinámico de esa especialidad
en `/patients/[id]/encounters/new/[templateId]`.

Dos mecanismos de organización dentro de un `TemplateField`
([src/lib/domain/specialty-template.ts](src/lib/domain/specialty-template.ts)),
deliberadamente distintos:
- `section`: agrupación puramente visual dentro de UNA nota (p. ej. la
  anamnesis de Medicina Interna). No afecta validación.
- `condition`: un campo solo aplica si otro campo del mismo formulario
  tiene cierto valor (p. ej. "detalle de transfusión" solo si "hubo
  transfusión" = Sí en Cirugía General).

Notas que ocurren en momentos clínicos distintos (nota preoperatoria vs.
descripción quirúrgica postoperatoria; consulta prenatal vs. admisión por
parto vs. puerperio) **no** se modelan con `condition` — son filas
separadas de `specialty_templates`, seleccionables en el mismo picker.
Cero cambios de esquema para agregar una variante.

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
