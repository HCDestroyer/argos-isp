import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida } from '#shared/errores'
import { hoyFiscal, empresaFiscal } from '#fiscal/comun'
import { resolver, datosFiscales } from '#fiscal/parametros'
import { COLUMNAS_OBLIGACION, normalizarObligacion, type ObligacionFila } from '#fiscal/calendario'
import GenerarCalendario, { actualizarObligacion } from '#fiscal/actions/generar_calendario'
import {
    IMPUESTOS_DECLARABLES,
    LOCK_DECLARACIONES,
    calcularDatos,
    ultimaVersion,
    verDeclaracion,
    type DeclaracionFila,
    type ImpuestoDeclarable,
} from '#fiscal/declaraciones'

/**
 * `declaraciones.calcular` (`POST /declaraciones/calcular`, contrato §9.3; fase 7 PR B): calcula un
 * borrador de IVA (`iva_mensual`) o de pequeño contribuyente (`pc_mensual`) del mes y lo guarda como
 * versión nueva (solo inserción de lo calculado). Nunca se envía a la SAT.
 *
 * - El mes no puede ser futuro; antes de `inicio_libros`: 422 `antes_de_inicio_libros`.
 * - Exige la obligación del calendario (régimen y banderas del periodo): si no aplica, 422
 *   `obligacion_no_aplica` con su motivo.
 * - Con la última versión `revisada` o `presentada` (ya liquidada) solo se calcula una
 *   **sustitutiva** (`sustitutiva: true`; si no, 409 `declaracion_revisada` o
 *   `declaracion_presentada`). La versión anterior pasa a `sustituida`.
 * - La obligación queda enlazada (`declaracion_id`) y en `borrador`.
 * - Emite `declaracion.calculada`.
 */

export interface EntradaCalcularDeclaracion {
    empresa_id?: number | null
    impuesto: ImpuestoDeclarable
    /** AAAA-MM */
    periodo: string
    sustitutiva?: boolean
}

export default class CalcularDeclaracion extends DomainAction<EntradaCalcularDeclaracion, DeclaracionFila> {
    readonly nombre = 'declaraciones.calcular'

    protected async handle(input: EntradaCalcularDeclaracion, t: Transaccion): Promise<DeclaracionFila> {
        if (!(IMPUESTOS_DECLARABLES as readonly string[]).includes(input.impuesto)) {
            throw new ReglaImpuesto(input.impuesto)
        }
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodo ?? '')) {
            throw new ValidacionFallida([
                { field: 'periodo', message: 'El periodo es AAAA-MM', rule: 'periodo' },
            ])
        }
        const desde = `${input.periodo}-01`
        const hoy = hoyFiscal()
        if (desde > hoy) {
            throw new ValidacionFallida([
                { field: 'periodo', message: 'El periodo no puede ser futuro', rule: 'futuro' },
            ])
        }
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DECLARACIONES, empresaId])

        const datos = await datosFiscales(empresaId, t.trx)
        const inicio = resolver(datos.filas, 'inicio_libros', hoy)?.valor
        const hasta = (await t.trx.rawQuery(
            `SELECT to_char((?::date + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD') AS f`,
            [desde],
        )) as { rows: Array<{ f: string }> }
        const periodoHasta = hasta.rows[0]!.f
        if (typeof inicio === 'string' && periodoHasta < inicio) {
            throw new Problema(
                422,
                'antes_de_inicio_libros',
                'Antes del inicio de los libros',
                `El periodo ${input.periodo} es anterior a inicio_libros (${inicio}): sus libros y declaraciones salieron del sistema anterior`,
                [
                    {
                        field: 'periodo',
                        message: `Desde ${inicio.slice(0, 7)}`,
                        rule: 'antes_de_inicio_libros',
                    },
                ],
            )
        }

        // la obligación del calendario (generada al momento si el cron no ha corrido)
        await new GenerarCalendario().execute({ empresa_id: empresaId, hoy }, t.ctx, { trx: t.trx })
        const fila = (await t.trx
            .from('fiscal.obligaciones as o')
            .where({ 'o.empresa_id': empresaId, 'o.impuesto': input.impuesto, 'o.periodo_desde': desde })
            .forUpdate()
            .select(COLUMNAS_OBLIGACION)
            .first()) as Record<string, unknown> | null
        const obligacion: ObligacionFila | null = fila ? normalizarObligacion(fila) : null
        if (!obligacion || obligacion.estado === 'no_aplica') {
            throw new Problema(
                422,
                'obligacion_no_aplica',
                'La obligación no aplica',
                `La empresa no tiene la obligación ${input.impuesto} de ${input.periodo}${
                    obligacion?.motivo_estado ? ` (${obligacion.motivo_estado})` : ''
                }: revise el régimen y las banderas del periodo`,
                [
                    {
                        field: 'impuesto',
                        message: obligacion?.motivo_estado ?? 'sin obligación',
                        rule: 'obligacion_no_aplica',
                    },
                ],
            )
        }

        const previa = await ultimaVersion(t.trx, empresaId, input.impuesto, desde)
        if (
            previa &&
            (previa.estado === 'revisada' || previa.estado === 'presentada') &&
            !input.sustitutiva
        ) {
            throw new Conflicto(
                `La versión ${previa.version} de ${input.impuesto} ${input.periodo} está ${previa.estado}: para corregirla calcule una sustitutiva (sustitutiva: true)`,
                previa.estado === 'presentada' ? 'declaracion_presentada' : 'declaracion_revisada',
                previa.estado === 'presentada' ? 'Declaración presentada' : 'Declaración revisada',
            )
        }
        const liquidada = previa?.revisada_en !== null && previa?.revisada_en !== undefined
        const calculado = await calcularDatos(t.trx, empresaId, input.impuesto, desde)

        const [nueva] = (await t.trx
            .insertQuery()
            .table('fiscal.declaraciones')
            .insert({
                empresa_id: empresaId,
                impuesto: input.impuesto,
                periodo_desde: desde,
                periodo_hasta: periodoHasta,
                version: (previa?.version ?? 0) + 1,
                sustitutiva: liquidada,
                sustituye_a: previa?.id ?? null,
                obligacion_id: obligacion.id,
                formulario: calculado.formulario ?? obligacion.formulario,
                vence_en: obligacion.vence_en,
                parametros: JSON.stringify(calculado.parametros),
                detalle: JSON.stringify(calculado.detalle),
                totales: JSON.stringify(calculado.totales),
                datos_hash: calculado.datos_hash,
                calculada_por: usuarioDelActor(t.ctx.actor),
                estado: 'borrador',
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(nueva!.id)
        t.fijarEntidad('declaracion', id)
        if (previa && previa.estado !== 'sustituida') {
            await t.trx.from('fiscal.declaraciones').where('id', previa.id).update({ estado: 'sustituida' })
            await t.registrarCambios(
                { tipo: 'declaracion', id: previa.id },
                { estado: previa.estado },
                { estado: 'sustituida' },
            )
        }
        await actualizarObligacion(t, obligacion, {
            ...(obligacion.declaracion_id !== id ? { declaracion_id: id } : {}),
            ...(obligacion.estado !== 'borrador' ? { estado: 'borrador', motivo_estado: null } : {}),
        })

        const declaracion = await verDeclaracion(id, t.trx)
        await t.emit('declaracion.calculada', payloadDeclaracion(declaracion))
        return declaracion
    }
}

class ReglaImpuesto extends Problema {
    constructor(impuesto: string) {
        super(
            422,
            'impuesto_no_soportado',
            'Impuesto no soportado',
            `${impuesto}: por ahora se declaran ${IMPUESTOS_DECLARABLES.join(' y ')} (ISR, ISO y retenciones llegan en la PR C)`,
            [{ field: 'impuesto', message: `Una de: ${IMPUESTOS_DECLARABLES.join(', ')}`, rule: 'enum' }],
        )
    }
}

export function payloadDeclaracion(d: DeclaracionFila, monto?: string) {
    return {
        declaracion_id: d.id,
        empresa_id: d.empresa_id,
        impuesto: d.impuesto,
        periodo_desde: d.periodo_desde,
        periodo_hasta: d.periodo_hasta,
        vence_en: d.vence_en,
        monto: monto ?? d.totales.a_pagar ?? '0.00',
        version: d.version,
    }
}
