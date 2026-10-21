import { randomBytes } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { cifrar } from '#shared/cifrado'
import { sha256Hex } from '#lealtad/sorteo_v1'
import { detalleSorteo, exigirBasesCompletas, exigirEstado, hashBases, verSorteo } from '#lealtad/sorteos'

/**
 * `sorteos.publicar_bases` (`POST /lealtad/sorteos/:id/publicar-bases`, permiso `sorteos.publicar`):
 * `borrador → bases_publicadas` (§7.3, punto 1). Exige las bases completas (422 `bases_incompletas`
 * con el campo), congela bases, criterios y premios (trigger), calcula `bases_hash` (SHA-256 del JSON
 * canónico), genera la semilla `s` (32 bytes de `crypto.randomBytes`), la guarda cifrada con la clave
 * de la instalación y publica `compromiso = SHA-256(s)`. Desde aquí nadie puede cambiar `s`.
 * Evento `sorteo.bases_publicadas`.
 */

export default class PublicarBasesSorteo extends DomainAction<
    { id: number },
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.publicar_bases'

    protected async handle(input: { id: number }, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['borrador'], 'publicar las bases')
        exigirBasesCompletas(sorteo)
        const basesHash = hashBases(sorteo)
        const semilla = randomBytes(32)
        const compromiso = sha256Hex(semilla)
        await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .update({
                estado: 'bases_publicadas',
                bases_hash: basesHash,
                compromiso,
                semilla_cifrada: cifrar(semilla.toString('hex')),
                publicado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { estado: 'borrador' },
            { estado: 'bases_publicadas', bases_hash: basesHash, compromiso },
        )
        await t.emit('sorteo.bases_publicadas', {
            sorteo_id: sorteo.id,
            empresa_id: sorteo.empresa_id,
            bases_hash: basesHash,
            compromiso,
            fecha_sorteo: new Date(sorteo.fecha_sorteo!).toISOString(),
        })
        return detalleSorteo(sorteo.id, t.trx)
    }
}
