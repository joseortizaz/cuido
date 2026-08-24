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
cover: "/blog/mi-post.svg"
---

Cuerpo del post en Markdown normal.
```

`cover` es opcional — ruta pública a una imagen dentro de `public/blog/`.
Se usa como imagen de tarjeta en el listado `/blog` y como cabecera del
post individual. Si se omite, ambas vistas se ven igual de bien sin ella
(no es obligatorio agregar una imagen por post).
