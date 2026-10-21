import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { morasDebidas, reglaMora, type ReglaMora } from '#billing/mora'
import VencerFactura from '#billing/actions/vencer_factura'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { TAMANO_LOTE } from '#billing/actions/generar_facturas'
import { BloqueosDeCorrida, type BloqueoCorrida } from '#billing/bloqueos_corrida'

/**
 * `facturas.vencer_pendientes` (cron y `POST /facturas/vencer`): todo lo pendiente hasta `hasta`
 * (hoy en Guatemala por defecto), por lotes de 500.
 *
 * 1. Facturas de servicio `emitida`/`parcial` con `vence_en < hoy` → `VencerFactura`.
 * 2. Facturas ya vencidas a las que les falta un recargo de mora (`mora_recurrente`: uno por
 *    mes vencido) → `VencerFactura` crea los que falten.
 *
 * No cambia estados de servicio: el cron de corte los evalúa a la hora de cada plantilla.
 *
 * Bloqueos del libro (fase 6): una mora cuyo asiento cae bajo un bloqueo no se crea (la factura
 * igual se vence); se cuenta en `bloqueados`, se detalla en `bloqueos` y la corrida avisa con
 * `libro.proceso_bloqueado`. La siguiente corrida la vuelve a intentar.
 */

export interface EntradaVencerFacturas {
    hasta?: string
    servicio_id?: number
}

export interface ResultadoVencimiento {
    vencidas: number
    moras: number
    errores: number
    /** facturas con mora pendiente por un bloqueo del libro (se reintentan) */
    bloqueados: number
    bloqueos: BloqueoCorrida[]
}

interface Candidata {
    id: number
    vence_en: string
    reglas_snapshot: Partial<ReglaMora> | null
    moras: number
}

export default class VencerFacturas {
    readonly nombre = 'facturas.vencer_pendientes'

    async execute(input: EntradaVencerFacturas, ctx: ContextoAccion): Promise<ResultadoVencimiento> {
        const hoy = input.hasta ? fechaValida(input.hasta, 'hasta') : hoyGuatemala()
        const resultado: ResultadoVencimiento = {
            vencidas: 0,
            moras: 0,
            errores: 0,
            bloqueados: 0,
            bloqueos: [],
        }
        const bloqueos = new BloqueosDeCorrida()

        // 1. por vencer
        await this.recorrer(
            (q) => q.whereIn('f.estado', ['emitida', 'parcial']).where('f.vence_en', '<', hoy),
            input,
            async (factura) => this.vencer(factura.id, hoy, resultado, bloqueos, ctx),
        )
        // 2. vencidas con recargos de mora pendientes
        await this.recorrer(
            (q) =>
                q
                    .where('f.estado', 'vencida')
                    .whereRaw(`coalesce(f.reglas_snapshot->>'mora_tipo', 'ninguna') <> 'ninguna'`),
            input,
            async (factura) => {
                const debidas = morasDebidas(reglaMora(factura.reglas_snapshot), factura.vence_en, hoy)
                if (debidas > factura.moras) await this.vencer(factura.id, hoy, resultado, bloqueos, ctx)
            },
        )

        resultado.bloqueados = bloqueos.total
        resultado.bloqueos = bloqueos.lista()
        await new RegistrarCorrida(this.nombre).execute(
            {
                parametros: { hasta: hoy, servicio_id: input.servicio_id ?? null },
                resultado: { ...resultado },
                bloqueos: resultado.bloqueos,
            },
            ctx,
        )
        return resultado
    }

    private async vencer(
        facturaId: number,
        hoy: string,
        resultado: ResultadoVencimiento,
        bloqueos: BloqueosDeCorrida,
        ctx: ContextoAccion,
    ) {
        try {
            const r = await new VencerFactura().execute({ factura_id: facturaId, hoy }, ctx)
            if (r.vencida) resultado.vencidas += 1
            resultado.moras += r.moras.length
            if (r.mora_bloqueada) {
                bloqueos.registrar({ empresa_id: r.empresa_id, ...r.mora_bloqueada }, facturaId)
            }
        } catch (error) {
            if (bloqueos.registrarError(error, facturaId)) return
            resultado.errores += 1
            logger.error({ err: error, facturaId, requestId: ctx.requestId }, 'No se pudo vencer la factura')
        }
    }

    private async recorrer(
        filtro: (q: ReturnType<typeof consultaBase>) => unknown,
        input: EntradaVencerFacturas,
        procesar: (factura: Candidata) => Promise<void>,
    ) {
        let cursor = 0
        for (;;) {
            const consulta = consultaBase()
                .where('f.id', '>', cursor)
                .if(input.servicio_id, (q) => q.where('f.servicio_id', input.servicio_id!))
            filtro(consulta)
            const lote = (await consulta.orderBy('f.id', 'asc').limit(TAMANO_LOTE)) as Candidata[]
            for (const factura of lote) await procesar(factura)
            if (lote.length < TAMANO_LOTE) break
            cursor = lote.at(-1)!.id
        }
    }
}

function consultaBase() {
    return db
        .from('billing.facturas as f')
        .where('f.tipo', 'servicio')
        .select(
            'f.id',
            db.raw(`to_char(f.vence_en, 'YYYY-MM-DD') as vence_en`),
            'f.reglas_snapshot',
            db.raw(
                `(SELECT count(*) FROM billing.facturas m WHERE m.factura_origen_id = f.id AND m.tipo = 'mora')::int AS moras`,
            ),
        )
}
