/**
 * Qué asientos se revierten directo (`POST /libro/asientos/:id/revertir`) y cuáles solo por la
 * anulación de su documento.
 *
 * Un asiento que nace de un documento de facturación (factura, mora, pago, nota de crédito, saldo
 * inicial) o de un egreso tiene, además del libro, una fila de negocio (saldo de la factura,
 * aplicaciones del pago, anulación del egreso…). Revertir solo el asiento dejaría el libro y el
 * documento en desacuerdo, así que esos se corrigen con la acción del documento, que revierte el
 * asiento por dentro (`RevertirAsiento` con `por_anulacion: true`).
 *
 * Directo se revierten los asientos sin documento: cierres de caja (contado mal digitado) y
 * ajustes manuales (`ajuste` sin `origen_id`).
 */

export interface BloqueoReverso {
    /** código del problema (422) */
    codigo: 'reverso_por_documento'
    /** acción que corrige el documento */
    accion: string
    mensaje: string
}

const POR_DOCUMENTO: Record<string, { accion: string; documento: string }> = {
    factura: { accion: 'facturas.anular', documento: 'la factura (POST /facturas/:id/anular)' },
    mora: { accion: 'facturas.anular', documento: 'la factura de mora (POST /facturas/:id/anular)' },
    pago: { accion: 'pagos.anular', documento: 'el pago (POST /pagos/:id/anular)' },
    nota_credito: {
        accion: 'facturas.nota_credito',
        documento: 'la nota de crédito (emitiendo un cargo o anulando la factura)',
    },
    egreso: { accion: 'egresos.anular', documento: 'el egreso (POST /egresos/:id/anular)' },
    reclasificacion: {
        accion: 'facturas.anular',
        documento: 'la factura certificada (POST /facturas/:id/anular: anula su DTE)',
    },
    // fase 4 (§10.3, §10.9): el documento (liquidación, depósito, traslado, línea del extracto, provisión,
    // castigo) es de solo inserción y el libro lo refleja; revertir solo el asiento los desacuerda
    liquidacion_cobro: {
        accion: 'cobros.liquidar',
        documento: 'la liquidación con un asiento de ajuste que la explique (las liquidaciones no se anulan)',
    },
    deposito: { accion: 'cajas.depositar', documento: 'el depósito con un asiento de ajuste (no se anula)' },
    traslado: { accion: 'bancos.trasladar', documento: 'el traslado con otro traslado en sentido contrario' },
    banco: {
        accion: 'bancos.conciliar',
        documento: 'la conciliación (POST /bancos/conciliaciones/:id/anular) y registra la línea otra vez',
    },
    provision: { accion: 'cartera.provisionar', documento: 'la estimación con un asiento de ajuste' },
    castigo: { accion: 'cartera.castigar', documento: 'el castigo con un asiento de ajuste' },
    // H23: la entrega de un premio de sorteo (en especie e ISR) se deshace junto con el ganador
    sorteo: {
        accion: 'sorteos.anular_entrega',
        documento: 'la entrega del premio (POST /lealtad/sorteos/:id/ganadores/:ganadorId/anular-entrega)',
    },
}

/** null si el asiento se puede revertir directo; si no, qué acción usar. */
export function bloqueoReversoDirecto(
    asientoId: number,
    origenTipo: string,
    origenId: number | null,
): BloqueoReverso | null {
    const documento = POR_DOCUMENTO[origenTipo]
    if (documento) {
        return {
            codigo: 'reverso_por_documento',
            accion: documento.accion,
            mensaje:
                `El asiento ${asientoId} es de origen ${origenTipo} ${origenId ?? ''}`.trimEnd() +
                `: no se revierte directo; anula ${documento.documento}`,
        }
    }
    // `ajuste` con origen = saldo inicial importado (y la aplicación de su saldo a favor)
    if (origenTipo === 'ajuste' && origenId !== null) {
        return {
            codigo: 'reverso_por_documento',
            accion: 'facturas.anular_saldo_inicial',
            mensaje: `El asiento ${asientoId} es del saldo inicial ${origenId}: no se revierte directo; anula el saldo inicial`,
        }
    }
    return null
}
