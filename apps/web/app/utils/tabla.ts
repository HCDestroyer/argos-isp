/**
 * `meta` de columna de `UTable` para ocultarla en teléfono (< sm) y mostrarla desde tableta.
 * La celda principal de la fila repite el dato en pequeño con `sm:hidden`.
 *
 * ```ts
 * { accessorKey: 'nit_cui', header: 'NIT', meta: SOLO_ANCHO }
 * ```
 */
export const SOLO_ANCHO = {
    class: {
        th: 'hidden sm:table-cell',
        td: 'hidden sm:table-cell',
    },
}

/** Igual que `SOLO_ANCHO`, pero desde escritorio (lg). */
export const SOLO_ESCRITORIO = {
    class: {
        th: 'hidden lg:table-cell',
        td: 'hidden lg:table-cell',
    },
}
