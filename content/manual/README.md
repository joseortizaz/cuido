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

Solo a mano, cuando cambie el contenido (no corre en CI ni en el build de Vercel). No necesita Python ni dependencias nuevas: usa el mismo render que la página `/manual` (`src/lib/manual-render.ts`) y el Chrome/Chromium instalado para imprimir a PDF.

```bash
npm run manual:pdf
```

El script (`scripts/manual/build.ts`) toma `content/manual/manual-usuario.md` y el logo de `public/Logo Cuido.png`, arma portada, índice y capítulos (A4, con número de página) y escribe `content/manual/Manual-del-Usuario-Cuido.pdf`. Si Chrome está en una ruta poco común: `CHROME_PATH="/ruta/a/chrome" npm run manual:pdf`. Requiere Chrome/Chromium 131 o posterior.

Revise el PDF antes de commitearlo (portada, índice, tablas y cuadros destacados) y suba el `.md` y el `.pdf` en el mismo commit.
