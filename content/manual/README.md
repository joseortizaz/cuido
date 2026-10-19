# Manual del Usuario

Contenido del Manual del Usuario para las clínicas suscritas (`/manual` y `/manual/pdf`, dentro del panel).

| Archivo | Qué es |
|---|---|
| `manual-usuario.md` | **Fuente única** del contenido (Markdown). La página `/manual` lo renderiza (`src/lib/manual.ts`). |
| `Manual-del-Usuario-Cuido.pdf` | Versión para imprimir. Se entrega solo con sesión y clínica activa (`/manual/pdf`); **no** está en `public/`. |

## Formato que entiende el render (`src/lib/manual-render.ts`)

- `# ` = capítulo y `## ` = sección: llevan ancla y salen en el índice. Un `# Manual del Usuario` al inicio se omite (el título lo pone la página).
- Cuadros destacados, con el rótulo en negrita al inicio del bloque:
  `> **Importante:** …` (ámbar), `> **Nota:** …` (azul), `> **Consejo:** …` (teal) y `> **Costo adicional:** …` (rojo).
- Tablas en Markdown estándar (hacen scroll horizontal en móvil).

## Regla

El `.md` es la fuente. Si se edita el contenido, se regenera el PDF desde él y **se commitean ambos juntos**.

## Regenerar el PDF

Solo a mano, cuando cambie el contenido (no corre en CI ni en el build de Vercel). Requiere Python con `markdown` y `playwright`:

```bash
pip install markdown playwright
playwright install chromium
python scripts/manual/build.py
```

El script (`scripts/manual/build.py`, con `scripts/manual/logo.png`) regenera el PDF desde el `.md`; si pide otros argumentos o pasos, manda su propio encabezado.
