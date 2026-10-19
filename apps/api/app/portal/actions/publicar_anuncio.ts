import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import { filaDeAnuncio, verAnuncio, type AnuncioVista } from '#portal/anuncios'

export interface EntradaCambioEstadoAnuncio {
    id: number
    version: number
}

/**
 * Publica un anuncio en borrador o archivado: desde ese momento el portal lo muestra dentro de su
 * vigencia, en sus lugares y a su audiencia. Ya publicado: no cambia nada. Con un `fin` ya pasado:
 * 422 `anuncio_vencido`. 409 por `version`.
 */
export default class PublicarAnuncio extends DomainAction<EntradaCambioEstadoAnuncio, AnuncioVista> {
    readonly nombre = 'anuncios.publicar'

    protected async handle(input: EntradaCambioEstadoAnuncio, t: Transaccion): Promise<AnuncioVista> {
        t.fijarEntidad('anuncio', input.id)
        const antes = await filaDeAnuncio(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id)
        if (antes.estado === 'publicado') return verAnuncio(input.id, t.trx)
        if (antes.fin && antes.fin.getTime() <= Date.now()) {
            throw new ReglaNegocio('Su fecha de fin ya pasó; cámbiala antes de publicar', 'anuncio_vencido')
        }

        await actualizarConVersion(t.trx, 'core.anuncios', input.id, input.version, {
            estado: 'publicado',
            publicado_en: t.trx.knexRawQuery('now()'),
            archivado_en: null,
        })
        await t.registrarCambios(
            { tipo: 'anuncio', id: input.id },
            { estado: antes.estado },
            { estado: 'publicado' },
        )
        return verAnuncio(input.id, t.trx)
    }
}
