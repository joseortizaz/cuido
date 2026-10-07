// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Filas pedidas por página. PostgREST devuelve a lo sumo `max_rows` (1000 por defecto). */
export const PAGE_SIZE = 1000;

/**
 * Lee TODAS las filas de una consulta, página por página.
 *
 * Por qué existe: PostgREST corta cada respuesta en `max_rows` filas (1000 por
 * defecto, supabase/config.toml) SIN dar error. Una exportación que no pagine
 * entrega un archivo silenciosamente truncado -- justo lo contrario de lo que
 * promete "exportar".
 *
 * Robusto ante cualquier `max_rows`: avanza por las filas que REALMENTE
 * devolvió el servidor (no por el tamaño pedido) y se detiene solo con una
 * página vacía, así que un `max_rows` menor que PAGE_SIZE tampoco trunca. Y
 * lanza ante un error en vez de devolver un archivo incompleto como si nada.
 *
 * La consulta DEBE tener un orden estable y único (p. ej. `.order("id")` al
 * final): sin él, las páginas pueden repetir u omitir filas.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`No se pudieron leer los datos para exportar (${error.message}).`);
    const rows = data ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    from += rows.length;
  }
  return all;
}
