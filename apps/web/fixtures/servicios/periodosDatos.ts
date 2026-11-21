/**
 * Inicio de la facturación de los servicios para la emisión manual de periodos (A3, 19 nov). Los
 * demás empiezan el mes de su instalación. El servicio 9 (cliente 8, importado de Mikrowisp) trae
 * historia desde julio, pero la importación fijó `facturar_desde` en septiembre: julio y agosto son
 * `antes_de_facturar_desde` (solo con `facturas.emitir_periodo_anterior` y motivo).
 */
export interface FacturacionServicioFixture {
    /** Primer periodo que existe para el servicio (1.º del mes). */
    inicio: string
    /** Primer periodo que factura el cron; null = desde el inicio. */
    facturar_desde: string | null
    /** Los días antes del primer periodo ya cobrados en la primera factura (el cargo único se ve por su clave). */
    tramo_en_primera_factura?: number | null
}

export const facturacionServicios: Record<number, FacturacionServicioFixture> = {
    9: { inicio: '2026-07-01', facturar_desde: '2026-09-01' },
}
