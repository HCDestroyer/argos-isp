import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida } from '#ledger/fechas'
import { hoyFiscal } from '#fiscal/comun'
import { instalacionVigente } from '#fiscal/instalador'
import { datosFiscales, resolver, type FilaValor } from '#fiscal/parametros'
import { OBLIGACIONES_POR_PAIS, type DefinicionObligacion } from '#fiscal/l10n/gt/obligaciones'
import {
    COLUMNAS_OBLIGACION,
    LOCK_CALENDARIO,
    PlazoInvalido,
    calcularVencimiento,
    feriadosVigentes,
    normalizarObligacion,
    periodosEntre,
    type ObligacionFila,
    type ReglaPlazo,
} from '#fiscal/calendario'

/**
 * `fiscal.generar_calendario` (sistema; cron `fiscal:calendario` y al cambiar parámetros, régimen o
 * feriados): genera y concilia `fiscal.obligaciones` (contrato §9.3 y §21 PR A).
 *
 * Por empresa con localización, para **todo lo pendiente hasta hoy**: cada periodo de cada
 * obligación del paquete que termina en o después de `inicio_libros` y empieza en o antes de hoy.
 * Idempotente por la clave única (empresa, impuesto, periodo_desde).
 *
 * - Aplica según el régimen y las banderas vigentes en el periodo (en `max(periodo_desde,
 *   inicio_libros)`: el régimen que fija el instalador rige desde la instalación) y, en las
 *   retenciones de ISR, según el libro (§9.3 «quien retenga»).
 * - Vencimiento: el parámetro de plazo vigente al fin del periodo y el siguiente día hábil si cae
 *   en inhábil (`fiscal.feriados`, sábados y domingos).
 * - Conciliación: una obligación `pendiente` o `borrador` toma el vencimiento, formulario y regla
 *   nuevos (feriado agregado, plazo cambiado); una `pendiente` que deja de aplicar pasa a
 *   `no_aplica` con su motivo y vuelve a `pendiente` si aplica otra vez. Una `presentada` no se
 *   toca. Cada cambio sube `version` y deja `audit.cambios` (`obligacion_fiscal`).
 * - Un parámetro sin valor (o mal formado) no detiene la corrida: esa obligación de esa empresa
 *   queda en `errores` (y en la auditoría) y se reintenta en la siguiente.
 */

export interface EntradaGenerarCalendario {
    /** solo esta empresa; por defecto todas las que tienen localización */
    empresa_id?: number | null
    /** hoy en Guatemala (pruebas); por defecto el reloj fiscal */
    hoy?: string
}

export interface ErrorCalendario {
    empresa_id: number
    impuesto: string | null
    codigo: string
    detalle: string
}

export interface ResultadoCalendario {
    hoy: string
    empresas: number
    creadas: number
    actualizadas: number
    sin_aplicar: number
    errores: ErrorCalendario[]
}

interface Deseada {
    impuesto: DefinicionObligacion['impuesto']
    periodo_desde: string
    periodo_hasta: string
    aplica: boolean
    motivo: string | null
    formulario: string | null
    vence_en: string
    regla: Record<string, unknown>
}

const clave = (impuesto: string, periodoDesde: string) => `${impuesto}|${periodoDesde}`

export default class GenerarCalendario extends DomainAction<EntradaGenerarCalendario, ResultadoCalendario> {
    readonly nombre = 'fiscal.generar_calendario'

    protected async handle(input: EntradaGenerarCalendario, t: Transaccion): Promise<ResultadoCalendario> {
        const hoy = input.hoy ? fechaValida(input.hoy, 'hoy') : hoyFiscal()
        const resultado: ResultadoCalendario = {
            hoy,
            empresas: 0,
            creadas: 0,
            actualizadas: 0,
            sin_aplicar: 0,
            errores: [],
        }

        let empresas: number[]
        if (input.empresa_id) {
            exigirAccesoEmpresa(t.ctx, input.empresa_id)
            t.fijarEmpresa(input.empresa_id)
            empresas = [input.empresa_id]
        } else {
            t.fijarEmpresa(null)
            const filas = (await t.trx
                .from('core.empresas as e')
                .where('e.activa', true)
                .whereExists((q) => q.from('fiscal.instalaciones as i').whereRaw('i.empresa_id = e.id'))
                .orderBy('e.id', 'asc')
                .select('e.id')) as Array<{ id: number }>
            empresas = filas.map((f) => Number(f.id))
        }

        const feriados = await feriadosVigentes(t.trx)
        for (const empresaId of empresas) {
            await this.empresa(t, empresaId, hoy, feriados, resultado)
        }
        t.anotarAuditoria({
            empresas: resultado.empresas,
            creadas: resultado.creadas,
            actualizadas: resultado.actualizadas,
            sin_aplicar: resultado.sin_aplicar,
            errores: resultado.errores,
        })
        return resultado
    }

    private async empresa(
        t: Transaccion,
        empresaId: number,
        hoy: string,
        feriados: ReadonlySet<string>,
        resultado: ResultadoCalendario,
    ) {
        const instalacion = await instalacionVigente(t.trx, empresaId)
        if (!instalacion) return
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CALENDARIO, empresaId])
        resultado.empresas += 1

        const datos = await datosFiscales(empresaId, t.trx)
        const inicio = resolver(datos.filas, 'inicio_libros', hoy)?.valor
        if (typeof inicio !== 'string') {
            resultado.errores.push({
                empresa_id: empresaId,
                impuesto: null,
                codigo: 'parametro_sin_confirmar',
                detalle: 'inicio_libros sin valor',
            })
            return
        }

        const definiciones = OBLIGACIONES_POR_PAIS[instalacion.pais] ?? []
        const retencionesIsr = await mesesConRetencionIsr(t.trx, empresaId, inicio, hoy)
        const deseadas = new Map<string, Deseada>()
        const conError = new Set<string>()
        for (const def of definiciones) {
            try {
                for (const d of deseadasDe(def, datos.filas, inicio, hoy, feriados, retencionesIsr)) {
                    deseadas.set(clave(d.impuesto, d.periodo_desde), d)
                }
            } catch (error) {
                conError.add(def.impuesto)
                resultado.errores.push({
                    empresa_id: empresaId,
                    impuesto: def.impuesto,
                    codigo: error instanceof Problema ? (error.tipo.split(':').pop() ?? 'error') : 'error',
                    detalle: error instanceof Error ? error.message : String(error),
                })
                logger.warn(
                    { empresa_id: empresaId, impuesto: def.impuesto, err: error },
                    'calendario fiscal',
                )
            }
        }

        const existentes = (
            (await t.trx
                .from('fiscal.obligaciones as o')
                .where('o.empresa_id', empresaId)
                .forUpdate()
                .select(COLUMNAS_OBLIGACION)) as Array<Record<string, unknown>>
        ).map(normalizarObligacion)
        const porClave = new Map(existentes.map((o) => [clave(o.impuesto, o.periodo_desde), o]))

        for (const [k, d] of deseadas) {
            const actual = porClave.get(k)
            if (!actual) {
                if (!d.aplica) continue
                await t.trx
                    .insertQuery()
                    .table('fiscal.obligaciones')
                    .insert({
                        empresa_id: empresaId,
                        impuesto: d.impuesto,
                        periodo_desde: d.periodo_desde,
                        periodo_hasta: d.periodo_hasta,
                        formulario: d.formulario,
                        vence_en: d.vence_en,
                        regla: JSON.stringify(d.regla),
                        estado: 'pendiente',
                    })
                resultado.creadas += 1
                continue
            }
            if (actual.estado === 'presentada') continue
            const cambios: Partial<ObligacionFila> = {}
            if (d.aplica) {
                if (actual.estado === 'no_aplica') {
                    cambios.estado = 'pendiente'
                    cambios.motivo_estado = null
                }
                if (actual.vence_en !== d.vence_en) cambios.vence_en = d.vence_en
                if (actual.formulario !== d.formulario) cambios.formulario = d.formulario
                if (canonico(actual.regla) !== canonico(d.regla)) cambios.regla = d.regla
            } else if (actual.estado === 'pendiente') {
                cambios.estado = 'no_aplica'
                cambios.motivo_estado = d.motivo
            }
            if (await actualizar(t, actual, cambios)) {
                if (cambios.estado === 'no_aplica') resultado.sin_aplicar += 1
                else resultado.actualizadas += 1
            }
        }

        // pendientes fuera del calendario (inicio_libros movido después de su periodo)
        for (const actual of existentes) {
            const k = clave(actual.impuesto, actual.periodo_desde)
            if (deseadas.has(k) || conError.has(actual.impuesto) || actual.estado !== 'pendiente') continue
            if (actual.periodo_desde > hoy) continue
            const motivo = actual.periodo_hasta < inicio ? 'antes_de_inicio_libros' : 'fuera_del_paquete'
            if (await actualizar(t, actual, { estado: 'no_aplica', motivo_estado: motivo })) {
                resultado.sin_aplicar += 1
            }
        }
    }
}

/** JSON con las claves ordenadas: jsonb no guarda el orden de las claves. */
function canonico(valor: unknown): string {
    if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
    if (valor !== null && typeof valor === 'object') {
        const objeto = valor as Record<string, unknown>
        return `{${Object.keys(objeto)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonico(objeto[k])}`)
            .join(',')}}`
    }
    return JSON.stringify(valor ?? null)
}

/** UPDATE de una obligación con `version + 1` y `audit.cambios`; false si no había cambios. */
async function actualizar(t: Transaccion, actual: ObligacionFila, cambios: Partial<ObligacionFila>) {
    const campos = Object.keys(cambios) as Array<keyof ObligacionFila>
    if (campos.length === 0) return false
    const antes: Record<string, unknown> = {}
    const despues: Record<string, unknown> = {}
    for (const campo of campos) {
        antes[campo] = actual[campo]
        despues[campo] = cambios[campo]
    }
    await t.trx
        .from('fiscal.obligaciones')
        .where('id', actual.id)
        .where('version', actual.version)
        .update({
            ...cambios,
            ...(cambios.regla ? { regla: JSON.stringify(cambios.regla) } : {}),
            version: actual.version + 1,
        })
    await t.registrarCambios({ tipo: 'obligacion_fiscal', id: actual.id }, antes, despues)
    return true
}

/** Meses (YYYY-MM-01) con retenciones de ISR emitidas: abono neto a 2.1.05 sin su pago ni liquidación. */
async function mesesConRetencionIsr(
    trx: TransactionClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
): Promise<Set<string>> {
    const { rows } = (await trx.rawQuery(
        `SELECT to_char(date_trunc('month', a.fecha), 'YYYY-MM-DD') AS mes
           FROM ledger.movimientos m
           JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND c.codigo = '2.1.05'
            AND a.fecha >= date_trunc('month', ?::date) AND a.fecha <= ?::date
            AND a.origen_tipo NOT IN ('pago_impuesto', 'liquidacion_impuesto', 'cierre_anual')
          GROUP BY 1
         HAVING sum(m.haber - m.debe) > 0`,
        [empresaId, desde, hasta],
    )) as { rows: Array<{ mes: string }> }
    return new Set(rows.map((r) => r.mes))
}

/** Periodos de una obligación con su decisión, vencimiento y regla. */
function deseadasDe(
    def: DefinicionObligacion,
    filas: FilaValor[],
    inicio: string,
    hoy: string,
    feriados: ReadonlySet<string>,
    retencionesIsr: ReadonlySet<string>,
): Deseada[] {
    const salida: Deseada[] = []
    for (const periodo of periodosEntre(def.periodicidad, inicio, hoy)) {
        const referencia = periodo.desde > inicio ? periodo.desde : inicio
        const regimen = resolver(filas, 'regimen', referencia)?.valor
        let motivo: string | null = null
        if (typeof regimen !== 'string' || !(def.regimenes as readonly string[]).includes(regimen)) {
            motivo = `regimen_${String(regimen)}`
        } else if (def.condicion === 'agente_retencion_iva') {
            if (resolver(filas, 'agente_retencion_iva', referencia)?.valor !== true) {
                motivo = 'no_es_agente_retencion_iva'
            }
        } else if (def.condicion === 'retuvo_isr' && !retencionesIsr.has(periodo.desde)) {
            motivo = 'sin_retenciones_isr'
        }

        const leido = resolver(filas, def.parametro_plazo, periodo.hasta)
        if (!leido || typeof leido.valor !== 'object' || leido.valor === null) {
            throw new Problema(
                422,
                'parametro_sin_confirmar',
                'Parámetro sin confirmar',
                `${def.parametro_plazo} no tiene valor en ${periodo.hasta}`,
            )
        }
        const regla = leido.valor as ReglaPlazo
        if (
            motivo === null &&
            def.impuesto === 'isr_trimestral' &&
            periodo.trimestre === 4 &&
            regla.cuarto_trimestre === 'con_la_anual'
        ) {
            motivo = 'cuarto_trimestre_con_la_anual'
        }
        let vencimiento: { base: string; vence_en: string }
        try {
            vencimiento = calcularVencimiento(periodo.hasta, regla, feriados)
        } catch (error) {
            if (error instanceof PlazoInvalido) {
                throw new Problema(
                    422,
                    'plazo_invalido',
                    'Plazo inválido',
                    `${def.parametro_plazo}: ${error.message}`,
                )
            }
            throw error
        }
        salida.push({
            impuesto: def.impuesto,
            periodo_desde: periodo.desde,
            periodo_hasta: periodo.hasta,
            aplica: motivo === null,
            motivo,
            formulario: typeof regla.formulario === 'string' ? regla.formulario : null,
            vence_en: vencimiento.vence_en,
            regla: {
                parametro: def.parametro_plazo,
                valor: leido.valor,
                vigente_desde: leido.vigente_desde,
                nivel: leido.nivel,
                vence_base: vencimiento.base,
                corrido_a_habil: vencimiento.base !== vencimiento.vence_en,
            },
        })
    }
    return salida
}
