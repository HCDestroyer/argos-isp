import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto } from '#shared/errores'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import {
    ArchivoAdjunto,
    borrarArchivoInventario,
    guardarArchivoInventario,
    tipoFacturaCompra,
} from '#inventario/archivos'
import type { Confianza, ExtraccionCompra } from '#inventario/facturas_compra/extraccion'
import { parsearFel } from '#inventario/facturas_compra/fel_xml'
import { ErrorIa, extractorDe, type ArchivoParaIa } from '#inventario/facturas_compra/ia'
import {
    exigirFacturaNueva,
    nitLimpio,
    proponer,
    verBorrador,
    type BorradorVista,
} from '#inventario/facturas_compra/borradores'

/**
 * `compras.cargar_borrador` (`POST /compras/borradores`, fase D, `contratos/inventario.md` D.5): sube
 * una factura de compra y arma un **borrador** con sus datos y una propuesta de proveedor y productos.
 * Nunca crea la compra: eso lo hace `compras.confirmar_borrador` después de que el usuario revise.
 *
 * - XML (FEL de la SAT) → parser determinístico (422 `xml_no_fel` si no es un DTE).
 * - PDF o imagen → IA del proveedor configurado. Si no hay o falla, el borrador se crea igual, vacío,
 *   con `error_extraccion` visible (`ia_no_configurada: …`, `ia_fallo: …`) para capturar a mano.
 * - Sin archivo → borrador `manual` vacío.
 * - El archivo va al almacén con SHA-256; el mismo archivo vivo dos veces: 409 `archivo_duplicado`. La
 *   misma factura (NIT, serie y número) ya registrada: 409 `compra_duplicada` o `borrador_duplicado`.
 */

export interface EntradaCargarBorrador {
    empresa_id?: number | null
    archivo?: ArchivoAdjunto | null
}

export default class CargarBorradorCompra extends DomainAction<EntradaCargarBorrador, BorradorVista> {
    readonly nombre = 'compras.cargar_borrador'

    protected async handle(input: EntradaCargarBorrador, t: Transaccion): Promise<BorradorVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        let fuente: 'xml_fel' | 'ia' | 'manual' = 'manual'
        let extraccion: ExtraccionCompra | null = null
        let confianza: Confianza | null = null
        let errorExtraccion: string | null = null
        let ia: { proveedor: string; modelo: string } | null = null
        const archivo = input.archivo ?? null
        const tipo = archivo ? tipoFacturaCompra(archivo) : null
        if (archivo) {
            const repetido = await t.trx
                .from('inventario.compras_borradores')
                .where({ empresa_id: empresaId, archivo_sha256: archivo.sha256 })
                .whereNot('estado', 'descartado')
                .select('id')
                .first()
            if (repetido) {
                throw new Conflicto(
                    `Ese archivo ya está cargado en el borrador ${repetido.id}`,
                    'archivo_duplicado',
                    'Archivo ya cargado',
                )
            }
            if (tipo === 'application/xml') {
                fuente = 'xml_fel'
                extraccion = parsearFel(archivo.contenido)
            } else {
                fuente = 'ia'
                try {
                    const extractor = await extractorDe(empresaId, t.trx)
                    ia = { proveedor: extractor.proveedor, modelo: extractor.modelo }
                    const resultado = await extractor.extraer({
                        contenido: archivo.contenido,
                        tipo: tipo as ArchivoParaIa['tipo'],
                    })
                    extraccion = resultado.datos
                    confianza = resultado.confianza
                } catch (error) {
                    if (!(error instanceof ErrorIa)) throw error
                    errorExtraccion = `${error.codigo}: ${error.message}`
                }
            }
        }
        if (extraccion) {
            await exigirFacturaNueva(t.trx, empresaId, {
                nit: extraccion.emisor.nit,
                serie: extraccion.serie,
                numero: extraccion.numero,
            })
        }
        const datos = extraccion ?? {}
        const propuesta = await proponer(t.trx, empresaId, datos)
        const ruta =
            archivo && tipo ? await guardarArchivoInventario('compras', tipo, archivo.contenido) : null
        try {
            const [fila] = (await t.trx
                .insertQuery()
                .table('inventario.compras_borradores')
                .insert({
                    empresa_id: empresaId,
                    fuente,
                    archivo_ruta: ruta,
                    archivo_sha256: archivo?.sha256 ?? null,
                    archivo_tipo: tipo,
                    archivo_tamano: archivo?.contenido.length ?? null,
                    archivo_nombre: archivo?.nombre?.slice(0, 200) ?? null,
                    extraccion: extraccion ? JSON.stringify(extraccion) : null,
                    confianza: confianza ? JSON.stringify(confianza) : null,
                    error_extraccion: errorExtraccion,
                    ia_proveedor: ia?.proveedor ?? null,
                    ia_modelo: ia?.modelo ?? null,
                    datos: JSON.stringify(datos),
                    propuesta: JSON.stringify(propuesta),
                    emisor_nit: extraccion ? nitLimpio(extraccion.emisor.nit) : null,
                    serie: extraccion?.serie ?? null,
                    numero: extraccion?.numero ?? null,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })
                .returning('id')) as Array<{ id: number }>
            const id = Number(fila!.id)
            t.fijarEntidad('borrador_compra', id)
            t.anotarAuditoria({
                fuente,
                error_extraccion: errorExtraccion,
                ia_proveedor: ia?.proveedor ?? null,
            })
            return await verBorrador(id, t.trx)
        } catch (error) {
            if (ruta) await borrarArchivoInventario(ruta)
            throw error
        }
    }
}
