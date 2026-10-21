import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import { filaDeAnuncio, verAnuncio, type AnuncioVista } from '#portal/anuncios'
import {
    borrarImagenAnuncio,
    guardarImagenAnuncio,
    nuevaRutaImagen,
    prepararImagenAnuncio,
} from '#portal/anuncios_imagenes'

export interface EntradaCambiarImagenAnuncio {
    id: number
    version: number
    /** contenido del archivo subido (se ignora con `quitar`) */
    contenido: Uint8Array
    /** texto alternativo (obligatorio con imagen) */
    alt?: string
    quitar?: boolean
}

/**
 * Sube o quita la imagen de un anuncio: PNG, JPEG o WebP por firma, hasta 1 MB (422 en `imagen`),
 * con texto alternativo obligatorio (422 en `alt`). El archivo va al almacenamiento de archivos; la
 * fila guarda ruta, tipo, tamaño y ETag. El anterior se borra después del COMMIT; si la transacción
 * falla, se borra el nuevo. El diff guarda la huella, nunca la ruta.
 */
export default class CambiarImagenAnuncio extends DomainAction<EntradaCambiarImagenAnuncio, AnuncioVista> {
    readonly nombre = 'anuncios.cambiar_imagen'

    protected async handle(input: EntradaCambiarImagenAnuncio, t: Transaccion): Promise<AnuncioVista> {
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

        let cambios: Record<string, unknown> = {
            imagen: null,
            imagen_tipo: null,
            imagen_etag: null,
            imagen_ancho: null,
            imagen_alto: null,
            imagen_alt: null,
        }
        let nueva: string | null = null
        if (!input.quitar) {
            const alt = (input.alt ?? antes.imagen_alt ?? '').trim()
            if (alt === '') {
                throw new ValidacionFallida([
                    { field: 'alt', message: 'Describe la imagen para quien no la ve', rule: 'required' },
                ])
            }
            const imagen = prepararImagenAnuncio(input.contenido)
            nueva = nuevaRutaImagen(antes.empresa_id, imagen.tipo)
            await guardarImagenAnuncio(nueva, imagen.contenido)
            cambios = {
                imagen: nueva,
                imagen_tipo: imagen.tipo,
                imagen_etag: imagen.etag,
                imagen_ancho: imagen.ancho,
                imagen_alto: imagen.alto,
                imagen_alt: alt,
            }
        }
        try {
            await actualizarConVersion(t.trx, 'core.anuncios', input.id, input.version, cambios)
            await t.registrarCambios(
                { tipo: 'anuncio', id: input.id },
                { imagen: antes.imagen_etag, imagen_alt: antes.imagen_alt },
                { imagen: cambios.imagen_etag, imagen_alt: cambios.imagen_alt },
            )
            const previa = antes.imagen
            if (previa && previa !== nueva) t.alConfirmar(() => borrarImagenAnuncio(previa))
            return await verAnuncio(input.id, t.trx)
        } catch (error) {
            if (nueva) await borrarImagenAnuncio(nueva)
            throw error
        }
    }
}
