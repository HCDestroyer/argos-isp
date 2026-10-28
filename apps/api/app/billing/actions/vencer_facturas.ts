import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { morasDebidas, reglaMora, type ReglaMora } from '#billing/mora'
import { venceEfectivoSql } from '#billing/vencimiento'
import VencerFactura from '#billing/actions/vencer_factura'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { TAMANO_LOTE } from '#billing/actions/generar_facturas'
import { empresasDelProceso } from '#billing/empresa'
import { BloqueosDeCorrida, ContadoresPorEmpresa, type BloqueoCorrida } from '#billing/bloqueos_corrida'

/**
 * `facturas.vencer_pendientes` (cron y `POST /facturas/vencer`): todo lo pendiente hasta `hasta`
 * (hoy en Guatemala por defecto), por lotes de 500.
 *
 * 1. Facturas de servicio `emitida`/`parcial` con vencimiento efectivo < hoy → `VencerFactura`.
 *    Vencimiento efectivo (`venceEfectivoSql`): `vence_en`, salvo una factura emitida con el servicio
 *    pendiente de instalación, que vence en `max(vence_en, día de instalado_en + dias_gracia)`.
 * 2. Facturas ya vencidas a las que les falta un recargo de mora (`mora_recurrente`: uno por
 *    mes vencido) → `VencerFactura` crea los que falten.
 *
 * Las facturas de un servicio `pendiente_instalacion` (sus cargos únicos anticipados) no se tocan:
 * ni vencen, ni mora, ni `factura.vencida` mientras no se active (`contratos/instalacion.md` §3).
 *
 * No cambia estados de servicio: el cron de corte los evalúa a la hora de cada plantilla.
 *
 * Bloqueos del libro (fase 6): una mora cuyo asiento cae bajo un bloqueo no se crea (la factura
 * igual se vence); se cuenta en `bloqueados`, se detalla en `bloqueos` y la corrida avisa con
 * `libro.proceso_bloqueado`. La siguiente corrida la vuelve a intentar.
 *
 * Multiempresa: pedido por un usuario (`POST /facturas/vencer`) recorre solo su empresa activa o,
 * sin ella, las de su alcance (`empresasDelProceso`); el cron (sistema) recorre todas.
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
    empresa_id: number
    /** `venceEfectivoSql`: el `vence_en` o, si se emitió con el servicio pendiente, el de la instalación */
    vence_efectivo: string
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
        const porEmpresa = new ContadoresPorEmpresa(['vencidas', 'moras', 'errores'] as const)
        const empresas = empresasDelProceso(ctx)

        // 1. por vencer
        await this.recorrer(
            (q) =>
                q.whereIn('f.estado', ['emitida', 'parcial']).whereRaw(`${venceEfectivoSql('f')} < ?`, [hoy]),
            { ...input, empresas },
            async (factura) => this.vencer(factura, hoy, resultado, bloqueos, porEmpresa, ctx),
        )
        // 2. vencidas con recargos de mora pendientes
        await this.recorrer(
            (q) =>
                q
                    .where('f.estado', 'vencida')
                    .whereRaw(`coalesce(f.reglas_snapshot->>'mora_tipo', 'ninguna') <> 'ninguna'`),
            { ...input, empresas },
            async (factura) => {
                const debidas = morasDebidas(reglaMora(factura.reglas_snapshot), factura.vence_efectivo, hoy)
                if (debidas > factura.moras) {
                    await this.vencer(factura, hoy, resultado, bloqueos, porEmpresa, ctx)
                }
            },
        )

        resultado.bloqueados = bloqueos.total
        resultado.bloqueos = bloqueos.lista()
        await new RegistrarCorrida(this.nombre).execute(
            {
                parametros: { hasta: hoy, servicio_id: input.servicio_id ?? null, empresas },
                resultado: { ...resultado, por_empresa: porEmpresa.json(resultado.bloqueos) },
                bloqueos: resultado.bloqueos,
            },
            ctx,
        )
        return resultado
    }

    private async vencer(
        factura: Candidata,
        hoy: string,
        resultado: ResultadoVencimiento,
        bloqueos: BloqueosDeCorrida,
        porEmpresa: ContadoresPorEmpresa<'vencidas' | 'moras' | 'errores'>,
        ctx: ContextoAccion,
    ) {
        const facturaId = factura.id
        const empresaId = Number(factura.empresa_id)
        try {
            const r = await new VencerFactura().execute({ factura_id: facturaId, hoy }, ctx)
            if (r.vencida) {
                resultado.vencidas += 1
                porEmpresa.sumar(empresaId, 'vencidas')
            }
            resultado.moras += r.moras.length
            porEmpresa.sumar(empresaId, 'moras', r.moras.length)
            if (r.mora_bloqueada) {
                bloqueos.registrar({ empresa_id: r.empresa_id, ...r.mora_bloqueada }, facturaId)
            }
        } catch (error) {
            if (bloqueos.registrarError(error, facturaId)) return
            resultado.errores += 1
            porEmpresa.sumar(empresaId, 'errores')
            logger.error({ err: error, facturaId, requestId: ctx.requestId }, 'No se pudo vencer la factura')
        }
    }

    private async recorrer(
        filtro: (q: ReturnType<typeof consultaBase>) => unknown,
        input: EntradaVencerFacturas & { empresas: number[] | null },
        procesar: (factura: Candidata) => Promise<void>,
    ) {
        let cursor = 0
        for (;;) {
            const consulta = consultaBase()
                .where('f.id', '>', cursor)
                .if(input.servicio_id, (q) => q.where('f.servicio_id', input.servicio_id!))
                .if(input.empresas !== null, (q) => q.whereIn('f.empresa_id', input.empresas!))
            filtro(consulta)
            const lote = (await consulta.orderBy('f.id', 'asc').limit(TAMANO_LOTE)) as Candidata[]
            for (const factura of lote) await procesar(factura)
            if (lote.length < TAMANO_LOTE) break
            cursor = lote.at(-1)!.id
        }
    }
}

function consultaBase() {
    return (
        db
            .from('billing.facturas as f')
            .where('f.tipo', 'servicio')
            // un pendiente de instalación no vence ni recibe mora (`contratos/instalacion.md` §3): su cargo
            // único anticipado espera a la activación y la siguiente corrida lo vence si ya pasó la fecha
            .whereNotExists((q) =>
                q
                    .from('core.servicios as s')
                    .whereRaw('s.id = f.servicio_id')
                    .where('s.estado', 'pendiente_instalacion'),
            )
            .select(
                'f.id',
                'f.empresa_id',
                db.raw(`to_char(${venceEfectivoSql('f')}, 'YYYY-MM-DD') as vence_efectivo`),
                'f.reglas_snapshot',
                db.raw(
                    `(SELECT count(*) FROM billing.facturas m WHERE m.factura_origen_id = f.id AND m.tipo = 'mora')::int AS moras`,
                ),
            )
    )
}
