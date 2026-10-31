/**
 * Borradores de compra desde un archivo (A3, `contratos/inventario.md` D.5): el XML FEL con un parser
 * mínimo (como `fel_xml.ts`), el PDF o la imagen con una «IA» de prueba que solo responde si hay una
 * configuración activa (si no, `ia_no_configurada` y captura manual), la propuesta de proveedor y
 * productos, y la confirmación que registra la compra por la misma ruta de `compras.registrar`.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { crearProductoFixture, esRespuesta } from '../inventario/rutas'
import { rutasCompras } from './rutas'

type Borrador = Schema<'BorradorCompra'>
type Extraccion = Schema<'ExtraccionCompra'>
type PropuestaLinea = NonNullable<Borrador['propuesta']>['lineas'][number]
type Errores = NonNullable<Problem['errors']>

const TAMANO_MAXIMO = 10 * 1024 * 1024
/** Como `compras.registrar`: la fecha del documento no puede pasar de hoy en Guatemala. */
const hoy = () => hoyGuatemala()

/**
 * La API devuelve `coincidencia: null` cuando una línea no coincide con ningún producto; el OpenAPI aún
 * la declara sin `null` (pedido a A3 en `a4.md`). Se escribe así para que el fixture diga lo mismo.
 */
const SIN_COINCIDENCIA = null as unknown as PropuestaLinea['coincidencia']

function tipoArchivo(bytes: Uint8Array): string | null {
    const empieza = (firma: number[], desde = 0) => firma.every((b, i) => bytes[desde + i] === b)
    if (empieza([0x25, 0x50, 0x44, 0x46])) {
        return 'application/pdf'
    }
    if (empieza([0x89, 0x50, 0x4E, 0x47])) {
        return 'image/png'
    }
    if (empieza([0xFF, 0xD8, 0xFF])) {
        return 'image/jpeg'
    }
    if (empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8)) {
        return 'image/webp'
    }
    const inicio = new TextDecoder().decode(bytes.slice(0, 200)).replace(/^\uFEFF/, '').trimStart()
    return inicio.startsWith('<') ? 'application/xml' : null
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const copia = new Uint8Array(bytes.byteLength)
    copia.set(bytes)
    const huella = await crypto.subtle.digest('SHA-256', copia.buffer)
    return [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const atributo = (etiqueta: string, nombre: string): string | null => new RegExp(`${nombre}="([^"]*)"`).exec(etiqueta)?.[1] ?? null
const elemento = (xml: string, nombre: string): string | null => new RegExp(`<(?:\\w+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`).exec(xml)?.[1]?.trim() ?? null
const apertura = (xml: string, nombre: string): string | null => new RegExp(`<(?:\\w+:)?${nombre}\\b[^>]*>`).exec(xml)?.[0] ?? null
const monto = (valor: string | null): string => new Decimal(valor && /^-?\d+(\.\d+)?$/.test(valor) ? valor : '0').toFixed(2)

/** Parser mínimo del DTE de la SAT (`dte:GTDocumento/dte:SAT/dte:DTE/dte:DatosEmision`); `null` si no es un DTE. */
export function leerXmlFel(xml: string): Extraccion | null {
    const generales = apertura(xml, 'DatosGenerales')
    const emisor = apertura(xml, 'Emisor')
    if (!/GTDocumento/.test(xml) || !generales || !emisor) {
        return null
    }
    const receptor = apertura(xml, 'Receptor') ?? ''
    const autorizacion = apertura(xml, 'NumeroAutorizacion') ?? ''
    const totales = elemento(xml, 'Totales') ?? ''
    const items = [...xml.matchAll(/<(?:\w+:)?Item\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Item>/g)]
    return {
        emisor: { nit: atributo(emisor, 'NITEmisor') ?? '', nombre: atributo(emisor, 'NombreEmisor') ?? atributo(emisor, 'NombreComercial') ?? '' },
        receptor: { nit: atributo(receptor, 'IDReceptor'), nombre: atributo(receptor, 'NombreReceptor') },
        tipo_documento: atributo(generales, 'Tipo') ?? 'FACT',
        serie: atributo(autorizacion, 'Serie'),
        numero: atributo(autorizacion, 'Numero') ?? '',
        autorizacion: elemento(xml, 'NumeroAutorizacion'),
        fecha: (atributo(generales, 'FechaHoraEmision') ?? hoy()).slice(0, 10),
        moneda: atributo(generales, 'CodigoMoneda') ?? 'GTQ',
        lineas: items.map(([, atributos = '', cuerpo = '']) => ({
            codigo: elemento(cuerpo, 'Codigo'),
            descripcion: elemento(cuerpo, 'Descripcion') ?? '',
            cantidad: elemento(cuerpo, 'Cantidad') ?? '1',
            unidad: elemento(cuerpo, 'UnidadMedida'),
            precio_unitario: monto(elemento(cuerpo, 'PrecioUnitario')),
            descuento: monto(elemento(cuerpo, 'Descuento')),
            total: monto(elemento(cuerpo, 'Total')),
            iva: monto(elemento(cuerpo, 'MontoImpuesto')),
            bien_o_servicio: atributo(atributos, 'BienOServicio') === 'S' ? 'S' : 'B',
        })),
        totales: { total: monto(elemento(totales, 'GranTotal')), iva: monto(atributo(apertura(totales, 'TotalImpuesto') ?? '', 'TotalMontoImpuesto') ?? elemento(totales, 'TotalImpuestos')) },
    }
}

/** Lo que «lee» la IA de prueba de un PDF o una imagen, con su confianza por campo y por línea. */
function extraccionIa(): { datos: Extraccion, confianza: Record<string, unknown> } {
    return {
        datos: {
            emisor: { nit: '45678912', nombre: 'Distribuidora del Sur' },
            receptor: { nit: '12345678', nombre: 'ArgosNet' },
            tipo_documento: 'FACT',
            serie: 'B',
            numero: '20871',
            autorizacion: null,
            fecha: hoy(),
            moneda: 'GTQ',
            lineas: [
                { codigo: 'GRP-10', descripcion: 'Grapa plástica 10 mm (caja)', cantidad: '4', unidad: 'caja', precio_unitario: '28.00', descuento: '0.00', total: '112.00', iva: '12.00', bien_o_servicio: 'B' },
                { codigo: null, descripcion: 'Flete', cantidad: '1', unidad: null, precio_unitario: '50.00', descuento: '0.00', total: '50.00', iva: '5.36', bien_o_servicio: 'S' },
            ],
            totales: { total: '162.00', iva: '17.36' },
        },
        confianza: { emisor: 0.97, numero: 0.72, fecha: 0.9, serie: 0.55, totales: 0.93, lineas: [{ descripcion: 0.88, cantidad: 0.64, total: 0.95 }, { descripcion: 0.5, cantidad: 0.9, total: 0.92 }] },
    }
}

function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

const nitLimpio = (nit: string | null | undefined) => (nit ?? '').replace(/[\s-]/g, '').toUpperCase()

function datosDe(borrador: Borrador): Extraccion | null {
    const d = borrador.datos as Partial<Extraccion>
    return d.emisor && Array.isArray(d.lineas) ? d as Extraccion : null
}

/** La propuesta (D.5): proveedor por NIT; por línea, código del proveedor, SKU o nombre; si no, crear. */
function propuestaDe(empresaId: number, datos: Extraccion | null): Borrador['propuesta'] {
    if (!datos) {
        return { proveedor: null, lineas: [] }
    }
    const proveedor = bd.proveedores.find(p => p.empresa_id === empresaId && p.activo && nitLimpio(p.nit) === nitLimpio(datos.emisor.nit))
    const productos = bd.productos.filter(p => p.empresa_id === empresaId && p.activo)
    return {
        proveedor: datos.emisor.nit ? { id: proveedor?.id ?? null, nit: nitLimpio(datos.emisor.nit), nombre: proveedor?.nombre ?? datos.emisor.nombre, crear: !proveedor } : null,
        lineas: datos.lineas.map((l, indice) => {
            if (l.bien_o_servicio === 'S') {
                return { indice, coincidencia: SIN_COINCIDENCIA, producto_id: null, producto_sku: null, producto_nombre: null, crear: null, gasto: true }
            }
            const aprendido = proveedor && l.codigo ? bd.inventarioFaseD.codigosProveedor.find(c => c.proveedor_id === proveedor.id && c.codigo === l.codigo) : undefined
            const porCodigo = aprendido ? productos.find(p => p.id === aprendido.producto_id) : undefined
            const porSku = !porCodigo && l.codigo ? productos.find(p => p.sku.toLowerCase() === (l.codigo ?? '').toLowerCase()) : undefined
            const porNombre = !porCodigo && !porSku ? productos.find(p => normalizar(p.nombre) === normalizar(l.descripcion)) : undefined
            const hallado = porCodigo ?? porSku ?? porNombre
            if (hallado) {
                return { indice, coincidencia: porCodigo ? 'codigo_proveedor' : porSku ? 'sku' : 'nombre', producto_id: hallado.id, producto_sku: hallado.sku, producto_nombre: hallado.nombre, crear: null, gasto: false }
            }
            const sku = (l.codigo ?? normalizar(l.descripcion).split(' ').slice(0, 3).join('-')).toUpperCase().slice(0, 60)
            return { indice, coincidencia: SIN_COINCIDENCIA, producto_id: null, producto_sku: null, producto_nombre: null, crear: { sku, nombre: l.descripcion.slice(0, 200), tipo: 'material', unidad: l.unidad ?? 'unidad' }, gasto: false }
        }),
    }
}

function compraDuplicada(empresaId: number, datos: Extraccion | null, excepto?: number): Schema<'Compra'> | Borrador | undefined {
    if (!datos?.numero || !datos.emisor.nit) {
        return undefined
    }
    const mismo = (nit: string | null | undefined, serie: string | null | undefined, numero: string | null | undefined) =>
        nitLimpio(nit) === nitLimpio(datos.emisor.nit) && (serie ?? '').toLowerCase() === (datos.serie ?? '').toLowerCase() && (numero ?? '').toLowerCase() === datos.numero.toLowerCase()
    return bd.compras.find(c => c.empresa_id === empresaId && c.estado === 'vigente' && mismo(bd.proveedores.find(p => p.id === c.proveedor_id)?.nit, c.serie, c.numero))
        ?? bd.inventarioFaseD.borradores.find(b => b.id !== excepto && b.empresa_id === empresaId && b.estado === 'confirmado' && mismo(b.emisor_nit, b.serie, b.numero))
}

function actualizarBorrador(borrador: Borrador, cambios: Partial<Borrador>): Borrador {
    Object.assign(borrador, cambios, { version: borrador.version + 1, updated_at: ahora() })
    return borrador
}

async function cargarBorrador(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const cuerpo = cuerpoObjeto(solicitud)
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
    const archivo = cuerpo.archivo instanceof Blob ? cuerpo.archivo : null
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const momento = ahora()
    const base: Borrador = {
        id: Math.max(0, ...bd.inventarioFaseD.borradores.map(b => b.id)) + 1,
        empresa_id: empresaId,
        estado: 'borrador',
        fuente: 'manual',
        archivo_tipo: null,
        archivo_tamano: null,
        archivo_nombre: null,
        archivo_sha256: null,
        extraccion: null,
        confianza: null,
        error_extraccion: null,
        ia_proveedor: null,
        ia_modelo: null,
        datos: {},
        propuesta: { proveedor: null, lineas: [] },
        emisor_nit: null,
        serie: null,
        numero: null,
        compra_id: null,
        motivo_descarte: null,
        creado_por: usuario?.id ?? null,
        confirmado_por: null,
        confirmado_en: null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    if (archivo) {
        const bytes = new Uint8Array(await archivo.arrayBuffer())
        const tipo = tipoArchivo(bytes)
        if (!tipo || bytes.length > TAMANO_MAXIMO) {
            return datosInvalidos([{ field: 'archivo', message: tipo ? 'El archivo pasa de 10 MB' : 'XML, PDF, JPG, PNG o WebP', rule: 'archivo' }])
        }
        const huella = await sha256(bytes)
        const repetido = bd.inventarioFaseD.borradores.find(b => b.empresa_id === empresaId && b.estado !== 'descartado' && b.archivo_sha256 === huella)
        if (repetido) {
            return problemaTipado(409, 'archivo_duplicado', 'Archivo duplicado', `Ese archivo ya se cargó en el borrador #${repetido.id}`)
        }
        Object.assign(base, { archivo_tipo: tipo, archivo_tamano: bytes.length, archivo_nombre: archivo instanceof File ? archivo.name : 'factura', archivo_sha256: huella })
        if (tipo === 'application/xml') {
            const datos = leerXmlFel(new TextDecoder().decode(bytes))
            if (!datos) {
                return datosInvalidos([{ field: 'archivo', message: 'El XML no es un DTE de la SAT', rule: 'xml_no_fel' }])
            }
            const duplicada = compraDuplicada(empresaId, datos)
            if (duplicada) {
                return problemaTipado(409, 'compra_duplicada', 'Compra duplicada', `La factura ${datos.serie ?? ''} ${datos.numero} de ${datos.emisor.nombre} ya está registrada`)
            }
            Object.assign(base, { fuente: 'xml_fel', extraccion: datos, datos })
        }
        else {
            const ia = bd.inventarioFaseD.ia.find(c => c.empresa_id === empresaId && c.activo) ?? bd.inventarioFaseD.ia.find(c => c.empresa_id === null && c.activo)
            if (!ia) {
                Object.assign(base, { fuente: 'ia', error_extraccion: 'ia_no_configurada: no hay una IA activa para la empresa' })
            }
            else if (tipo === 'application/pdf' && ia.proveedor !== 'anthropic' && !new TextDecoder().decode(bytes).includes('BT')) {
                Object.assign(base, { fuente: 'ia', error_extraccion: 'ia_fallo: pdf_sin_texto', ia_proveedor: ia.proveedor, ia_modelo: ia.modelo })
            }
            else {
                const { datos, confianza } = extraccionIa()
                Object.assign(base, { fuente: 'ia', extraccion: datos, datos, confianza, ia_proveedor: ia.proveedor, ia_modelo: ia.modelo })
            }
        }
        const datos = datosDe(base)
        Object.assign(base, { emisor_nit: datos ? nitLimpio(datos.emisor.nit) || null : null, serie: datos?.serie ?? null, numero: datos?.numero || null, propuesta: propuestaDe(empresaId, datos) })
        bd.inventarioFaseD.archivosBorradores[base.id] = { bytes, tipo, nombre: base.archivo_nombre ?? 'factura' }
    }
    bd.inventarioFaseD.borradores.push(base)
    registrarAccion(solicitud, 'compras.cargar_borrador', { tipo: 'borrador_compra', id: base.id }, { archivo: base.archivo_nombre, sha256: base.archivo_sha256 })
    return { status: 201, cuerpo: base }
}

function borradorVivo(solicitud: SolicitudFixture): Borrador | RespuestaFixture {
    const borrador = bd.inventarioFaseD.borradores.find(b => b.id === idDe(solicitud))
    if (!borrador) {
        return noEncontrado('el borrador')
    }
    if (borrador.estado !== 'borrador') {
        return problemaTipado(409, 'borrador_cerrado', 'Borrador cerrado', `El borrador ya está ${borrador.estado}`)
    }
    if (cuerpoObjeto(solicitud).version !== borrador.version) {
        return versionCambiada()
    }
    return borrador
}

/** Confirmar (D.5): crea lo que se pidió crear y registra la compra por la ruta de `compras.registrar`. */
async function confirmarBorrador(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const borrador = borradorVivo(solicitud)
    if (esRespuesta(borrador)) {
        return borrador
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const datos = datosDe(borrador)
    if (!datos || !datos.numero || !datos.lineas.length) {
        return datosInvalidos([{ field: 'datos.numero', message: 'Completa y guarda los datos de la factura antes de confirmar', rule: 'required' }])
    }
    const empresa = bd.empresas.find(e => e.id === borrador.empresa_id)
    if (datos.receptor.nit && empresa && nitLimpio(datos.receptor.nit) !== nitLimpio(empresa.nit) && cuerpo.forzar_receptor !== true) {
        return problemaTipado(422, 'receptor_distinto', 'Receptor distinto', `La factura es para el NIT ${datos.receptor.nit}, no para ${empresa.nit}`, [{ field: 'forzar_receptor', message: 'Confirma que la factura es de la empresa', rule: 'receptor_distinto' }])
    }
    if (compraDuplicada(borrador.empresa_id, datos, borrador.id)) {
        return problemaTipado(409, 'compra_duplicada', 'Compra duplicada', `La factura ${datos.serie ?? ''} ${datos.numero} ya está registrada`)
    }
    const lineasPedidas = Array.isArray(cuerpo.lineas) ? cuerpo.lineas.map(l => (typeof l === 'object' && l !== null ? l as Record<string, unknown> : {})) : []
    const errores: Errores = []
    lineasPedidas.forEach((l, i) => {
        const linea = datos.lineas[typeof l.indice === 'number' ? l.indice : -1]
        const producto = typeof l.producto === 'object' && l.producto !== null ? l.producto as Record<string, unknown> : null
        if (!linea) {
            errores.push({ field: `lineas.${i}.indice`, message: 'La línea no existe', rule: 'exists' })
        }
        else if (producto && !/^\d+$/.test(new Decimal(linea.cantidad).toString())) {
            errores.push({ field: `lineas.${i}.cantidad`, message: 'Una compra a inventario va en unidades enteras', rule: 'cantidad_entera' })
        }
        if (producto && typeof l.bodega_id !== 'number') {
            errores.push({ field: `lineas.${i}.bodega_id`, message: 'Elige la bodega', rule: 'required' })
        }
    })
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const otra = (cuerpoNuevo: unknown): SolicitudFixture => ({ ...solicitud, headers: new Headers({ 'X-Empresa-Id': String(borrador.empresa_id) }), cuerpo: cuerpoNuevo })
    // Proveedor
    const pedido = typeof cuerpo.proveedor === 'object' && cuerpo.proveedor !== null ? cuerpo.proveedor as Record<string, unknown> : {}
    let proveedorId = typeof pedido.id === 'number' ? pedido.id : null
    const respaldo = { proveedores: [...bd.proveedores], productos: [...bd.productos] }
    const deshacer = (respuesta: RespuestaFixture) => {
        bd.proveedores.splice(0, bd.proveedores.length, ...respaldo.proveedores)
        bd.productos.splice(0, bd.productos.length, ...respaldo.productos)
        return respuesta
    }
    if (!proveedorId && typeof pedido.crear === 'object' && pedido.crear !== null) {
        const crear = pedido.crear as Record<string, unknown>
        const manejador = rutasCompras['POST /api/v1/proveedores']
        const respuesta = manejador ? await manejador(otra({ empresa_id: borrador.empresa_id, nit: crear.nit ?? datos.emisor.nit, nombre: crear.nombre, tipo: crear.tipo ?? undefined, dias_credito: crear.dias_credito ?? undefined })) : noEncontrado('la ruta de proveedores')
        if (respuesta.status >= 300) {
            return deshacer({ ...respuesta, cuerpo: { ...(respuesta.cuerpo as Problem), errors: ((respuesta.cuerpo as Problem).errors ?? []).map(e => ({ ...e, field: `proveedor.crear.${e.field}` })) } })
        }
        proveedorId = (respuesta.cuerpo as Schema<'Proveedor'>).id
    }
    if (!proveedorId) {
        return datosInvalidos([{ field: 'proveedor.id', message: 'Elige o crea el proveedor', rule: 'required' }])
    }
    // Productos y líneas de la compra
    const lineasCompra: Record<string, unknown>[] = []
    for (const [indice, linea] of datos.lineas.entries()) {
        const pedida = lineasPedidas.find(l => l.indice === indice)
        const producto = pedida && typeof pedida.producto === 'object' && pedida.producto !== null ? pedida.producto as Record<string, unknown> : null
        let productoId = producto && typeof producto.id === 'number' ? producto.id : null
        if (producto && !productoId && typeof producto.crear === 'object' && producto.crear !== null) {
            const creado = crearProductoFixture(producto.crear as Record<string, unknown>, borrador.empresa_id, `lineas.${lineasPedidas.indexOf(pedida ?? {})}.producto.crear.`)
            if (esRespuesta(creado)) {
                return deshacer(creado)
            }
            productoId = creado.id
        }
        const total = new Decimal(linea.total)
        lineasCompra.push({
            descripcion: linea.descripcion.slice(0, 200),
            tipo: linea.bien_o_servicio === 'S' ? 'servicio' : 'bien',
            total: total.toFixed(2),
            ...(productoId ? { producto_id: productoId, bodega_id: pedida?.bodega_id, cantidad: Number(linea.cantidad), ...(Array.isArray(pedida?.unidades) ? { unidades: pedida.unidades } : {}) } : {}),
            ...(!productoId && typeof pedida?.cuenta === 'string' ? { cuenta: pedida.cuenta } : {}),
        })
        if (productoId && linea.codigo) {
            bd.inventarioFaseD.codigosProveedor.push({ empresa_id: borrador.empresa_id, proveedor_id: proveedorId, codigo: linea.codigo, producto_id: productoId })
        }
    }
    const registrar = rutasCompras['POST /api/v1/compras']
    const respuesta = registrar
        ? await registrar(otra({
                empresa_id: borrador.empresa_id,
                proveedor_id: proveedorId,
                tipo_documento: datos.tipo_documento,
                serie: datos.serie,
                numero: datos.numero,
                autorizacion: datos.autorizacion,
                fecha_documento: datos.fecha,
                lineas: lineasCompra,
                condicion: cuerpo.condicion,
                vence_en: cuerpo.vence_en ?? null,
                metodo: cuerpo.metodo ?? null,
                caja_id: cuerpo.caja_id ?? null,
                banco_id: cuerpo.banco_id ?? null,
                cuenta_bancaria_id: cuerpo.cuenta_bancaria_id ?? null,
            }))
        : noEncontrado('la ruta de compras')
    if (respuesta.status >= 300) {
        return deshacer(respuesta)
    }
    const compra = respuesta.cuerpo as Schema<'Compra'>
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    actualizarBorrador(borrador, { estado: 'confirmado', compra_id: compra.id, confirmado_por: usuario?.id ?? null, confirmado_en: ahora() })
    registrarAccion(solicitud, 'compras.confirmar_borrador', { tipo: 'borrador_compra', id: borrador.id }, cuerpo)
    return { status: 200, cuerpo: borrador }
}

export const rutasBorradoresCompra: RutasFixture = {
    'GET /api/v1/compras/borradores': conPermiso('compras.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const filas = deLaEmpresa(bd.inventarioFaseD.borradores, solicitud)
            .filter(b => !estado || b.estado === estado)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'POST /api/v1/compras/borradores': conPermiso('compras.cargar_borrador', conIdempotencia(cargarBorrador)),
    'GET /api/v1/compras/borradores/:id': conPermiso('compras.ver', (solicitud) => {
        const borrador = bd.inventarioFaseD.borradores.find(b => b.id === idDe(solicitud))
        return borrador ? { status: 200, cuerpo: borrador } : noEncontrado('el borrador')
    }),
    'GET /api/v1/compras/borradores/:id/archivo': conPermiso('compras.ver', (solicitud) => {
        const archivo = bd.inventarioFaseD.archivosBorradores[idDe(solicitud) ?? 0]
        return archivo ? { status: 200, cuerpo: archivo.bytes, contentType: archivo.tipo } : noEncontrado('el archivo')
    }),
    'POST /api/v1/compras/borradores/:id/editar': conPermiso('compras.editar_borrador', conIdempotencia((solicitud) => {
        const borrador = borradorVivo(solicitud)
        if (esRespuesta(borrador)) {
            return borrador
        }
        const datos = cuerpoObjeto(solicitud).datos as Extraccion | undefined
        if (!datos?.emisor?.nit || !datos.numero || !Array.isArray(datos.lineas) || !datos.lineas.length) {
            return datosInvalidos([{ field: 'datos.numero', message: 'Emisor, número y al menos una línea', rule: 'required' }])
        }
        actualizarBorrador(borrador, { datos, emisor_nit: nitLimpio(datos.emisor.nit), serie: datos.serie, numero: datos.numero, propuesta: propuestaDe(borrador.empresa_id, datos) })
        registrarAccion(solicitud, 'compras.editar_borrador', { tipo: 'borrador_compra', id: borrador.id }, { datos })
        return { status: 200, cuerpo: borrador }
    })),
    'POST /api/v1/compras/borradores/:id/confirmar': conPermiso('compras.confirmar_borrador', conIdempotencia(confirmarBorrador)),
    'POST /api/v1/compras/borradores/:id/descartar': conPermiso('compras.descartar_borrador', conIdempotencia((solicitud) => {
        const borrador = borradorVivo(solicitud)
        if (esRespuesta(borrador)) {
            return borrador
        }
        const motivo = cuerpoObjeto(solicitud).motivo
        if (typeof motivo !== 'string' || motivo.trim().length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        actualizarBorrador(borrador, { estado: 'descartado', motivo_descarte: motivo.trim() })
        registrarAccion(solicitud, 'compras.descartar_borrador', { tipo: 'borrador_compra', id: borrador.id }, { motivo })
        return { status: 200, cuerpo: borrador }
    })),
}

/** Un XML FEL de ejemplo (Electrónica Central, ya es proveedor) para las pruebas y la demostración. */
export function xmlFelDemo(numero = '458721', receptorNit = '12345678'): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" Version="0.1">
  <dte:SAT ClaseDocumento="dte">
    <dte:DTE ID="DatosCertificados">
      <dte:DatosEmision ID="DatosEmision">
        <dte:DatosGenerales CodigoMoneda="GTQ" FechaHoraEmision="${hoy()}T10:15:00-06:00" Tipo="FACT"/>
        <dte:Emisor AfiliacionIVA="GEN" CodigoEstablecimiento="1" NITEmisor="33214561" NombreComercial="Electrónica Central" NombreEmisor="ELECTRONICA CENTRAL, S.A."/>
        <dte:Receptor IDReceptor="${receptorNit}" NombreReceptor="ARGOSNET, S.A."/>
        <dte:Items>
          <dte:Item BienOServicio="B" NumeroLinea="1">
            <dte:Cantidad>2</dte:Cantidad>
            <dte:UnidadMedida>UNI</dte:UnidadMedida>
            <dte:Descripcion>Conector RJ45</dte:Descripcion>
            <dte:PrecioUnitario>1.50</dte:PrecioUnitario>
            <dte:Precio>3.00</dte:Precio>
            <dte:Descuento>0.00</dte:Descuento>
            <dte:Impuestos><dte:Impuesto><dte:NombreCorto>IVA</dte:NombreCorto><dte:MontoImpuesto>0.32</dte:MontoImpuesto></dte:Impuesto></dte:Impuestos>
            <dte:Total>3.00</dte:Total>
          </dte:Item>
          <dte:Item BienOServicio="B" NumeroLinea="2">
            <dte:Cantidad>10</dte:Cantidad>
            <dte:UnidadMedida>UNI</dte:UnidadMedida>
            <dte:Descripcion>Patch cord Cat6 1 m</dte:Descripcion>
            <dte:PrecioUnitario>12.00</dte:PrecioUnitario>
            <dte:Precio>120.00</dte:Precio>
            <dte:Descuento>0.00</dte:Descuento>
            <dte:Impuestos><dte:Impuesto><dte:NombreCorto>IVA</dte:NombreCorto><dte:MontoImpuesto>12.86</dte:MontoImpuesto></dte:Impuesto></dte:Impuestos>
            <dte:Total>120.00</dte:Total>
          </dte:Item>
        </dte:Items>
        <dte:Totales>
          <dte:TotalImpuestos><dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="13.18"/></dte:TotalImpuestos>
          <dte:GranTotal>123.00</dte:GranTotal>
        </dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
    <dte:Certificacion>
      <dte:NITCertificador>12521337</dte:NITCertificador>
      <dte:NumeroAutorizacion Numero="${numero}" Serie="A1B2C3D4">A1B2C3D4-0007-1234-ABCD-1234567890AB</dte:NumeroAutorizacion>
    </dte:Certificacion>
  </dte:SAT>
</dte:GTDocumento>
`
}
