/**
 * Pago en línea (semana 2): ida a la pasarela y retorno a `/corte?pago=<id>&estado=<pagado|fallido>`
 * (la API manda `url_retorno` a la pasarela con `PORTAL_URL_PUBLICA`).
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

/** Lo que dijo el proveedor al devolver al cliente (`?estado=`). Solo `pagado` y `fallido` cuentan. */
export type EstadoRetornoPago = 'pagado' | 'fallido'

/**
 * `?estado=pagado|fallido` del retorno de la pasarela; cualquier otra cosa (incluido `pendiente`)
 * → null. Es solo para mostrarlo al volver: el pago lo confirma el webhook, que se lee con
 * `GET /portal/pagos/en-linea/:id` (si dicen distinto, gana la API).
 */
export function estadoRetornoDeLaRuta(valor: unknown): EstadoRetornoPago | null {
    const texto = Array.isArray(valor) ? valor[0] : valor
    return texto === 'pagado' || texto === 'fallido' ? texto : null
}

/**
 * Antes de salir a la pasarela, la URL actual pasa a ser la de retorno: el proveedor devuelve al
 * cliente a `/corte?pago=<id>&estado=…` (`url_retorno`), y si no lo hace (sin `PORTAL_URL_PUBLICA`
 * o el cliente usa "Atrás"), el navegador vuelve igual a `/corte?pago=<id>`, donde el estado en
 * vivo espera la confirmación.
 */
export function salirALaPasarela(cobro: { id: number, url_pago: string }): void {
    window.history.replaceState(window.history.state, '', rutaRetornoPago(cobro.id))
    window.location.assign(cobro.url_pago)
}
