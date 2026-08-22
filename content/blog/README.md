# Avances en Salud — cómo publicar

Esta carpeta es el contenido de `/blog` ("Avances en Salud"). No hay CMS:
cada post es un archivo Markdown en `content/blog/`, con frontmatter al
inicio. `src/lib/blog.ts` lee todos los `.md` de esta carpeta (excepto
este README) en build/request time.

Este archivo (`README.md`) se excluye a propósito del listado — no es un
post, es la documentación del mecanismo.

## Formato de un post

Nombre de archivo = slug de la URL. `mi-primer-post.md` → `/blog/mi-primer-post`.

```markdown
---
title: "Título del post"
date: "2026-08-22"
excerpt: "Resumen de una o dos líneas para el listado."
---

Cuerpo del post en Markdown normal.
```

## Por qué no hay posts todavía

La ruta `/blog` está construida y funciona, pero deliberadamente no tiene
ningún post real todavía — y no está enlazada desde la navegación de la
landing (ver `src/app/_landing/header.tsx` y `footer.tsx`) hasta que haya
contenido real que publicar. Esto es intencional, no un olvido: se agregó
la infraestructura sin fabricar contenido de relleno para no violar la
regla de "cero contenido aspiracional" de la landing.
