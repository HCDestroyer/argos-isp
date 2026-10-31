import { DomUtils, ElementType, parseDocument } from 'htmlparser2'
import { ValidacionFallida } from '#shared/errores'
import {
    aCantidadTexto,
    aMonto,
    type ExtraccionCompra,
    type LineaExtraida,
} from '#inventario/facturas_compra/extraccion'

type Element = ReturnType<typeof DomUtils.getElementsByTagName>[number]

/**
 * Parser determinístico del XML de un DTE de la SAT de Guatemala (FEL, esquema `GTDocumento`): fase D,
 * `contratos/inventario.md` D.5. Usa `htmlparser2` en modo XML (ya es dependencia): sin red, sin IA.
 *
 * Lee `SAT/DTE/DatosEmision`: `DatosGenerales` (Tipo, FechaHoraEmision, CodigoMoneda), `Emisor`
 * (NITEmisor, NombreEmisor o NombreComercial), `Receptor` (IDReceptor, NombreReceptor), cada `Item`
 * (BienOServicio, Cantidad, UnidadMedida, Descripcion, PrecioUnitario, Precio, Descuento, el
 * `MontoImpuesto` del impuesto IVA y Total), `Totales` (GranTotal y el IVA de TotalImpuestos) y
 * `Certificacion/NumeroAutorizacion` (atributos `Serie` y `Numero`, texto = UUID). Los prefijos de
 * espacio de nombres (`dte:`) se ignoran. Un XML que no es un DTE: 422 `archivo` `xml_no_fel`.
 */

function local(nombre: string): string {
    const i = nombre.indexOf(':')
    return (i === -1 ? nombre : nombre.slice(i + 1)).toLowerCase()
}

function hijos(padre: Element | null | undefined, nombre: string): Element[] {
    if (!padre) return []
    return DomUtils.getChildren(padre).filter(
        (n): n is Element =>
            n.type === ElementType.Tag && local((n as Element).name) === nombre.toLowerCase(),
    )
}

function hijo(padre: Element | null | undefined, nombre: string): Element | null {
    return hijos(padre, nombre)[0] ?? null
}

function buscar(raiz: Element | null | undefined, nombre: string): Element | null {
    if (!raiz) return null
    return (
        (DomUtils.findOne((n) => local(n.name) === nombre.toLowerCase(), [raiz], true) as Element | null) ??
        null
    )
}

function texto(nodo: Element | null | undefined): string | null {
    if (!nodo) return null
    const valor = DomUtils.textContent(nodo).trim()
    return valor === '' ? null : valor
}

function atributo(nodo: Element | null | undefined, nombre: string): string | null {
    if (!nodo) return null
    const clave = Object.keys(nodo.attribs).find((k) => local(k) === nombre.toLowerCase())
    const valor = clave ? nodo.attribs[clave]?.trim() : undefined
    return valor ? valor : null
}

function noEsFel(detalle: string): ValidacionFallida {
    return new ValidacionFallida([
        { field: 'archivo', message: `El XML no es un DTE FEL: ${detalle}`, rule: 'xml_no_fel' },
    ])
}

export function parsearFel(contenido: Buffer | string): ExtraccionCompra {
    const xml = (typeof contenido === 'string' ? contenido : contenido.toString('utf8')).replace(
        /^\uFEFF/,
        '',
    )
    const documento = parseDocument(xml, { xmlMode: true })
    const raiz = DomUtils.findOne(
        (n) => local(n.name) === 'gtdocumento',
        documento.children,
        true,
    ) as Element | null
    if (!raiz) throw noEsFel('falta GTDocumento')
    const emision = buscar(raiz, 'DatosEmision')
    if (!emision) throw noEsFel('falta DatosEmision')
    const generales = hijo(emision, 'DatosGenerales')
    const emisor = hijo(emision, 'Emisor')
    const receptor = hijo(emision, 'Receptor')
    const tipo = atributo(generales, 'Tipo')
    const fechaHora = atributo(generales, 'FechaHoraEmision')
    const nit = atributo(emisor, 'NITEmisor')
    if (!tipo || !fechaHora || !nit) throw noEsFel('faltan Tipo, FechaHoraEmision o NITEmisor')

    const lineas: LineaExtraida[] = hijos(hijo(emision, 'Items'), 'Item').map((item) => {
        const iva = hijos(hijo(item, 'Impuestos'), 'Impuesto').find(
            (i) => (texto(hijo(i, 'NombreCorto')) ?? '').toUpperCase() === 'IVA',
        )
        const bos = (atributo(item, 'BienOServicio') ?? 'B').toUpperCase()
        return {
            codigo: null,
            descripcion: texto(hijo(item, 'Descripcion')) ?? '(sin descripción)',
            cantidad: aCantidadTexto(texto(hijo(item, 'Cantidad'))),
            unidad: texto(hijo(item, 'UnidadMedida')),
            precio_unitario: aMonto(texto(hijo(item, 'PrecioUnitario'))),
            descuento: aMonto(texto(hijo(item, 'Descuento'))),
            total: aMonto(texto(hijo(item, 'Total'))),
            iva: aMonto(texto(hijo(iva, 'MontoImpuesto'))),
            bien_o_servicio: bos === 'S' ? 'S' : 'B',
        }
    })
    if (lineas.length === 0) throw noEsFel('no tiene Items')

    const totales = hijo(emision, 'Totales')
    const totalIva = hijos(hijo(totales, 'TotalImpuestos'), 'TotalImpuesto').find(
        (i) => (atributo(i, 'NombreCorto') ?? '').toUpperCase() === 'IVA',
    )
    const autorizacion = buscar(raiz, 'NumeroAutorizacion')
    return {
        emisor: {
            nit: nit.replaceAll('-', '').toUpperCase(),
            nombre: atributo(emisor, 'NombreEmisor') ?? atributo(emisor, 'NombreComercial') ?? nit,
        },
        receptor: {
            nit: atributo(receptor, 'IDReceptor')?.replaceAll('-', '').toUpperCase() ?? null,
            nombre: atributo(receptor, 'NombreReceptor'),
        },
        tipo_documento: tipo.toUpperCase(),
        serie: atributo(autorizacion, 'Serie'),
        numero: atributo(autorizacion, 'Numero') ?? texto(autorizacion) ?? '',
        autorizacion: texto(autorizacion),
        fecha: fechaHora.slice(0, 10),
        moneda: (atributo(generales, 'CodigoMoneda') ?? 'GTQ').toUpperCase(),
        lineas,
        totales: {
            total: aMonto(texto(hijo(totales, 'GranTotal'))),
            iva: aMonto(atributo(totalIva, 'TotalMontoImpuesto')),
        },
    }
}
