import { randomBytes } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { hashLista } from '#lealtad/sorteo_v1'
import { detalleSorteo, exigirEstado, listaDelCorte, verSorteo } from '#lealtad/sorteos'

/**
 * `sorteos.cerrar_corte` (`POST /lealtad/sorteos/:id/cerrar-corte`, permiso `sorteos.publicar`, en
 * `corte_en` o después; antes, 422 `corte_no_vencido`): `participacion_abierta → corte_cerrado`
 * (§7.3, punto 3). Foto del corte, sin inscripción (decisión del líder):
 *
 * - por criterio: `boletos_por_servicio` boletos por cada servicio `activo` del cliente en la empresa del
 *   sorteo sin facturas `vencida` (fila `origen = criterio` en `sorteos_boletos`);
 * - más los boletos canjeados con puntos (`origen = canje`).
 *
 * Cada cliente con boletos es un participante con un seudónimo aleatorio (`codigo_publico`); la lista
 * va en orden de `codigo_publico` y `lista_hash` = SHA-256 de las líneas `codigo_publico|boletos\n`.
 * Evento `sorteo.corte_cerrado`.
 */

export default class CerrarCorteSorteo extends DomainAction<
    { id: number },
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.cerrar_corte'

    protected async handle(input: { id: number }, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['participacion_abierta'], 'cerrar el corte')
        if (sorteo.corte_en && new Date(sorteo.corte_en).getTime() > Date.now()) {
            throw new ReglaNegocio(
                `El corte del sorteo ${sorteo.id} es el ${new Date(sorteo.corte_en).toISOString()}`,
                'corte_no_vencido',
            )
        }

        // boletos por criterio: servicios activos sin facturas vencidas, en la empresa del sorteo
        const porServicio = sorteo.criterios.boletos_por_servicio
        if (porServicio > 0) {
            const alDia = (await t.trx
                .from('core.servicios as s')
                .where('s.empresa_id', sorteo.empresa_id)
                .where('s.estado', 'activo')
                .whereNotExists((q) =>
                    q
                        .from('billing.facturas as f')
                        .whereRaw('f.servicio_id = s.id')
                        .where('f.estado', 'vencida'),
                )
                .groupBy('s.cliente_id')
                .orderBy('s.cliente_id', 'asc')
                .select('s.cliente_id', t.trx.raw('count(*)::int as servicios'))) as Array<{
                cliente_id: number
                servicios: number
            }>
            for (const fila of alDia) {
                await t.trx
                    .insertQuery()
                    .table('lealtad.sorteos_boletos')
                    .insert({
                        sorteo_id: sorteo.id,
                        cliente_id: fila.cliente_id,
                        boletos: Number(fila.servicios) * porServicio,
                        origen: 'criterio',
                    })
            }
        }

        const totales = (await t.trx
            .from('lealtad.sorteos_boletos')
            .where('sorteo_id', sorteo.id)
            .groupBy('cliente_id')
            .select('cliente_id', t.trx.raw('sum(boletos)::int as boletos'))) as Array<{
            cliente_id: number
            boletos: number
        }>
        const usados = new Set<string>()
        const participantes = totales
            .map((f) => {
                let codigo: string
                do codigo = `S${randomBytes(5).toString('hex').toUpperCase()}`
                while (usados.has(codigo))
                usados.add(codigo)
                return { cliente_id: Number(f.cliente_id), boletos: Number(f.boletos), codigo }
            })
            .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
        for (const [i, p] of participantes.entries()) {
            const servicio = (await t.trx
                .from('core.servicios')
                .where({ cliente_id: p.cliente_id, empresa_id: sorteo.empresa_id })
                .whereNot('estado', 'retirado')
                .orderBy('id', 'asc')
                .select('id')
                .first()) as { id: number } | null
            await t.trx
                .insertQuery()
                .table('lealtad.sorteos_participantes')
                .insert({
                    sorteo_id: sorteo.id,
                    orden: i + 1,
                    cliente_id: p.cliente_id,
                    servicio_id: servicio ? Number(servicio.id) : null,
                    codigo_publico: p.codigo,
                    boletos: p.boletos,
                })
        }
        const lista = await listaDelCorte(t.trx, sorteo.id)
        const listaHash = hashLista(lista)
        const boletos = lista.reduce((s, p) => s + p.boletos, 0)
        await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .update({
                estado: 'corte_cerrado',
                lista_hash: listaHash,
                corte_cerrado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        // los hashes quedan en audit.cambios (y en el resultado auditado) antes del sorteo
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { estado: sorteo.estado },
            { estado: 'corte_cerrado', lista_hash: listaHash, participantes: lista.length, boletos },
        )
        await t.emit('sorteo.corte_cerrado', {
            sorteo_id: sorteo.id,
            empresa_id: sorteo.empresa_id,
            participantes: lista.length,
            boletos,
            lista_hash: listaHash,
        })
        return detalleSorteo(sorteo.id, t.trx)
    }
}
