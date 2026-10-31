import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { verOrdenTraslado, type OrdenTrasladoDetalle } from '#inventario/ordenes_traslado'
import {
    ArchivoAdjunto,
    borrarArchivoInventario,
    guardarArchivoInventario,
    tipoDocumentoFirmado,
} from '#inventario/archivos'

/**
 * `inventario.adjuntar_documento_traslado` (`POST /inventario/traslados/:id/documento`; fase D, `contratos/inventario.md` D.1): la foto o el escaneo del papel
 * firmado de una orden recibida con `firma_papel`, una sola vez (409 `documento_registrado`). JPG, PNG,
 * WebP o PDF por su contenido, hasta 5 MB, guardado en el almacén con SHA-256 (en la auditoría solo su
 * huella).
 */

export interface EntradaAdjuntarDocumento {
    id: number
    archivo: ArchivoAdjunto
    /** nota de quien adjunta (solo auditoría) */
    nota?: string | null
}

export default class AdjuntarDocumentoTraslado extends DomainAction<
    EntradaAdjuntarDocumento,
    OrdenTrasladoDetalle
> {
    readonly nombre = 'inventario.adjuntar_documento_traslado'

    protected async handle(input: EntradaAdjuntarDocumento, t: Transaccion): Promise<OrdenTrasladoDetalle> {
        t.fijarEntidad('orden_traslado', input.id)
        const orden = (await t.trx
            .from('inventario.ordenes_traslado')
            .where('id', input.id)
            .forUpdate()
            .select('id', 'empresa_id', 'numero', 'metodo_recepcion', 'documento_sha256')
            .first()) as {
            id: number
            empresa_id: number
            numero: number
            metodo_recepcion: string | null
            documento_sha256: string | null
        } | null
        if (!orden) throw new NoEncontrado(`La orden de traslado ${input.id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(orden.empresa_id))
        t.fijarEmpresa(Number(orden.empresa_id))
        if (orden.metodo_recepcion !== 'firma_papel') {
            throw new Conflicto(
                `La orden ${orden.numero} no se recibió con firma en papel`,
                'no_es_firma_papel',
                'Sin firma en papel',
            )
        }
        if (orden.documento_sha256) {
            throw new Conflicto(
                `La orden ${orden.numero} ya tiene su documento firmado (${orden.documento_sha256.slice(0, 12)})`,
                'documento_registrado',
                'Documento ya registrado',
            )
        }
        const tipo = tipoDocumentoFirmado(input.archivo)
        const ruta = await guardarArchivoInventario('documentos', tipo, input.archivo.contenido)
        try {
            await t.trx
                .from('inventario.ordenes_traslado')
                .where('id', orden.id)
                .update({
                    documento_ruta: ruta,
                    documento_sha256: input.archivo.sha256,
                    documento_tipo: tipo,
                    documento_tamano: input.archivo.contenido.length,
                    documento_por: usuarioDelActor(t.ctx.actor),
                    documento_en: t.trx.knexRawQuery('now()'),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'orden_traslado', id: orden.id },
                { documento_sha256: null },
                { documento_sha256: input.archivo.sha256 },
            )
            return await verOrdenTraslado(orden.id, t.trx)
        } catch (error) {
            await borrarArchivoInventario(ruta)
            throw error
        }
    }
}
