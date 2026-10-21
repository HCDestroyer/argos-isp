import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { detalleSorteo, exigirEstado, ganadoresDe, verSorteo } from '#lealtad/sorteos'
import { cerrarSiTodoResuelto, notificarGanador } from '#lealtad/sorteos_entrega'

/**
 * `sorteos.marcar_no_reclamado` (`POST /lealtad/sorteos/:id/ganadores/:ganadorId/no-reclamado`,
 * permiso `sorteos.entregar`, con motivo; §7.4): vencido el plazo de reclamo de un ganador notificado
 * (422 `plazo_reclamo_vigente` antes), su premio pasa al **siguiente suplente** en orden de puesto que
 * siga en espera (`premio_sustitucion`, `sustituye_a`), que se notifica en el mismo paso. El ganador
 * queda `sustituido`; sin suplentes disponibles queda `no_reclamado` y el premio sigue lo que digan las
 * bases (`bases.no_reclamados`). El resultado del sorteo no cambia (puesto, tipo y `premio_posicion` están
 * congelados): la sustitución es un dato aparte. Con el acta cerrada y nada pendiente, el sorteo pasa
 * a `premios_entregados`. Evento `sorteo.premio_no_reclamado`.
 */

export interface EntradaNoReclamado {
    sorteo_id: number
    ganador_id: number
    motivo: string
}

export default class MarcarNoReclamadoSorteo extends DomainAction<
    EntradaNoReclamado,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.marcar_no_reclamado'

    protected async handle(input: EntradaNoReclamado, t: Transaccion) {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'motivo',
                },
            ])
        }
        const sorteo = await verSorteo(input.sorteo_id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['ejecutado', 'acta_cerrada'], 'dar un premio por no reclamado')
        const ganadores = await ganadoresDe(sorteo.id, t.trx)
        const ganador = ganadores.find((g) => g.id === input.ganador_id)
        if (!ganador) throw new NoEncontrado(`El ganador ${input.ganador_id} no es del sorteo ${sorteo.id}`)
        if (ganador.premio === null || ganador.estado !== 'notificado' || !ganador.reclamar_antes) {
            throw new ReglaNegocio(
                `El ganador ${ganador.id} está ${ganador.estado}: solo un ganador notificado con premio puede quedar sin reclamar`,
                'ganador_no_notificado',
            )
        }
        if (new Date(ganador.reclamar_antes).getTime() > Date.now()) {
            throw new ReglaNegocio(
                `El plazo para reclamar vence ${new Date(ganador.reclamar_antes).toISOString()}`,
                'plazo_reclamo_vigente',
            )
        }
        const suplente = ganadores
            .filter((g) => g.tipo === 'suplente' && g.premio === null && g.estado === 'por_notificar')
            .sort((a, b) => a.posicion - b.posicion)[0]
        const nuevoEstado = suplente ? 'sustituido' : 'no_reclamado'
        await t.trx
            .from('lealtad.sorteos_ganadores')
            .where('id', ganador.id)
            .update({
                estado: nuevoEstado,
                no_reclamado_en: t.trx.knexRawQuery('now()'),
                nota: motivo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo_ganador', id: ganador.id },
            { estado: ganador.estado },
            { estado: nuevoEstado, nota: motivo },
        )
        if (suplente) {
            await t.trx
                .from('lealtad.sorteos_ganadores')
                .where('id', suplente.id)
                .update({
                    sustituye_a: ganador.id,
                    premio_sustitucion: ganador.premio,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'sorteo_ganador', id: suplente.id },
                { premio_sustitucion: null, sustituye_a: null },
                { premio_sustitucion: ganador.premio, sustituye_a: ganador.id },
            )
            const actuales = await ganadoresDe(sorteo.id, t.trx)
            const tomado = actuales.find((g) => g.id === suplente.id)!
            await notificarGanador(t, sorteo, tomado)
        }
        t.fijarEntidad('sorteo', sorteo.id)
        await t.emit('sorteo.premio_no_reclamado', {
            sorteo_id: sorteo.id,
            empresa_id: sorteo.empresa_id,
            ganador_id: ganador.id,
            cliente_id: ganador.cliente_id,
            posicion: ganador.posicion,
            premio_posicion: ganador.premio,
            suplente_id: suplente?.id ?? null,
            motivo,
        })
        const despues = await ganadoresDe(sorteo.id, t.trx)
        await cerrarSiTodoResuelto(t, sorteo, despues)
        return detalleSorteo(sorteo.id, t.trx)
    }
}
