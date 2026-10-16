import type { Problem } from '@argosisp/contracts'

/**
 * El mismo 403 que respondería la API, sin hacer la llamada: para pantallas que necesitan un
 * segundo permiso además del de la página (editar un cliente también lo lee con `clientes.ver`).
 * Se muestra con `<ProblemaAlerta>` en lugar de los datos.
 */
export function problemaSinPermiso(permiso: string): Problem {
    return {
        type: 'urn:argosisp:problema:sin_permiso',
        title: 'Sin permiso',
        status: 403,
        detail: `Tu usuario no tiene el permiso ${permiso}. Pídelo a un administrador.`,
    }
}
