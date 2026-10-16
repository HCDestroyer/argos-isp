const PAGADO_POR = ' · pagado por '

/**
 * En el estado de cuenta del dueño de una factura pagada por otro cliente (pago de terceros, A3),
 * la descripción del movimiento termina en "· pagado por <nombre del pagador>". Se separa para
 * mostrar el pagador aparte; si la API no lo trae, `pagadoPor` es `null`.
 */
export function separarPagadoPor(descripcion: string): { concepto: string, pagadoPor: string | null } {
    const indice = descripcion.lastIndexOf(PAGADO_POR)
    if (indice < 0) {
        return { concepto: descripcion, pagadoPor: null }
    }
    const pagadoPor = descripcion.slice(indice + PAGADO_POR.length).trim()
    return pagadoPor ? { concepto: descripcion.slice(0, indice), pagadoPor } : { concepto: descripcion, pagadoPor: null }
}
