import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida } from '#ledger/fechas'
import { hoyFiscal } from '#fiscal/comun'
import { COLUMNAS_OBLIGACION, normalizarObligacion } from '#fiscal/calendario'
import { actualizarObligacion } from '#fiscal/actions/generar_calendario'
import { payloadDeclaracion } from '#fiscal/actions/calcular_declaracion'
import { Desactualizada } from '#fiscal/actions/revisar_declaracion'
import {
    LOCK_DECLARACIONES,
    hashActual,
    ultimaVersion,
    verDeclaracion,
    type DeclaracionFila,
} from '#fiscal/declaraciones'

/**
 * `declaraciones.presentar` (`POST /declaraciones/:id/marcar-presentada`, contrato §9.3): guarda lo
 * que el usuario presentó en la Agencia Virtual (número de formulario, fecha y boleta). El sistema
 * no envía nada a la SAT y esta acción no genera asiento (la liquidación la hizo la revisión, §10.6).
 *
 * - Solo la última versión y en `revisada` (409 `declaracion_no_revisada`, `declaracion_presentada`,
 *   `declaracion_sustituida`); si los datos cambiaron, 409 `declaracion_desactualizada`.
 * - `fecha_presentacion` no futura. La obligación pasa a `presentada`. Emite `declaracion.presentada`.
 */

export interface EntradaMarcarPresentada {
    declaracion_id: number
    numero_formulario: string
    fecha_presentacion: string
    boleta?: string | null
}

export default class MarcarDeclaracionPresentada extends DomainAction<
    EntradaMarcarPresentada,
    DeclaracionFila
> {
    readonly nombre = 'declaraciones.presentar'

    protected async handle(input: EntradaMarcarPresentada, t: Transaccion): Promise<DeclaracionFila> {
        const fecha = fechaValida(input.fecha_presentacion, 'fecha_presentacion')
        const numero = input.numero_formulario?.trim() ?? ''
        const errores = []
        if (fecha > hoyFiscal()) {
            errores.push({ field: 'fecha_presentacion', message: 'No puede ser futura', rule: 'futuro' })
        }
        if (numero.length < 3) {
            errores.push({
                field: 'numero_formulario',
                message: 'Número del formulario presentado',
                rule: 'required',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const inicial = await verDeclaracion(input.declaracion_id, t.trx)
        exigirAccesoEmpresa(t.ctx, inicial.empresa_id)
        t.fijarEmpresa(inicial.empresa_id)
        t.fijarEntidad('declaracion', inicial.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DECLARACIONES, inicial.empresa_id])
        const d = await verDeclaracion(input.declaracion_id, t.trx)
        const ultima = await ultimaVersion(t.trx, d.empresa_id, d.impuesto, d.periodo_desde)
        if (ultima && ultima.id !== d.id) {
            throw new Conflicto(
                `La versión ${d.version} fue sustituida`,
                'declaracion_sustituida',
                'Declaración sustituida',
            )
        }
        if (d.estado !== 'revisada') {
            throw new Conflicto(
                d.estado === 'presentada'
                    ? `La declaración ${d.id} ya está presentada`
                    : `La declaración ${d.id} está en ${d.estado}: revísela (genera la liquidación) antes de marcarla presentada`,
                d.estado === 'presentada' ? 'declaracion_presentada' : 'declaracion_no_revisada',
                'Declaración no presentable',
            )
        }
        if ((await hashActual(t.trx, d)) !== d.datos_hash) throw new Desactualizada(d)

        const boleta = input.boleta?.trim() || null
        await t.trx
            .from('fiscal.declaraciones')
            .where('id', d.id)
            .update({
                estado: 'presentada',
                numero_formulario: numero,
                fecha_presentacion: fecha,
                boleta,
                presentada_por: usuarioDelActor(t.ctx.actor),
                presentada_en: new Date(),
            })
        await t.registrarCambios(
            { tipo: 'declaracion', id: d.id },
            { estado: d.estado, numero_formulario: null, fecha_presentacion: null, boleta: null },
            { estado: 'presentada', numero_formulario: numero, fecha_presentacion: fecha, boleta },
        )
        const fila = (await t.trx
            .from('fiscal.obligaciones as o')
            .where('o.id', d.obligacion_id)
            .forUpdate()
            .select(COLUMNAS_OBLIGACION)
            .first()) as Record<string, unknown>
        const obligacion = normalizarObligacion(fila)
        await actualizarObligacion(t, obligacion, {
            ...(obligacion.estado !== 'presentada' ? { estado: 'presentada', motivo_estado: null } : {}),
            ...(obligacion.declaracion_id !== d.id ? { declaracion_id: d.id } : {}),
        })

        const presentada = await verDeclaracion(d.id, t.trx)
        await t.emit('declaracion.presentada', payloadDeclaracion(presentada))
        return presentada
    }
}
