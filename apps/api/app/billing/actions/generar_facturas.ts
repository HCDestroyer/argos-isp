import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { configuracionDeServicio } from '#billing/configuracion'
import { claveFactura, periodosHasta } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { empresasDelProceso } from '#billing/empresa'
import { BloqueosDeCorrida, type BloqueoCorrida } from '#billing/bloqueos_corrida'

/**
 * `facturas.generar` (cron y `POST /facturas/generar`): emite **todo lo pendiente hasta `hasta`**
 * (por defecto hoy en Guatemala), nunca "lo de hoy".
 *
 * Recorre por lotes de 500 (keyset por id) los servicios `activo`/`limitado`/`suspendido` con
 * plantilla, calcula sus periodos desde la instalación y llama `EmitirFactura` (una transacción
 * auditada por factura) para cada periodo ya iniciado que no tenga factura con su `clave_unica`.
 * Correrla dos veces no duplica nada. Un servicio que falla no detiene la corrida: se cuenta en
 * `errores` y se registra en el log.
 *
 * Bloqueos del libro (fase 6): un servicio cuya factura cae bajo un bloqueo (422/409) no se
 * factura; se cuenta en `bloqueados` (no en `errores`), la corrida lo detalla en `bloqueos` y
 * avisa con `libro.proceso_bloqueado`. Sigue pendiente: la siguiente corrida lo vuelve a intentar.
 *
 * Multiempresa: pedido por un usuario (`POST /facturas/generar`) recorre solo su empresa activa o,
 * sin ella, las de su alcance (`empresasDelProceso`); el cron (sistema) recorre todas.
 */

export const TAMANO_LOTE = 500

export interface EntradaGenerarFacturas {
    hasta?: string
    servicio_id?: number
}

export interface ResultadoGeneracion {
    generadas: number
    /** periodos que ya tenían factura */
    omitidas: number
    facturas: number[]
    /**
     * decisión del PM (19 oct): periodos que quedaron en cero (mes gratis, descuento del 100 %) se
     * registran como bonificación, nunca como factura de Q0
     */
    bonificadas: number
    bonificaciones: number[]
    errores: number
    /** servicios que no se facturaron por un bloqueo del libro (se reintentan) */
    bloqueados: number
    bloqueos: BloqueoCorrida[]
}

interface FilaCandidato {
    id: number
    plantilla_facturacion_id: number
    fecha_instalacion: string | null
    alta: string
}

export default class GenerarFacturas {
    readonly nombre = 'facturas.generar'

    async execute(input: EntradaGenerarFacturas, ctx: ContextoAccion): Promise<ResultadoGeneracion> {
        const hasta = input.hasta ? fechaValida(input.hasta, 'hasta') : hoyGuatemala()
        const resultado: ResultadoGeneracion = {
            generadas: 0,
            omitidas: 0,
            facturas: [],
            bonificadas: 0,
            bonificaciones: [],
            errores: 0,
            bloqueados: 0,
            bloqueos: [],
        }
        const bloqueos = new BloqueosDeCorrida()

        const empresas = empresasDelProceso(ctx)
        let cursor = 0
        for (;;) {
            const lote = (await db
                .from('core.servicios')
                .whereIn('estado', ['activo', 'limitado', 'suspendido'])
                .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
                .whereNotNull('plantilla_facturacion_id')
                .where('id', '>', cursor)
                .if(input.servicio_id, (q) => q.where('id', input.servicio_id!))
                .orderBy('id', 'asc')
                .limit(TAMANO_LOTE)
                .select(
                    'id',
                    'plantilla_facturacion_id',
                    db.raw(`to_char(fecha_instalacion, 'YYYY-MM-DD') as fecha_instalacion`),
                    db.raw(`to_char(created_at AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') as alta`),
                )) as FilaCandidato[]
            if (lote.length === 0) break
            cursor = lote.at(-1)!.id

            const existentes = await clavesExistentes(lote.map((s) => s.id))
            for (const servicio of lote) {
                try {
                    await this.generarServicio(servicio, hasta, existentes, resultado, ctx)
                } catch (error) {
                    if (bloqueos.registrarError(error, servicio.id)) {
                        logger.warn(
                            { err: error, servicioId: servicio.id, requestId: ctx.requestId },
                            'Factura bajo un bloqueo del libro: queda pendiente',
                        )
                        continue
                    }
                    resultado.errores += 1
                    logger.error(
                        { err: error, servicioId: servicio.id, requestId: ctx.requestId },
                        'No se pudo facturar el servicio',
                    )
                }
            }
            if (lote.length < TAMANO_LOTE) break
        }

        resultado.bloqueados = bloqueos.total
        resultado.bloqueos = bloqueos.lista()
        await new RegistrarCorrida(this.nombre).execute(
            {
                parametros: { hasta, servicio_id: input.servicio_id ?? null, empresas },
                resultado: { ...resultado },
                bloqueos: resultado.bloqueos,
            },
            ctx,
        )
        return resultado
    }

    private async generarServicio(
        servicio: FilaCandidato,
        hasta: string,
        existentes: Set<string>,
        resultado: ResultadoGeneracion,
        ctx: ContextoAccion,
    ) {
        const config = await configuracionDeServicio(db.connection(), {
            id: servicio.id,
            plantilla_id: servicio.plantilla_facturacion_id,
        })
        if (!config) return
        const periodos = periodosHasta(config, servicio.fecha_instalacion ?? servicio.alta, hasta)
        for (const periodo of periodos) {
            if (existentes.has(claveFactura(servicio.id, periodo.periodo))) {
                resultado.omitidas += 1
                continue
            }
            const emitida = await new EmitirFactura().execute({ servicio_id: servicio.id, periodo }, ctx)
            if (emitida.creada && emitida.factura_id) {
                resultado.generadas += 1
                resultado.facturas.push(emitida.factura_id)
            } else if (emitida.creada && emitida.bonificacion_id) {
                resultado.bonificadas += 1
                resultado.bonificaciones.push(emitida.bonificacion_id)
            } else if (emitida.motivo === 'ya_existe') {
                resultado.omitidas += 1
            }
        }
    }
}

/** Claves ya ocupadas: las facturas del periodo y las bonificaciones (el periodo bonificado no se factura). */
async function clavesExistentes(servicios: number[]): Promise<Set<string>> {
    const filas = (await db
        .from('billing.facturas')
        .whereIn('servicio_id', servicios)
        .where('tipo', 'servicio')
        .select('clave_unica')
        .union((q) =>
            q.from('billing.bonificaciones').whereIn('servicio_id', servicios).select('clave_unica'),
        )) as Array<{ clave_unica: string }>
    return new Set(filas.map((f) => f.clave_unica))
}
