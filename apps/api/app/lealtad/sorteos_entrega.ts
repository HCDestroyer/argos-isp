import type { Transaccion } from '#shared/domain_action'
import type { GanadorVista, SorteoVista } from '#lealtad/sorteos'

/**
 * Notificación de ganadores y reclamo (§7.4). La usan `sorteos.notificar_ganadores` (todos los que
 * tienen premio y aún no se notificaron) y `sorteos.marcar_no_reclamado` (el suplente que toma el
 * premio se notifica en el mismo paso).
 */

export const DIAS_RECLAMO_POR_DEFECTO = 30

/** Marca al ganador `notificado` con su plazo de reclamo y emite `sorteo.ganador_notificado` (notify). */
export async function notificarGanador(
    t: Transaccion,
    sorteo: SorteoVista,
    ganador: GanadorVista,
): Promise<void> {
    const premio = sorteo.premios.find((p) => p.posicion === ganador.premio)!
    const dias = Number(sorteo.bases.plazo_reclamo_dias ?? DIAS_RECLAMO_POR_DEFECTO)
    const [fila] = (await t.trx
        .from('lealtad.sorteos_ganadores')
        .where('id', ganador.id)
        .where('estado', 'por_notificar')
        .update({
            estado: 'notificado',
            notificado_en: t.trx.knexRawQuery('now()'),
            reclamar_antes: t.trx.knexRawQuery(`now() + make_interval(days => ?)`, [dias]),
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
        .returning(['reclamar_antes'])) as Array<{ reclamar_antes: Date }>
    if (!fila) return
    await t.registrarCambios(
        { tipo: 'sorteo_ganador', id: ganador.id },
        { estado: ganador.estado },
        { estado: 'notificado', reclamar_antes: fila.reclamar_antes },
    )
    await t.emit('sorteo.ganador_notificado', {
        sorteo_id: sorteo.id,
        empresa_id: sorteo.empresa_id,
        ganador_id: ganador.id,
        cliente_id: ganador.cliente_id,
        posicion: ganador.posicion,
        tipo: ganador.tipo,
        codigo: ganador.codigo_publico,
        premio: { posicion: premio.posicion, nombre: premio.nombre, valor: premio.valor, tipo: premio.tipo },
        reclamar_antes: new Date(fila.reclamar_antes).toISOString(),
        sustituye_a: ganador.sustituye_a,
    })
}

/**
 * Premios sin resolver: ganadores con premio que no se entregó ni se dio por no reclamado. Sin ninguno,
 * el sorteo con el acta cerrada pasa a `premios_entregados`.
 */
export function premiosPendientes(ganadores: GanadorVista[]): GanadorVista[] {
    return ganadores.filter((g) => g.premio !== null && ['por_notificar', 'notificado'].includes(g.estado))
}

/** Con el acta cerrada y nada pendiente, `acta_cerrada → premios_entregados`. */
export async function cerrarSiTodoResuelto(
    t: Transaccion,
    sorteo: Pick<SorteoVista, 'id' | 'estado'>,
    ganadores: GanadorVista[],
): Promise<boolean> {
    if (sorteo.estado !== 'acta_cerrada' || premiosPendientes(ganadores).length > 0) return false
    await t.trx
        .from('lealtad.sorteos')
        .where('id', sorteo.id)
        .update({
            estado: 'premios_entregados',
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    await t.registrarCambios(
        { tipo: 'sorteo', id: sorteo.id },
        { estado: 'acta_cerrada' },
        { estado: 'premios_entregados' },
    )
    return true
}
