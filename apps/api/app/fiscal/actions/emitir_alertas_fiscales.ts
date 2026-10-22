import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida } from '#ledger/fechas'
import { aTexto, dec, redondear } from '#ledger/dinero'
import { hoyFiscal } from '#fiscal/comun'
import { datosFiscales, resolver } from '#fiscal/parametros'
import { libroVentasLegal } from '#fiscal/libros_legales'
import {
    COLUMNAS_OBLIGACION,
    ESTADOS_ABIERTOS,
    LOCK_CALENDARIO,
    UMBRALES_VENCIMIENTO,
    diasEntre,
    normalizarObligacion,
    umbralVencimiento,
} from '#fiscal/calendario'

/**
 * `fiscal.emitir_alertas` (sistema; cron `fiscal:calendario` después de generar el calendario):
 * alertas de vencimiento y del límite del pequeño contribuyente (contrato §11.3 y §21 PR A). Procesa
 * todo lo pendiente hasta hoy; cada alerta es una fila de `fiscal.alertas` (clave única) y su
 * evento por outbox en la misma transacción: repetir la corrida no repite nada.
 *
 * - `fiscal.vencimiento_proximo`: obligaciones `pendiente` o `borrador` que vencen entre hoy y
 *   dentro de 7 días. Se emite el umbral más cercano alcanzado (7, 3, 1 o 0), una vez por
 *   obligación y umbral; si el cron estuvo detenido no se emiten los umbrales ya pasados. Una
 *   obligación vencida no genera alerta (el tablero la muestra en rojo).
 * - `fiscal.limite_pc`: empresas en `pequeno_contribuyente` hoy. Acumulado = total del libro de
 *   ventas del 1 de enero a hoy (FPEQ certificadas y documentos sin FEL; los avisos sin DTE no son
 *   venta). Se emite el umbral más alto de `pc_alertas` alcanzado, una vez por umbral y año. Sin
 *   `pc_limite_anual` del año no se calcula (queda en `errores`).
 */

export interface EntradaEmitirAlertas {
    empresa_id?: number | null
    hoy?: string
}

export interface ResultadoAlertas {
    hoy: string
    vencimientos: number
    limite_pc: number
    errores: Array<{ empresa_id: number; codigo: string; detalle: string }>
}

export default class EmitirAlertasFiscales extends DomainAction<EntradaEmitirAlertas, ResultadoAlertas> {
    readonly nombre = 'fiscal.emitir_alertas'

    protected async handle(input: EntradaEmitirAlertas, t: Transaccion): Promise<ResultadoAlertas> {
        const hoy = input.hoy ? fechaValida(input.hoy, 'hoy') : hoyFiscal()
        if (input.empresa_id) {
            exigirAccesoEmpresa(t.ctx, input.empresa_id)
            t.fijarEmpresa(input.empresa_id)
        } else {
            t.fijarEmpresa(null)
        }
        const resultado: ResultadoAlertas = { hoy, vencimientos: 0, limite_pc: 0, errores: [] }
        await this.vencimientos(t, input.empresa_id ?? null, hoy, resultado)
        await this.limitePc(t, input.empresa_id ?? null, hoy, resultado)
        t.anotarAuditoria({
            vencimientos: resultado.vencimientos,
            limite_pc: resultado.limite_pc,
            errores: resultado.errores,
        })
        return resultado
    }

    private async vencimientos(t: Transaccion, empresaId: number | null, hoy: string, r: ResultadoAlertas) {
        const tope = Math.max(...UMBRALES_VENCIMIENTO)
        const filas = (
            (await t.trx
                .from('fiscal.obligaciones as o')
                .join('core.empresas as e', 'e.id', 'o.empresa_id')
                .where('e.activa', true)
                .whereIn('o.estado', ESTADOS_ABIERTOS as string[])
                .whereRaw('o.vence_en BETWEEN ?::date AND ?::date + ?::integer', [hoy, hoy, tope])
                .if(empresaId !== null, (q) => q.where('o.empresa_id', empresaId!))
                .orderBy([
                    { column: 'o.vence_en', order: 'asc' },
                    { column: 'o.id', order: 'asc' },
                ])
                .select(COLUMNAS_OBLIGACION)) as Array<Record<string, unknown>>
        ).map(normalizarObligacion)

        for (const o of filas) {
            const dias = diasEntre(hoy, o.vence_en)
            const umbral = umbralVencimiento(dias)
            if (umbral === null) continue
            const insertada = (await t.trx
                .knexQuery()
                .table('fiscal.alertas')
                .insert({
                    empresa_id: o.empresa_id,
                    tipo: 'vencimiento_proximo',
                    clave: `${o.id}:${umbral}`,
                    obligacion_id: o.id,
                    datos: JSON.stringify({ vence_en: o.vence_en, dias, umbral, hoy }),
                })
                .onConflict(['empresa_id', 'tipo', 'clave'])
                .ignore()
                .returning('id')) as Array<{ id: number }>
            if (insertada.length === 0) continue
            await t.emit('fiscal.vencimiento_proximo', {
                obligacion_id: o.id,
                empresa_id: o.empresa_id,
                impuesto: o.impuesto,
                periodo_desde: o.periodo_desde,
                periodo_hasta: o.periodo_hasta,
                formulario: o.formulario,
                vence_en: o.vence_en,
                dias,
                umbral,
            })
            r.vencimientos += 1
        }
    }

    private async limitePc(t: Transaccion, empresaId: number | null, hoy: string, r: ResultadoAlertas) {
        const empresas = empresaId
            ? [empresaId]
            : (
                  (await t.trx
                      .from('core.empresas as e')
                      .where('e.activa', true)
                      .whereExists((q) => q.from('fiscal.instalaciones as i').whereRaw('i.empresa_id = e.id'))
                      .orderBy('e.id', 'asc')
                      .select('e.id')) as Array<{ id: number }>
              ).map((f) => Number(f.id))
        const anio = Number(hoy.slice(0, 4))

        for (const id of empresas) {
            const datos = await datosFiscales(id, t.trx)
            if (resolver(datos.filas, 'regimen', hoy)?.valor !== 'pequeno_contribuyente') continue
            const limite = resolver(datos.filas, 'pc_limite_anual', hoy)
            const umbrales = resolver(datos.filas, 'pc_alertas', hoy)?.valor
            if (
                !limite ||
                typeof limite.valor !== 'string' ||
                !limite.vigente_desde?.startsWith(String(anio))
            ) {
                // el límite cambia cada año (125 salarios mínimos): el de otro año no sirve
                r.errores.push({
                    empresa_id: id,
                    codigo: 'parametro_sin_confirmar',
                    detalle: `pc_limite_anual sin valor para ${anio}`,
                })
                continue
            }
            if (!Array.isArray(umbrales) || umbrales.length === 0) continue
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CALENDARIO, id])

            const ventas = await libroVentasLegal(id, { desde: `${anio}-01-01`, hasta: hoy }, t.trx)
            const acumulado = redondear(dec(String(ventas.reporte.totales.total ?? '0')))
            const tope = dec(limite.valor)
            if (tope.lte(0)) continue
            const porcentaje = acumulado.div(tope).times(100)
            const alcanzados = umbrales
                .map((u) => dec(String(u)))
                .filter((u) => porcentaje.gte(u))
                .sort((a, b) => a.comparedTo(b))
            const umbral = alcanzados.at(-1)
            if (!umbral) continue
            const umbralTexto = aTexto(umbral)
            const insertada = (await t.trx
                .knexQuery()
                .table('fiscal.alertas')
                .insert({
                    empresa_id: id,
                    tipo: 'limite_pc',
                    clave: `${anio}:${umbralTexto}`,
                    datos: JSON.stringify({ acumulado: aTexto(acumulado), limite: aTexto(tope), hoy }),
                })
                .onConflict(['empresa_id', 'tipo', 'clave'])
                .ignore()
                .returning('id')) as Array<{ id: number }>
            if (insertada.length === 0) continue
            await t.emit('fiscal.limite_pc', {
                empresa_id: id,
                umbral_pct: umbralTexto,
                acumulado: aTexto(acumulado),
                limite: aTexto(tope),
                anio,
            })
            logger.info({ empresa_id: id, umbral: umbralTexto }, 'fiscal: límite del pequeño contribuyente')
            r.limite_pc += 1
        }
    }
}
