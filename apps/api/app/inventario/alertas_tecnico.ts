import type { Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import { actorTecnicoDe } from '#inventario/actor_tecnico'
import { configuracionInventario } from '#inventario/ordenes_traslado'
import { esActorIris, idIrisDe, vinculoVigente } from '#inventario/vinculos_iris'
import type { OrigenExterno } from '#inventario/origen_externo'

/**
 * Mitigación del riesgo aceptado T-12 (contrato Iris 0.14.0 §10.10): con el token de Iris se pueden
 * registrar consumos, comodatos y devoluciones a nombre de un técnico vinculado. Cada movimiento guarda en
 * el kardex `actor_tecnico` y la `Idempotency-Key` con la que llegó, y aquí se avisa al admin
 * (`inventario.alerta_tecnico`, que sale en el registro del sistema) cuando un técnico vinculado:
 *
 * - registra un movimiento **fuera de una orden informada** por Iris (sin `origen_tipo = iris_orden`): una
 *   alerta por operación (clave: la `Idempotency-Key`, o el request);
 * - supera en el día (Guatemala) el volumen configurable (`inventario.configuracion
 *   .iris_movimientos_diarios_alerta`, 40 de fábrica): una alerta por técnico y día.
 *
 * Solo con el actor de Iris y un vínculo vigente (§6.6); la clave única de `inventario.alertas_tecnico` hace
 * que dos instancias no avisen dos veces.
 */
export async function revisarAlertaTecnico(
    t: Transaccion,
    m: { movimientoId: number; empresaId: number; origenExterno: OrigenExterno | null | undefined },
): Promise<void> {
    const actor = actorTecnicoDe(t)
    if (!actor?.usuarioId || !actor.actor) return
    const idIris = idIrisDe(actor.actor)
    if (!idIris || !(await esActorIris(t))) return
    const vinculo = await vinculoVigente(t.trx, m.empresaId, idIris)
    if (!vinculo || vinculo.usuario_id !== actor.usuarioId) return
    const dia = hoyGuatemala()
    const clave = actor.idempotencyKey ?? `request:${t.ctx.requestId}`
    const contar = async () => {
        const fila = (await t.trx
            .from('inventario.movimientos')
            .where({ empresa_id: m.empresaId, actor_tecnico_id: actor.usuarioId })
            .whereRaw(`(created_at AT TIME ZONE 'America/Guatemala')::date = ?::date`, [dia])
            .count('* as n')
            .first()) as { n: string | number }
        return Number(fila?.n ?? 0)
    }
    const alertar = async (
        motivo: 'sin_orden' | 'volumen_diario',
        claveAlerta: string,
        movimientos: number,
        umbral: number | null,
    ) => {
        const filas = (await t.trx.rawQuery(
            `INSERT INTO inventario.alertas_tecnico
                (empresa_id, usuario_id, actor_tecnico, motivo, dia, clave, movimientos, umbral, movimiento_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (empresa_id, motivo, dia, clave) DO NOTHING RETURNING id`,
            [
                m.empresaId,
                actor.usuarioId,
                actor.actor,
                motivo,
                dia,
                claveAlerta,
                movimientos,
                umbral,
                m.movimientoId,
            ] as any[],
        )) as { rows: Array<{ id: number }> }
        const id = filas.rows[0]?.id
        if (!id) return
        await t.emit('inventario.alerta_tecnico', {
            alerta_id: Number(id),
            empresa_id: m.empresaId,
            usuario_id: actor.usuarioId!,
            actor_tecnico: actor.actor!,
            motivo,
            dia,
            movimientos,
            umbral,
            idempotency_key: actor.idempotencyKey ?? null,
        })
    }
    if (!m.origenExterno) await alertar('sin_orden', clave, await contar(), null)
    const configuracion = await configuracionInventario(m.empresaId, t.trx)
    const umbral = configuracion.iris_movimientos_diarios_alerta
    const movimientos = await contar()
    if (movimientos > umbral) await alertar('volumen_diario', String(actor.usuarioId), movimientos, umbral)
}
