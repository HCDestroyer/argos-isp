import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirChecks } from '#ledger/checks'
import { bloqueoVigente, bloquearBloqueos, guardarBloqueo } from '#ledger/bloqueos'
import { exigirNcreCertificadas } from '#ledger/ncre_pendientes'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { hoyFiscal } from '#fiscal/comun'
import CalcularDeclaracion, { payloadDeclaracion } from '#fiscal/actions/calcular_declaracion'
import { actualizarObligacion } from '#fiscal/actions/generar_calendario'
import { COLUMNAS_OBLIGACION, normalizarObligacion } from '#fiscal/calendario'
import {
    LOCK_DECLARACIONES,
    hashActual,
    liquidadoDelPeriodo,
    netoLiquidacion,
    partidasDiferencia,
    verDeclaracion,
    ultimaVersion,
    type DeclaracionFila,
    type ImpuestoDeclarable,
} from '#fiscal/declaraciones'

/**
 * `declaraciones.revisar` (`POST /declaraciones/:id/revisar`, contrato §9.3 y §10.6; fase 7 PR B):
 * da por bueno el borrador y genera **siempre** su liquidación, en la misma transacción:
 *
 * 1. La versión es la última del periodo y está en `borrador` (409 `declaracion_sustituida` o
 *    `declaracion_revisada`); el mes terminó (422 `periodo_en_curso`).
 * 2. Los datos no cambiaron desde que se calculó (409 `declaracion_desactualizada`).
 * 3. Ninguna NCRE del mes o anterior sin certificar (409 `ncre_sin_certificar`, como el cierre).
 * 4. Verifica los checks de impuestos y exige `iva_cuadrado` (422 `checks_pendientes`).
 * 5. Asiento de liquidación (origen `liquidacion_impuesto`, diario `IMP`):
 *    IVA `2.1.02 / 1.1.04 + 1.1.05 + 2.1.06` (el crédito no usado queda en `1.1.04`, sin asiento);
 *    pequeño contribuyente `5.3.04 / 2.1.09` y `2.1.09 / 1.1.05`. Es la diferencia entre el neto del
 *    borrador y lo ya liquidado del periodo: la primera vez con fecha del último día del mes; en una
 *    sustitutiva, con fecha de hoy. Sin diferencia no hay asiento.
 * 6. Fija el bloqueo `impuestos` en el último día del mes (si no estaba más adelante).
 * 7. Vuelve a verificar y exige `iva_cuadrado` e `iva_liquidado`; un error revierte todo.
 *
 * Estado `revisada`; emite `declaracion.revisada` (y `libro.bloqueo_cambiado` por el bloqueo).
 */

export interface EntradaRevisarDeclaracion {
    declaracion_id: number
    /** @internal la revisa la cascada de otra revisión (H34): no vuelve a encadenar */
    cascada_de?: number | null
}

/** Un mes recalculado y revisado por la cascada (H34, decisión del líder). */
export interface MesCascada {
    periodo: string
    declaracion_id: number
    version: number
    sustituye_a: number
    /** la versión sustituida estaba presentada: la obligación vuelve a «por presentar» (rectificativa) */
    estaba_presentada: boolean
    remanente_credito_anterior: string
    remanente_credito: string
    a_pagar: string
}

export interface DeclaracionRevisada extends DeclaracionFila {
    cascada: MesCascada[]
}

export default class RevisarDeclaracion extends DomainAction<EntradaRevisarDeclaracion, DeclaracionRevisada> {
    readonly nombre = 'declaraciones.revisar'

    protected async handle(input: EntradaRevisarDeclaracion, t: Transaccion): Promise<DeclaracionRevisada> {
        const previa = await verDeclaracion(input.declaracion_id, t.trx)
        exigirAccesoEmpresa(t.ctx, previa.empresa_id)
        t.fijarEmpresa(previa.empresa_id)
        t.fijarEntidad('declaracion', previa.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DECLARACIONES, previa.empresa_id])
        const d = await verDeclaracion(input.declaracion_id, t.trx)
        await exigirBorradorVigente(t, d)
        if (d.periodo_hasta >= hoyFiscal()) {
            throw new ReglaNegocio(
                `El mes ${d.periodo_desde.slice(0, 7)} no ha terminado: se revisa y liquida después de su último día`,
                'periodo_en_curso',
            )
        }
        if ((await hashActual(t.trx, d)) !== d.datos_hash) throw new Desactualizada(d)
        await exigirNcreCertificadas(t.trx, d.empresa_id, d.periodo_desde, 'antes de liquidar el IVA')

        const periodo = d.periodo_desde.slice(0, 7)
        const verificar = () =>
            new VerificarCierre().execute({ empresa_id: d.empresa_id, tipo: 'impuestos', periodo }, t.ctx, {
                trx: t.trx,
            })
        await verificar()
        await exigirChecks(t.trx, d.empresa_id, 'impuestos', d.periodo_desde, ['iva_cuadrado'])

        // liquidación: lo que falta para llegar al neto del borrador
        const objetivo = netoLiquidacion(d.impuesto as ImpuestoDeclarable, d.totales)
        const hecho = await liquidadoDelPeriodo(t.trx, d.empresa_id, d.impuesto, d.periodo_desde)
        const partidas = partidasDiferencia(objetivo, hecho)
        let asientoId: number | null = null
        if (partidas.length > 0) {
            const asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: d.empresa_id,
                    fecha: hecho.size === 0 ? d.periodo_hasta : hoyFiscal(),
                    descripcion: `Liquidación ${d.impuesto} ${periodo} (versión ${d.version}${d.sustitutiva ? ', sustitutiva' : ''})`,
                    origen_tipo: 'liquidacion_impuesto',
                    origen_id: d.id,
                    diario: 'IMP',
                    movimientos: partidas,
                },
                t.ctx,
                { trx: t.trx },
            )
            asientoId = asiento.id
        }

        // bloqueo automático de impuestos (§10.4): el del sistema, sin el límite de «no futuro» del manual
        await bloquearBloqueos(t.trx, d.empresa_id)
        const vigente = await bloqueoVigente(t.trx, d.empresa_id, 'impuestos')
        if (vigente === null || vigente < d.periodo_hasta) {
            await guardarBloqueo(t, {
                empresaId: d.empresa_id,
                tipo: 'impuestos',
                hasta: d.periodo_hasta,
                motivo: `Liquidación de ${d.impuesto} ${periodo} (declaración ${d.id})`,
            })
            t.fijarEntidad('declaracion', d.id)
        }

        await t.trx
            .from('fiscal.declaraciones')
            .where('id', d.id)
            .update({
                estado: 'revisada',
                revisada_por: usuarioDelActor(t.ctx.actor),
                revisada_en: new Date(),
                asiento_id: asientoId,
            })
        await t.registrarCambios(
            { tipo: 'declaracion', id: d.id },
            { estado: 'borrador', asiento_id: null },
            { estado: 'revisada', asiento_id: asientoId },
        )
        await verificar()
        await exigirChecks(t.trx, d.empresa_id, 'impuestos', d.periodo_desde)

        const revisada = await verDeclaracion(d.id, t.trx)
        await t.emit('declaracion.revisada', {
            ...payloadDeclaracion(revisada),
            ...(input.cascada_de ? { motivo: 'cascada' as const, cascada_de: input.cascada_de } : {}),
        })
        const cascada = input.cascada_de ? [] : await cascadaDeRemanentes(t, revisada)
        if (cascada.length > 0) t.anotarAuditoria({ cascada })
        t.fijarEntidad('declaracion', d.id)
        return { ...revisada, cascada }
    }
}

const remanentes = (totales: Record<string, string>, sufijo = '') => [
    totales[`remanente_credito${sufijo}`] ?? '0.00',
    totales[`remanente_retenciones${sufijo}`] ?? '0.00',
]

/**
 * H34 (decisión del líder): revisar un mes que cambia el remanente que deja obliga a rectificar, en la
 * misma transacción y en orden, cada mes posterior que ya tenga versión revisada: una sustitutiva con
 * el remanente nuevo, revisada y liquidando solo la diferencia (fecha de hoy). Se detiene en el primer
 * mes cuyo remanente arrastrado no cambia (o sin versión revisada). Si la versión sustituida estaba
 * presentada, la obligación vuelve a «por presentar» con `motivo_estado = 'rectificativa'`; los pagos no
 * se tocan (la diferencia queda en `2.1.06`). Un mes que no se puede revisar: 409 `cascada_bloqueada`.
 */
async function cascadaDeRemanentes(t: Transaccion, origen: DeclaracionFila): Promise<MesCascada[]> {
    const salida: MesCascada[] = []
    let actual = origen
    for (;;) {
        const periodo = DateTime.fromISO(actual.periodo_desde, { zone: 'utc' }).plus({ months: 1 })
        const desde = periodo.toISODate()!
        const siguiente = (await t.trx
            .from('fiscal.declaraciones')
            .where({ empresa_id: actual.empresa_id, impuesto: actual.impuesto, periodo_desde: desde })
            .whereNotNull('revisada_en')
            .orderBy('version', 'desc')
            .select('id', 'estado', 'totales')
            .first()) as { id: number; estado: string; totales: Record<string, string> } | null
        if (!siguiente) break
        const deja = remanentes(actual.totales)
        const arrastro = remanentes(siguiente.totales, '_anterior')
        if (deja[0] === arrastro[0] && deja[1] === arrastro[1]) break

        const texto = periodo.toFormat('yyyy-MM')
        let revisada: DeclaracionRevisada
        try {
            const nueva = await new CalcularDeclaracion().execute(
                {
                    empresa_id: actual.empresa_id,
                    impuesto: actual.impuesto as ImpuestoDeclarable,
                    periodo: texto,
                    sustitutiva: true,
                },
                t.ctx,
                { trx: t.trx },
            )
            revisada = await new RevisarDeclaracion().execute(
                { declaracion_id: nueva.id, cascada_de: origen.id },
                t.ctx,
                { trx: t.trx },
            )
        } catch (error) {
            if (!(error instanceof Problema)) throw error
            const causa = error.tipo.split(':').pop() ?? 'error'
            throw new Problema(
                409,
                'cascada_bloqueada',
                'Cascada de remanentes bloqueada',
                `Revisar ${origen.impuesto} ${origen.periodo_desde.slice(0, 7)} cambia el remanente que arrastra ${texto}, ya revisado, y ese mes no se puede rectificar (${causa}: ${error.detalle ?? error.message}). Nada se guardó`,
                [
                    ...salida.map((m) => ({ field: m.periodo, message: 'rectificable', rule: 'ok' })),
                    { field: texto, message: error.detalle ?? error.message, rule: causa },
                ],
            )
        }
        const estabaPresentada = siguiente.estado === 'presentada'
        if (estabaPresentada) {
            const fila = (await t.trx
                .from('fiscal.obligaciones as o')
                .where('o.id', revisada.obligacion_id)
                .forUpdate()
                .select(COLUMNAS_OBLIGACION)
                .first()) as Record<string, unknown>
            await actualizarObligacion(t, normalizarObligacion(fila), { motivo_estado: 'rectificativa' })
        }
        salida.push({
            periodo: texto,
            declaracion_id: revisada.id,
            version: revisada.version,
            sustituye_a: Number(siguiente.id),
            estaba_presentada: estabaPresentada,
            remanente_credito_anterior: revisada.totales.remanente_credito_anterior ?? '0.00',
            remanente_credito: revisada.totales.remanente_credito ?? '0.00',
            a_pagar: revisada.totales.a_pagar ?? '0.00',
        })
        actual = revisada
    }
    return salida
}

/** La versión es la última de su periodo y sigue en borrador. */
export async function exigirBorradorVigente(t: Transaccion, d: DeclaracionFila) {
    const ultima = await ultimaVersion(t.trx, d.empresa_id, d.impuesto, d.periodo_desde)
    if (ultima && ultima.id !== d.id) {
        throw new Conflicto(
            `La versión ${d.version} fue sustituida por la ${ultima.version}`,
            'declaracion_sustituida',
            'Declaración sustituida',
        )
    }
    if (d.estado !== 'borrador') {
        throw new Conflicto(
            `La declaración ${d.id} ya está ${d.estado}`,
            d.estado === 'presentada' ? 'declaracion_presentada' : 'declaracion_revisada',
            'Declaración ya revisada',
        )
    }
}

export class Desactualizada extends Conflicto {
    constructor(d: DeclaracionFila) {
        super(
            `Los datos de ${d.impuesto} ${d.periodo_desde.slice(0, 7)} cambiaron desde que se calculó la versión ${d.version}: calcúlela otra vez`,
            'declaracion_desactualizada',
            'Declaración desactualizada',
        )
    }
}
