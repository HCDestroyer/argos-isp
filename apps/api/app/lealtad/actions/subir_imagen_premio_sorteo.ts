import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { detalleSorteo, exigirEstado, verSorteo } from '#lealtad/sorteos'
import { prepararArchivo, registrarArchivo } from '#lealtad/sorteos_archivos'

/**
 * `sorteos.subir_imagen_premio` (`POST /lealtad/sorteos/:id/premios/:posicion/imagen`, multipart
 * `imagen`, permiso `sorteos.gestionar`): la imagen de un premio, solo en `borrador` (los premios se
 * congelan al publicar las bases: la imagen entra en `bases_hash` por su ruta). Las mismas reglas que
 * las imágenes de los anuncios del portal: PNG, JPEG o WebP por firma, hasta 1 MB y de 64 a 4096 px.
 * La imagen se sirve por el mismo origen (`GET /lealtad/sorteos/:id/premios/:posicion/imagen` en el
 * panel y `GET /portal/sorteos/:id/premios/:posicion/imagen` en el portal): el portal no carga URLs
 * externas (CSP y walled garden).
 */

export interface EntradaImagenPremio {
    sorteo_id: number
    posicion: number
    nombre: string
    contenido: Uint8Array
}

export default class SubirImagenPremioSorteo extends DomainAction<
    EntradaImagenPremio,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.subir_imagen_premio'

    protected async handle(input: EntradaImagenPremio, t: Transaccion) {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const sorteo = await verSorteo(input.sorteo_id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['borrador'], 'cambiar la imagen de un premio')
        const premio = sorteo.premios.find((p) => p.posicion === input.posicion)
        if (!premio) throw new NoEncontrado(`El sorteo ${sorteo.id} no tiene el premio ${input.posicion}`)
        const preparado = prepararArchivo(input.contenido, 'imagen_premio', 'imagen')
        const archivo = await registrarArchivo(t, sorteo, 'imagen_premio', input.nombre, preparado)
        const url = `/api/v1/lealtad/sorteos/${sorteo.id}/premios/${premio.posicion}/imagen`
        await t.trx
            .from('lealtad.sorteos_premios')
            .where('id', premio.id)
            .update({ imagen_archivo_id: archivo.id, imagen_url: url })
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { [`premio_${premio.posicion}_imagen`]: premio.imagen_archivo_id },
            { [`premio_${premio.posicion}_imagen`]: `${archivo.id} (SHA-256 ${archivo.sha256})` },
        )
        return detalleSorteo(sorteo.id, t.trx)
    }
}
