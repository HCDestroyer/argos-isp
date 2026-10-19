import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import { filaDeAnuncio, verAnuncio, type AnuncioVista } from '#portal/anuncios'
import type { EntradaCambioEstadoAnuncio } from '#portal/actions/publicar_anuncio'

/**
 * Archiva un anuncio (borrador o publicado): deja de verse en el portal en la siguiente lectura y
 * conserva sus métricas. Ya archivado: no cambia nada. 409 por `version`.
 */
export default class ArchivarAnuncio extends DomainAction<EntradaCambioEstadoAnuncio, AnuncioVista> {
    readonly nombre = 'anuncios.archivar'

    protected async handle(input: EntradaCambioEstadoAnuncio, t: Transaccion): Promise<AnuncioVista> {
        t.fijarEntidad('anuncio', input.id)
        const antes = await filaDeAnuncio(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id)
        if (antes.estado === 'archivado') return verAnuncio(input.id, t.trx)

        await actualizarConVersion(t.trx, 'core.anuncios', input.id, input.version, {
            estado: 'archivado',
            archivado_en: t.trx.knexRawQuery('now()'),
        })
        await t.registrarCambios(
            { tipo: 'anuncio', id: input.id },
            { estado: antes.estado },
            { estado: 'archivado' },
        )
        return verAnuncio(input.id, t.trx)
    }
}
