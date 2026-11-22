import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aplicarIntentoQueCuenta } from '#inventario/recuperacion'

/**
 * `inventario.decidir_intento_recuperacion` (`POST /inventario/intentos-recuperacion/:id/decidir`; contrato
 * Iris 0.14.0 §4.5, T-1): un intento «anterior a la verificación» (de un Iris < 0.14.0, o registrado antes
 * de que Argos verificara) **lo decide una persona**. Con `aceptar: true` queda `aceptado`: cuenta para el
 * mínimo de técnicos distintos y, si la unidad sigue en comodato en ese servicio, la pasa a
 * `por_recuperar` (sin aviso al titular: ya pasó). Con `aceptar: false` queda `descartado`. El motivo es
 * obligatorio. Solo intentos `anterior` (otro estado: 409 `intento_ya_decidido`).
 */

export interface EntradaDecidirIntentoRecuperacion {
    intento_id: number
    aceptar: boolean
    motivo: string
}

export default class DecidirIntentoRecuperacion extends DomainAction<
    EntradaDecidirIntentoRecuperacion,
    { intento_id: number; verificacion: 'aceptado' | 'descartado'; por_recuperar: boolean }
> {
    readonly nombre = 'inventario.decidir_intento_recuperacion'

    protected async handle(input: EntradaDecidirIntentoRecuperacion, t: Transaccion) {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        t.fijarEntidad('intento_recuperacion', input.intento_id)
        const fila = (await t.trx
            .from('inventario.verificaciones_iris')
            .where('intento_id', input.intento_id)
            .forUpdate()
            .select('id', 'empresa_id', 'estado')
            .first()) as { id: number; empresa_id: number; estado: string } | null
        if (!fila) {
            const existe = await t.trx
                .from('inventario.intentos_recuperacion')
                .where('id', input.intento_id)
                .first()
            if (!existe) throw new NoEncontrado(`El intento ${input.intento_id} no existe`)
            throw new Conflicto(
                `El intento ${input.intento_id} lo registró una persona en Argos: ya cuenta`,
                'intento_ya_decidido',
                'Intento ya decidido',
            )
        }
        const empresaId = Number(fila.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (fila.estado !== 'anterior') {
            throw new Conflicto(
                `El intento ${input.intento_id} está ${fila.estado.replaceAll('_', ' ')}: solo se deciden los anteriores a la verificación`,
                'intento_ya_decidido',
                'Intento ya decidido',
            )
        }
        const estado = input.aceptar ? 'aceptado' : 'descartado'
        await t.trx
            .from('inventario.verificaciones_iris')
            .where('id', fila.id)
            .update({
                estado,
                decidido_por: usuarioDelActor(t.ctx.actor),
                decidido_en: t.trx.knexRawQuery('now()'),
                motivo_decision: motivo.slice(0, 500),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'verificacion_iris', id: Number(fila.id) },
            { estado: fila.estado },
            { estado },
        )
        const efecto = input.aceptar
            ? await aplicarIntentoQueCuenta(t, input.intento_id, { avisar: false })
            : { por_recuperar: false }
        return {
            intento_id: input.intento_id,
            verificacion: estado as 'aceptado' | 'descartado',
            por_recuperar: efecto.por_recuperar,
        }
    }
}
