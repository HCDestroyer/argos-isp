/**
 * Pago en línea (semana 2): ida a la pasarela y retorno a `/corte?pago=<id>`.
 * Contrato: `.claude/integration/contratos/pago-en-linea.md`.
 */

/** Ruta de retorno del pago en línea. */
export function rutaRetornoPago(id: number): string {
    return `/corte?pago=${id}`
}

/** `?pago=42` → 42; cualquier otra cosa → null. */
export function idPagoDeLaRuta(valor: unknown): number | null {
    const texto = Array.isArray(valor) ? valor[0] : valor
    if (typeof texto !== 'string' || !/^\d{1,15}$/.test(texto)) {
        return null
    }
    const id = Number(texto)
    return id > 0 ? id : null
}

/**
 * Antes de salir a la pasarela, la URL actual pasa a ser la de retorno: así el "Atrás" del
 * navegador (o el cierre de la página del proveedor) vuelve a `/corte?pago=<id>`, donde el estado
 * en vivo espera la confirmación. Mientras el proveedor no reciba la URL de retorno (pedido a A3),
 * es el único camino de vuelta.
 */
export function salirALaPasarela(cobro: { id: number, url_pago: string }): void {
    window.history.replaceState(window.history.state, '', rutaRetornoPago(cobro.id))
    window.location.assign(cobro.url_pago)
}
