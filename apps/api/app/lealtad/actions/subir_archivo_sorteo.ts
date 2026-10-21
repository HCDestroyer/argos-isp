import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verSorteo } from '#lealtad/sorteos'
import { prepararArchivo, registrarArchivo, type ArchivoSorteo } from '#lealtad/sorteos_archivos'

/**
 * `sorteos.subir_archivo` (`POST /lealtad/sorteos/:id/archivos`, multipart `archivo` + `uso`, permiso
 * `sorteos.marcar_requisito`): guarda una evidencia del checklist (§8) o la constancia firmada de una
 * entrega (§7.4). PDF, JPEG, PNG o WebP por firma, hasta 5 MB, con su SHA-256. Solo inserción: el
 * archivo no se reemplaza ni se borra; luego se cita en `POST .../requisitos/:clave` (`archivo_id`) o
 * en la entrega (`constancia_archivo_id`). En la auditoría queda solo la huella.
 */

export interface EntradaSubirArchivo {
    sorteo_id: number
    uso: 'evidencia' | 'constancia'
    nombre: string
    contenido: Uint8Array
}

export default class SubirArchivoSorteo extends DomainAction<EntradaSubirArchivo, ArchivoSorteo> {
    readonly nombre = 'sorteos.subir_archivo'

    protected async handle(input: EntradaSubirArchivo, t: Transaccion): Promise<ArchivoSorteo> {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const sorteo = await verSorteo(input.sorteo_id, t.trx)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        const preparado = prepararArchivo(input.contenido, input.uso)
        const archivo = await registrarArchivo(t, sorteo, input.uso, input.nombre, preparado)
        await t.registrarCambios({ tipo: 'sorteo_archivo', id: archivo.id }, null, {
            uso: archivo.uso,
            nombre: archivo.nombre,
            tipo: archivo.tipo,
            tamano: archivo.tamano,
            sha256: archivo.sha256,
        })
        return archivo
    }
}
