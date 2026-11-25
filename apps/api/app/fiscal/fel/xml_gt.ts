import { DateTime } from 'luxon'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import type { DteCertificado, DteParaEnviar, LineaDte } from '#fiscal/fel/proveedor'

/**
 * XML de la SAT de Guatemala para la FEL (esquema `GT_Documento` y `GT_AnulacionDocumento`), común
 * a todos los certificadores (contrato §8.1): el adaptador solo lo firma y lo envía.
 *
 * Armado según los ejemplos de XML de la «Documentación INFILE (docs.infile.com, sección
 * Guatemala)» (`contratos/fel-establecimientos.md` B6, lote 5): unidad de medida `UND`, emisor con
 * `DireccionEmisor` en nodos separados, complemento de notas `Notas` con `cno:ReferenciasNota`,
 * contingencia con `NumeroAcceso` (100 000 000 a 999 999 999) y la anulación
 * `GTAnulacionDocumento`. Lo que el ambiente demo de INFILE aceptó (lote 6) queda anotado en
 * `localizacion-fiscal.md` §17. Las pruebas automáticas nunca llaman a la SAT ni a INFILE.
 */

export const NS_DTE = 'http://www.sat.gob.gt/dte/fel/0.2.0'
export const NS_ANULACION = 'http://www.sat.gob.gt/dte/fel/0.1.0'
export const NS_REFERENCIA = 'http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0'

/** Complemento de NCRE y NDEB como en los ejemplos de INFILE. */
export const COMPLEMENTO_NOTAS = {
    IDComplemento: 'Notas',
    NombreComplemento: 'Notas',
    URIComplemento: 'http://www.sat.gob.gt/fel/notas.xsd',
} as const

/** Unidad de medida de las líneas (`UND` en todos los ejemplos de INFILE). */
export const UNIDAD_MEDIDA = 'UND'

/** Fecha y hora con la zona de Guatemala (`2026-11-25T12:00:00-06:00`), como la piden los XML. */
export function fechaHoraGt(instante: Date): string {
    return DateTime.fromJSDate(instante).setZone(ZONA_NEGOCIO).toISO({ suppressMilliseconds: true })!
}

export function escaparXml(valor: string | number | null | undefined): string {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function atributos(valores: Record<string, string | number | null | undefined>): string {
    return Object.entries(valores)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => ` ${k}="${escaparXml(v)}"`)
        .join('')
}

/** El pequeño contribuyente (FPEQ, FCAP) no desglosa IVA. */
export function desglosaIva(tipo: DteParaEnviar['tipo']): boolean {
    return tipo !== 'FPEQ' && tipo !== 'FCAP'
}

function item(linea: LineaDte, conIva: boolean): string {
    const impuestos = conIva
        ? '<dte:Impuestos><dte:Impuesto>' +
          '<dte:NombreCorto>IVA</dte:NombreCorto>' +
          '<dte:CodigoUnidadGravable>1</dte:CodigoUnidadGravable>' +
          `<dte:MontoGravable>${linea.gravable}</dte:MontoGravable>` +
          `<dte:MontoImpuesto>${linea.iva}</dte:MontoImpuesto>` +
          '</dte:Impuesto></dte:Impuestos>'
        : ''
    return (
        `<dte:Item${atributos({ BienOServicio: linea.bien_o_servicio, NumeroLinea: linea.numero })}>` +
        `<dte:Cantidad>${escaparXml(linea.cantidad)}</dte:Cantidad>` +
        `<dte:UnidadMedida>${escaparXml(linea.unidad)}</dte:UnidadMedida>` +
        `<dte:Descripcion>${escaparXml(linea.descripcion)}</dte:Descripcion>` +
        `<dte:PrecioUnitario>${linea.precio_unitario}</dte:PrecioUnitario>` +
        `<dte:Precio>${linea.precio}</dte:Precio>` +
        `<dte:Descuento>${linea.descuento}</dte:Descuento>` +
        impuestos +
        `<dte:Total>${linea.total}</dte:Total>` +
        '</dte:Item>'
    )
}

/** XML del DTE sin firmar (`GTDocumento`). */
export function xmlDte(dte: DteParaEnviar): string {
    const conIva = desglosaIva(dte.tipo)
    const e = dte.emisor
    const r = dte.receptor
    const tipoEspecial = r.tipo === 'cui' ? 'CUI' : r.tipo === 'pasaporte' ? 'EXT' : null
    const frases = dte.frases.length
        ? '<dte:Frases>' +
          dte.frases
              .map((f) => `<dte:Frase${atributos({ CodigoEscenario: f.escenario, TipoFrase: f.tipo })}/>`)
              .join('') +
          '</dte:Frases>'
        : ''
    const totales =
        '<dte:Totales>' +
        (conIva
            ? `<dte:TotalImpuestos><dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${dte.iva}"/></dte:TotalImpuestos>`
            : '') +
        `<dte:GranTotal>${dte.total}</dte:GranTotal>` +
        '</dte:Totales>'
    const complementos = dte.referencia
        ? '<dte:Complementos>' +
          `<dte:Complemento${atributos(COMPLEMENTO_NOTAS)}>` +
          `<cno:ReferenciasNota xmlns:cno="${NS_REFERENCIA}"${atributos({
              FechaEmisionDocumentoOrigen: dte.referencia.fecha,
              MotivoAjuste: dte.referencia.motivo,
              NumeroAutorizacionDocumentoOrigen: dte.referencia.autorizacion,
              NumeroDocumentoOrigen: dte.referencia.numero,
              SerieDocumentoOrigen: dte.referencia.serie,
              Version: '0.0',
          })}/>` +
          '</dte:Complemento></dte:Complementos>'
        : ''
    return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<dte:GTDocumento xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:dte="${NS_DTE}" Version="0.1">` +
        '<dte:SAT ClaseDocumento="dte"><dte:DTE ID="DatosCertificados"><dte:DatosEmision ID="DatosEmision">' +
        `<dte:DatosGenerales${atributos({
            CodigoMoneda: dte.moneda,
            FechaHoraEmision: dte.fecha_emision,
            Tipo: dte.tipo,
            NumeroAcceso: dte.contingencia ? numeroAcceso(dte.identificador) : null,
        })}/>` +
        `<dte:Emisor${atributos({
            AfiliacionIVA: e.afiliacion_iva,
            CodigoEstablecimiento: e.establecimiento,
            CorreoEmisor: e.correo,
            NITEmisor: e.nit,
            NombreComercial: e.nombre_comercial,
            NombreEmisor: e.nombre,
        })}>` +
        '<dte:DireccionEmisor>' +
        `<dte:Direccion>${escaparXml(e.direccion)}</dte:Direccion>` +
        `<dte:CodigoPostal>${escaparXml(e.codigo_postal)}</dte:CodigoPostal>` +
        `<dte:Municipio>${escaparXml(e.municipio)}</dte:Municipio>` +
        `<dte:Departamento>${escaparXml(e.departamento)}</dte:Departamento>` +
        '<dte:Pais>GT</dte:Pais></dte:DireccionEmisor></dte:Emisor>' +
        `<dte:Receptor${atributos({
            CorreoReceptor: r.correo,
            IDReceptor: r.id,
            NombreReceptor: r.nombre,
            TipoEspecial: tipoEspecial,
        })}>` +
        '<dte:DireccionReceptor>' +
        `<dte:Direccion>${escaparXml(r.direccion ?? 'Ciudad')}</dte:Direccion>` +
        '<dte:CodigoPostal>01001</dte:CodigoPostal><dte:Municipio>Guatemala</dte:Municipio>' +
        '<dte:Departamento>Guatemala</dte:Departamento><dte:Pais>GT</dte:Pais>' +
        '</dte:DireccionReceptor></dte:Receptor>' +
        frases +
        `<dte:Items>${dte.lineas.map((l) => item(l, conIva)).join('')}</dte:Items>` +
        totales +
        complementos +
        '</dte:DatosEmision></dte:DTE></dte:SAT></dte:GTDocumento>'
    )
}

/**
 * Número de acceso de contingencia (9 dígitos) derivado del identificador: estable para el mismo
 * DTE. **Confirmar**: el procedimiento oficial de contingencia no se verificó (NO VERIFICADO 7).
 */
export function numeroAcceso(identificador: string): string {
    const digitos = identificador.replace(/[^0-9]/g, '').padEnd(9, '0')
    return String(100_000_000 + (Number(digitos.slice(0, 8)) % 900_000_000)).slice(0, 9)
}

/**
 * Forma del XML de anulación: `documentada` (elementos hijos de `dte:DatosAnulacion`, namespace
 * `0.2.0`, como el manual de INFILE) o `atributos` (`dte:DatosGenerales` con atributos, namespace
 * `0.1.0`, la forma anterior de Argos). El lote 6 prueba las dos en el ambiente demo.
 */
export type FormaAnulacion = 'documentada' | 'atributos'

/** XML de la anulación (`GTAnulacionDocumento`). `dte.fecha_emision` es la que se envió al certificar. */
export function xmlAnulacion(
    dte: DteCertificado,
    motivo: string,
    fechaAnulacion: Date,
    forma: FormaAnulacion = 'documentada',
): string {
    const anulacion = fechaHoraGt(fechaAnulacion)
    if (forma === 'atributos') {
        return (
            '<?xml version="1.0" encoding="UTF-8"?>' +
            `<dte:GTAnulacionDocumento xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:dte="${NS_ANULACION}" Version="0.1">` +
            '<dte:SAT><dte:AnulacionDTE ID="DatosCertificados">' +
            `<dte:DatosGenerales${atributos({
                ID: 'DatosAnulacion',
                NumeroDocumentoAAnular: dte.autorizacion,
                NITEmisor: dte.emisor_nit,
                IDReceptor: dte.receptor_id,
                FechaEmisionDocumentoAnular: dte.fecha_emision,
                FechaHoraAnulacion: anulacion,
                MotivoAnulacion: motivo,
            })}/>` +
            '</dte:AnulacionDTE></dte:SAT></dte:GTAnulacionDocumento>'
        )
    }
    return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<dte:GTAnulacionDocumento xmlns:dte="${NS_DTE}" Version="0.1">` +
        '<dte:SAT><dte:AnulacionDTE ID="DatosCertificados"><dte:DatosAnulacion ID="DatosAnulacion">' +
        `<dte:NumeroDocumentoAAnular>${escaparXml(dte.autorizacion)}</dte:NumeroDocumentoAAnular>` +
        `<dte:NITEmisor>${escaparXml(dte.emisor_nit)}</dte:NITEmisor>` +
        `<dte:IDReceptor>${escaparXml(dte.receptor_id)}</dte:IDReceptor>` +
        `<dte:FechaEmisionDocumentoAnular>${escaparXml(dte.fecha_emision)}</dte:FechaEmisionDocumentoAnular>` +
        `<dte:FechaAnulacion>${escaparXml(anulacion)}</dte:FechaAnulacion>` +
        `<dte:MotivoAnulacion>${escaparXml(motivo)}</dte:MotivoAnulacion>` +
        '</dte:DatosAnulacion></dte:AnulacionDTE></dte:SAT></dte:GTAnulacionDocumento>'
    )
}
