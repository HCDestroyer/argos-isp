import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import CertificarDte from '#fiscal/actions/certificar_dte'
import AnularDte from '#fiscal/actions/anular_dte'
import { ERROR_AVISO_SIN_CUBRIR } from '#fiscal/fel/dte'

/**
 * Cola `fel` (contrato §8.3): lo que el worker `fiscal:worker` procesa cada minuto, "todo lo
 * pendiente hasta ahora" (regla 6):
 *
 * 1. Avisos de cobro ya cubiertos sin DTE (y moras con IVA cuya factura ya está certificada) →
 *    `fel.certificar` automático. `pago.registrado` hace lo mismo al momento (`ConsumidorFel`).
 * 2. DTE `pendiente` o `error_temporal` vencidos, y `contingencia` de empresas que ya salieron de
 *    ella → `fel.certificar_dte`.
 * 3. DTE `anulacion_pendiente` vencidos → `fel.anular_dte`.
 *
 * Cada documento va en su propia transacción; un error en uno no detiene la corrida. Las lecturas
 * de aquí solo eligen candidatos: toda decisión está en las acciones.
 */

export async function avisosPorCertificar(limite = 500, facturas?: number[]): Promise<number[]> {
    const filas = (await db
        .from('billing.facturas as f')
        .join('fiscal.fel_configuracion as c', 'c.empresa_id', 'f.empresa_id')
        .whereNot('c.modo', 'desactivada')
        .where('f.aviso_cobro', true)
        .where('f.estado', 'pagada')
        .if(facturas !== undefined, (q) => q.whereIn('f.id', facturas!))
        // castigo de cartera (§10.9): cubierta por el castigo, no por un cobro; no genera DTE
        .whereNotExists((q) => q.from('ledger.castigos_facturas as cf').whereRaw('cf.factura_id = f.id'))
        .whereNotExists((q) =>
            q
                .from('fiscal.dte as d')
                .whereRaw(`d.documento_id = f.id`)
                .whereRaw(
                    `d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END`,
                )
                .where((w) =>
                    w.whereNot('d.estado', 'rechazado').orWhereNot('d.ultimo_error', ERROR_AVISO_SIN_CUBRIR),
                ),
        )
        .where((q) =>
            q.where('f.tipo', 'servicio').orWhere((m) =>
                m
                    .where('f.tipo', 'mora')
                    .where('f.iva', '>', 0)
                    .whereExists((e) =>
                        e
                            .from('fiscal.dte as o')
                            .whereRaw('o.documento_id = f.factura_origen_id')
                            .where('o.documento_tipo', 'factura')
                            .where('o.estado', 'certificado'),
                    ),
            ),
        )
        .orderBy('f.id')
        .limit(limite)
        .select('f.id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

export async function dtePorProcesar(limite = 500): Promise<Array<{ id: number; anular: boolean }>> {
    const filas = (await db
        .from('fiscal.dte as d')
        .leftJoin('fiscal.fel_configuracion as c', 'c.empresa_id', 'd.empresa_id')
        .where((q) =>
            q
                .where((p) =>
                    p
                        .whereIn('d.estado', ['pendiente', 'error_temporal', 'anulacion_pendiente'])
                        .whereNotNull('d.proximo_intento')
                        .where('d.proximo_intento', '<=', db.raw('now()')),
                )
                .orWhere((p) => p.where('d.estado', 'contingencia').where('c.contingencia_activa', false)),
        )
        .orderBy('d.id')
        .limit(limite)
        .select('d.id', 'd.estado')) as Array<{ id: number; estado: string }>
    return filas.map((f) => ({ id: Number(f.id), anular: f.estado === 'anulacion_pendiente' }))
}

export interface CorridaFel {
    solicitados: number
    enviados: number
    anulados: number
    errores: number
}

/** Una corrida de la cola (la usan el worker y las pruebas). */
export async function procesarColaFel(ctx: ContextoAccion): Promise<CorridaFel> {
    const corrida: CorridaFel = { solicitados: 0, enviados: 0, anulados: 0, errores: 0 }
    for (const facturaId of await avisosPorCertificar()) {
        try {
            const r = await new SolicitarCertificacion().execute(
                { factura_id: facturaId, automatico: true },
                ctx,
            )
            if (r.creado) corrida.solicitados += 1
        } catch (error) {
            corrida.errores += 1
            logger.error({ err: error, factura_id: facturaId }, 'fel: no se pudo pedir la certificación')
        }
    }
    for (const dte of await dtePorProcesar()) {
        try {
            if (dte.anular) {
                const r = await new AnularDte().execute({ dte_id: dte.id }, ctx)
                if (!r.omitido) corrida.anulados += 1
            } else {
                const r = await new CertificarDte().execute({ dte_id: dte.id }, ctx)
                if (!r.omitido) corrida.enviados += 1
            }
        } catch (error) {
            corrida.errores += 1
            logger.error({ err: error, dte_id: dte.id }, 'fel: falló el envío del DTE')
        }
    }
    return corrida
}
