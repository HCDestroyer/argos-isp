import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirChecks } from '#ledger/checks'
import { bloqueoVigente, bloquearBloqueos, guardarBloqueo } from '#ledger/bloqueos'
import { exigirNcreCertificadas } from '#ledger/ncre_pendientes'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { hoyFiscal } from '#fiscal/comun'
import { payloadDeclaracion } from '#fiscal/actions/calcular_declaracion'
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
}

export default class RevisarDeclaracion extends DomainAction<EntradaRevisarDeclaracion, DeclaracionFila> {
    readonly nombre = 'declaraciones.revisar'

    protected async handle(input: EntradaRevisarDeclaracion, t: Transaccion): Promise<DeclaracionFila> {
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
        await t.emit('declaracion.revisada', payloadDeclaracion(revisada))
        return revisada
    }
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
