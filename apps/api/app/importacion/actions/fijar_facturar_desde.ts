import { DomainAction, type Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { facturarDesdeDe } from '#billing/asignacion_plantilla'
import { primerPeriodoTrasAsignacion } from '#billing/periodos'

export interface EntradaFijarFacturarDesde {
    servicio_id: number
}

export interface ResultadoFijarFacturarDesde {
    servicio_id: number
    /** primer periodo que `generarFacturas` puede emitir; null: el servicio no tiene plantilla */
    facturar_desde: string | null
    /** el criterio de la asignación con la fecha de hoy (`primerPeriodoTrasAsignacion`) */
    tras_importacion: string | null
    /** último periodo que el servicio ya tiene facturado (las facturas importadas de periodo) */
    ultimo_periodo_facturado: string | null
}

/**
 * `importacion.fijar_facturar_desde` (solo sistema, la llama el importador para cada servicio que
 * crea con plantilla): deja en `billing.servicios_facturar_desde` el primer periodo que ArgosIsp
 * factura a un servicio importado, para que `generarFacturas` no emita periodos atrasados (los que
 * el origen ya cobró) ni repita los que entraron como facturas pendientes importadas.
 *
 * - Mismo criterio que `plantillas.asignar_sin_plantilla` de A3: `primerPeriodoTrasAsignacion`
 *   (`#billing/periodos`) con la configuración del servicio (plantilla + excepciones,
 *   `configuracionDeServicio`) y su primer día facturable (`leerServicio`): el siguiente inicio de
 *   ciclo después de hoy, o el primer día facturable si todavía no llegó.
 * - Si el servicio ya tiene facturas de periodo (las importadas: `clave_unica = servicio_id-periodo`)
 *   y la última es de ese ciclo o de uno posterior, queda el ciclo siguiente a esa
 *   (`primerPeriodoTrasAsignacion` con la fecha del último periodo): no se duplica.
 * - Nunca mueve la fecha hacia atrás (`greatest`, como la asignación de A3). Sin plantilla no hace
 *   nada. Diff `facturar_desde` en `audit.cambios` (`entidad_tipo = servicio`). Sin evento: el
 *   catálogo no tiene uno para esto y no cambia nada en la red ni el estado.
 */
export default class FijarFacturarDesde extends DomainAction<
    EntradaFijarFacturarDesde,
    ResultadoFijarFacturarDesde
> {
    readonly nombre = 'importacion.fijar_facturar_desde'

    protected async handle(
        input: EntradaFijarFacturarDesde,
        t: Transaccion,
    ): Promise<ResultadoFijarFacturarDesde> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await leerServicio(t.trx, input.servicio_id)
        t.fijarEmpresa(servicio.empresa_id)
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config || !servicio.plantilla_id) {
            return {
                servicio_id: servicio.id,
                facturar_desde: null,
                tras_importacion: null,
                ultimo_periodo_facturado: null,
            }
        }

        const trasImportacion = primerPeriodoTrasAsignacion(config, servicio.inicio, hoyGuatemala())
        const ultimo = (await t.trx
            .from('billing.facturas')
            .where('servicio_id', servicio.id)
            .whereRaw(`clave_unica = servicio_id::text || '-' || to_char(periodo, 'YYYY-MM-DD')`)
            .select(t.trx.raw(`to_char(max(periodo), 'YYYY-MM-DD') as periodo`))
            .first()) as { periodo: string | null } | null
        const ultimoPeriodo = ultimo?.periodo ?? null
        const trasUltimo = ultimoPeriodo
            ? primerPeriodoTrasAsignacion(config, servicio.inicio, ultimoPeriodo)
            : null
        const calculado = trasUltimo && trasUltimo > trasImportacion ? trasUltimo : trasImportacion

        const anterior = await facturarDesdeDe(t.trx, servicio.id)
        const guardado = await t.trx.rawQuery(
            `INSERT INTO billing.servicios_facturar_desde (servicio_id, facturar_desde, plantilla_id, origen)
             VALUES (?, ?, ?, 'importacion')
             ON CONFLICT (servicio_id) DO UPDATE
                SET facturar_desde = greatest(billing.servicios_facturar_desde.facturar_desde, EXCLUDED.facturar_desde),
                    updated_at = now()
             RETURNING to_char(facturar_desde, 'YYYY-MM-DD') AS facturar_desde`,
            [servicio.id, calculado, servicio.plantilla_id],
        )
        const facturarDesde = (guardado.rows[0] as { facturar_desde: string }).facturar_desde
        await t.registrarCambios(
            { tipo: 'servicio', id: servicio.id },
            { facturar_desde: anterior },
            { facturar_desde: facturarDesde },
        )
        return {
            servicio_id: servicio.id,
            facturar_desde: facturarDesde,
            tras_importacion: trasImportacion,
            ultimo_periodo_facturado: ultimoPeriodo,
        }
    }
}
