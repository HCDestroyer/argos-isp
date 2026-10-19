import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import {
    filaDeAnuncio,
    validarCombinacion,
    verAnuncio,
    type AnuncioVista,
    type CamposAnuncio,
} from '#portal/anuncios'

export interface EntradaEditarAnuncio extends CamposAnuncio {
    id: number
    version: number
}

const EDITABLES = [
    'titulo',
    'texto',
    'imagen_alt',
    'boton_texto',
    'boton_url',
    'inicio',
    'fin',
    'audiencia',
    'lugares',
    'orden',
] as const

/**
 * Edita un anuncio en borrador o publicado (un publicado cambia en el portal en la siguiente
 * lectura). Solo los campos enviados; `null` borra los opcionales. Archivado: 422
 * `anuncio_archivado` (se vuelve a publicar primero). 409 por `version`.
 */
export default class EditarAnuncio extends DomainAction<EntradaEditarAnuncio, AnuncioVista> {
    readonly nombre = 'anuncios.editar'

    protected async handle(input: EntradaEditarAnuncio, t: Transaccion): Promise<AnuncioVista> {
        t.fijarEntidad('anuncio', input.id)
        const antes = await filaDeAnuncio(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id)
        if (antes.estado === 'archivado') {
            throw new ReglaNegocio(
                'Un anuncio archivado no se edita; publícalo de nuevo primero',
                'anuncio_archivado',
            )
        }

        const cambios: Record<string, unknown> = {}
        for (const campo of EDITABLES) {
            if (input[campo] !== undefined) cambios[campo] = input[campo]
        }
        if (cambios.imagen_alt !== undefined && !antes.imagen) delete cambios.imagen_alt
        const final = { ...antes, ...cambios } as typeof antes
        validarCombinacion(final)

        await actualizarConVersion(t.trx, 'core.anuncios', input.id, input.version, cambios)
        const previos: Record<string, unknown> = {}
        for (const campo of Object.keys(cambios)) previos[campo] = antes[campo as keyof typeof antes]
        await t.registrarCambios({ tipo: 'anuncio', id: input.id }, previos, cambios)
        return verAnuncio(input.id, t.trx)
    }
}
