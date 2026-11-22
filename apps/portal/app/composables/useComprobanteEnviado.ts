/**
 * El último comprobante enviado desde `/comprobante`, para que `/corte` muestre «Recibimos tu
 * comprobante» y vigile el estado al volver. Se consume una vez (`/corte` lo vacía al leerlo).
 */
export function useComprobanteEnviado() {
    return useState<ComprobantePortal | null>('portal:comprobante-enviado', () => null)
}
