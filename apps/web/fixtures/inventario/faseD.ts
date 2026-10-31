/**
 * Inventario fase D (A3, `contratos/inventario.md` «Fase D»): órdenes de traslado con la bodega de
 * tránsito (enviar, recibir con firma digital, en papel o por aceptación simple, cancelar, papel
 * firmado y PDF), tipos de producto, configuración del inventario y de la IA, «Mi bodega» del
 * técnico, alta de productos por lote y consumos con modalidad (`cargos[]`).
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { errorArchivoSorteo, tipoArchivoSorteo } from '~/utils/archivosSorteo'
import { errorFirma } from '~/utils/firma'
import { bd } from '../bd'
import { emitirCargoUnico } from '../bonificaciones/rutas'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, problema, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { pdfFixture } from '../documentos/datos'
import { TIPO_BODEGA_TRANSITO, type ProductoFixture } from './datos'
import { agregarMovimiento, cantidad3, costoSalida, monto2 } from './kardex'
import { bodegaDe, cantidadDe, conflicto, crearProductoFixture, esRespuesta, fechaDe, mover, productoDe, productoYBodega, regla, salida, unidadEnBodega, vistaProducto } from './rutas'

type Bodega = Schema<'Bodega'>
type Movimiento = Schema<'MovimientoInventario'>
type Unidad = Schema<'UnidadInventario'>
type TipoProducto = Schema<'TipoProducto'>
type Orden = Schema<'OrdenTrasladoDetalle'>
type Linea = Orden['lineas'][number]
type Errores = NonNullable<Problem['errors']>

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/
const TOLERANCIA_MS = 5 * 60 * 1000
const hoy = () => ahora().slice(0, 10)

/**
 * `Producto.tipo` es el código del tipo; el OpenAPI aún lo declara con el enum de las semillas
 * (transición D.2) y la API ya acepta cualquier código del catálogo.
 */
export function codigoTipoProducto(codigo: string): ProductoFixture['tipo'] {
    return codigo as ProductoFixture['tipo']
}

/** El tipo activo con ese código: primero el de la empresa, luego el global (como `resolverTipo`). */
export function tipoDeProducto(codigo: unknown, empresaId: number): TipoProducto | null {
    if (typeof codigo !== 'string') {
        return null
    }
    const tipos = bd.inventarioFaseD.tiposProducto.filter(t => t.codigo === codigo && t.activo)
    return tipos.find(t => t.empresa_id === empresaId) ?? tipos.find(t => t.empresa_id === null) ?? null
}

function usuarioDe(solicitud: SolicitudFixture): Schema<'Me'> | undefined {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

function sinAlcance(detalle: string): RespuestaFixture {
    return problemaTipado(403, 'alcance_global_requerido', 'Sin permiso', detalle)
}

/* Órdenes de traslado */

function ordenDe(id: unknown): Orden | undefined {
    return bd.inventarioFaseD.ordenes.find(o => o.id === id)
}

function vistaLista(orden: Orden): Schema<'OrdenTraslado'> {
    const { lineas: _lineas, ...resto } = orden
    return resto
}

/** La bodega «en tránsito» de la empresa; nace con la primera orden enviada. */
function bodegaTransito(empresaId: number): Bodega {
    const existente = bd.bodegas.find(b => b.empresa_id === empresaId && b.tipo === TIPO_BODEGA_TRANSITO)
    if (existente) {
        return existente
    }
    const momento = ahora()
    const nueva: Bodega = { id: Math.max(0, ...bd.bodegas.map(b => b.id)) + 1, empresa_id: empresaId, nombre: 'En tránsito', tipo: TIPO_BODEGA_TRANSITO, usuario_id: null, usuario_nombre: null, zona_id: null, router_id: null, activo: true, version: 1, created_at: momento, updated_at: momento }
    bd.bodegas.push(nueva)
    return nueva
}

function siguienteTraslado(): number {
    return Math.max(0, ...bd.movimientosInventario.map(m => m.traslado_id ?? 0)) + 1
}

/** Un tramo de la orden: par `traslado` que suma 0, sin asiento, con `origen_tipo = orden_traslado`. */
function tramo(orden: Orden, producto: ProductoFixture, desde: Bodega, hacia: Bodega, cantidad: Decimal, costo: Decimal, trasladoId: number, unidadId: number | null, motivo: string | null): Movimiento[] {
    const comun = { tipo: 'traslado' as const, fecha: hoy(), producto_id: producto.id, traslado_id: trasladoId, unidad_id: unidadId, motivo, origen_tipo: 'orden_traslado', origen_id: orden.id, asiento_id: null }
    const nombres = (bodega: Bodega) => ({ producto, bodega: bodega.nombre })
    return [
        agregarMovimiento(bd.movimientosInventario, nombres(desde), { ...comun, bodega_id: desde.id, cantidad: cantidad.negated(), costo_total: costo.negated() }, ahora()),
        agregarMovimiento(bd.movimientosInventario, nombres(hacia), { ...comun, bodega_id: hacia.id, cantidad, costo_total: costo }, ahora()),
    ]
}

function moverUnidad(unidad: Unidad, bodega: Bodega): void {
    Object.assign(unidad, { bodega_id: bodega.id, bodega_nombre: bodega.nombre, version: unidad.version + 1, updated_at: ahora() })
}

function actualizarOrden(orden: Orden, cambios: Partial<Orden>): Orden {
    Object.assign(orden, cambios, { version: orden.version + 1, updated_at: ahora() })
    return orden
}

/** 409 `traslado_ya_recibido` con la recepción guardada (contrato Iris §3.3). */
function yaRecibido(orden: Orden): RespuestaFixture {
    const base = problemaTipado(409, 'traslado_ya_recibido', 'Traslado ya recibido', `La orden N.º ${orden.numero} ya se recibió`)
    const recepcion = { estado: orden.estado, metodo_recepcion: orden.metodo_recepcion, recibido_por: orden.recibido_por, recibido_en: orden.recibido_en, firma_sha256: orden.firma_sha256 }
    return { ...base, cuerpo: { ...(base.cuerpo as Problem), recepcion } }
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const copia = new Uint8Array(bytes.byteLength)
    copia.set(bytes)
    const huella = await crypto.subtle.digest('SHA-256', copia.buffer)
    return [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function bytesDeBase64(texto: string): Uint8Array | null {
    try {
        const binario = atob(texto.replace(/^data:image\/png;base64,/, ''))
        const bytes = new Uint8Array(binario.length)
        for (let i = 0; i < binario.length; i++) {
            bytes[i] = binario.charCodeAt(i)
        }
        return bytes
    }
    catch {
        return null
    }
}

async function enviarOrden(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const cuerpo = cuerpoObjeto(solicitud)
    const origen = bodegaDe(cuerpo.bodega_origen_id)
    const destino = bodegaDe(cuerpo.bodega_destino_id)
    if (!origen) {
        return noEncontrado('la bodega de origen')
    }
    if (!destino || destino.empresa_id !== origen.empresa_id) {
        return noEncontrado('la bodega de destino')
    }
    if (origen.tipo === TIPO_BODEGA_TRANSITO || destino.tipo === TIPO_BODEGA_TRANSITO) {
        return regla('bodega_transito', 'La bodega de tránsito no se elige como origen ni destino', 'bodega_origen_id')
    }
    if (origen.id === destino.id) {
        return datosInvalidos([{ field: 'bodega_destino_id', message: 'El destino debe ser otra bodega', rule: 'different' }])
    }
    const entrada = Array.isArray(cuerpo.lineas) ? cuerpo.lineas : []
    if (!entrada.length) {
        return datosInvalidos([{ field: 'lineas', message: 'Agrega al menos una línea', rule: 'minLength' }])
    }
    const errores: Errores = []
    const vistos = new Set<number>()
    type Plan = { producto: ProductoFixture, cantidad: Decimal | null, unidades: Unidad[] }
    const planes: Plan[] = []
    for (const [i, valor] of entrada.entries()) {
        const l = typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {}
        const producto = productoDe(l.producto_id)
        if (!producto || producto.empresa_id !== origen.empresa_id) {
            errores.push({ field: `lineas.${i}.producto_id`, message: 'El producto no existe', rule: 'exists' })
            continue
        }
        if (vistos.has(producto.id)) {
            errores.push({ field: `lineas.${i}.producto_id`, message: 'El producto ya está en otra línea', rule: 'repetido' })
            continue
        }
        vistos.add(producto.id)
        if (producto.seguimiento === 'serie') {
            const ids = Array.isArray(l.unidad_ids) ? l.unidad_ids : []
            if (!ids.length) {
                errores.push({ field: `lineas.${i}.unidad_ids`, message: 'Elige los equipos', rule: 'requiere_unidades' })
                continue
            }
            planes.push({ producto, cantidad: null, unidades: [] })
            const plan = planes.at(-1)
            for (const id of ids) {
                const unidad = unidadEnBodega(id, producto, origen, true)
                if (esRespuesta(unidad)) {
                    return unidad
                }
                plan?.unidades.push(unidad)
            }
        }
        else {
            const cantidad = cantidadDe(l.cantidad, `lineas.${i}.cantidad`)
            if (esRespuesta(cantidad)) {
                errores.push({ field: `lineas.${i}.cantidad`, message: 'Cantidad mayor que 0, hasta 3 decimales', rule: 'regex' })
                continue
            }
            if (costoSalida(bd.movimientosInventario, producto.id, origen.id, cantidad) === null) {
                return conflicto('existencia_insuficiente', `No alcanza la existencia de ${producto.nombre} en ${origen.nombre}`)
            }
            planes.push({ producto, cantidad, unidades: [] })
        }
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const transito = bodegaTransito(origen.empresa_id)
    const usuario = usuarioDe(solicitud)
    const momento = ahora()
    const motivo = typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim() ? cuerpo.motivo.trim() : null
    const id = Math.max(0, ...bd.inventarioFaseD.ordenes.map(o => o.id)) + 1
    const numero = Math.max(0, ...bd.inventarioFaseD.ordenes.filter(o => o.empresa_id === origen.empresa_id).map(o => o.numero)) + 1
    const orden: Orden = {
        id,
        empresa_id: origen.empresa_id,
        numero,
        estado: 'en_transito',
        bodega_origen_id: origen.id,
        bodega_origen_nombre: origen.nombre,
        bodega_destino_id: destino.id,
        bodega_destino_nombre: destino.nombre,
        bodega_destino_tipo: destino.tipo === 'tecnico' ? 'tecnico' : 'bodega',
        usuario_destino_id: destino.usuario_id,
        usuario_destino_nombre: destino.usuario_nombre,
        motivo,
        enviado_por: usuario?.id ?? null,
        enviado_por_nombre: usuario?.nombre ?? null,
        enviado_en: momento,
        metodo_recepcion: null,
        recibido_por: null,
        recibido_por_nombre: null,
        registrado_por: null,
        registrado_por_nombre: null,
        recibido_en: null,
        observaciones: null,
        firma_sha256: null,
        firma_en: null,
        documento_sha256: null,
        documento_tipo: null,
        documento_en: null,
        cancelado_por: null,
        cancelado_en: null,
        motivo_cancelacion: null,
        lineas_total: planes.length,
        costo_total: '0.00',
        version: 1,
        created_at: momento,
        updated_at: momento,
        lineas: [],
    }
    const trasladoId = siguienteTraslado()
    let siguienteLinea = Math.max(0, ...bd.inventarioFaseD.ordenes.flatMap(o => o.lineas.map(l => l.id)))
    let total = new Decimal(0)
    for (const plan of planes) {
        const base = { id: ++siguienteLinea, producto_id: plan.producto.id, producto_sku: plan.producto.sku, producto_nombre: plan.producto.nombre, unidad: plan.producto.unidad, seguimiento: plan.producto.seguimiento, modalidad: plan.producto.modalidad, cantidad_recibida: null, costo_recibido: null, faltante: null }
        if (plan.cantidad) {
            const costo = costoSalida(bd.movimientosInventario, plan.producto.id, origen.id, plan.cantidad) ?? new Decimal(0)
            tramo(orden, plan.producto, origen, transito, plan.cantidad, costo, trasladoId, null, motivo)
            orden.lineas.push({ ...base, cantidad: cantidad3(plan.cantidad), costo_total: monto2(costo), unidades: [] })
            total = total.plus(costo)
        }
        else {
            const unidades: Linea['unidades'] = []
            let costoLinea = new Decimal(0)
            for (const unidad of plan.unidades) {
                tramo(orden, plan.producto, origen, transito, new Decimal(1), new Decimal(unidad.costo), trasladoId, unidad.id, motivo)
                moverUnidad(unidad, transito)
                unidades.push({ unidad_id: unidad.id, serie: unidad.serie, mac: unidad.mac, costo: unidad.costo, recibida: null })
                costoLinea = costoLinea.plus(unidad.costo)
            }
            orden.lineas.push({ ...base, cantidad: cantidad3(plan.unidades.length), costo_total: monto2(costoLinea), unidades })
            total = total.plus(costoLinea)
        }
    }
    orden.costo_total = monto2(total)
    bd.inventarioFaseD.ordenes.push(orden)
    registrarAccion(solicitud, 'inventario.crear_traslado', { tipo: 'orden_traslado', id: orden.id }, cuerpo)
    return { status: 201, cuerpo: orden }
}

type RecepcionLinea = { linea: Linea, recibida: Decimal, faltantes: number[] }

/** Lo recibido por línea (sin `lineas`, todo); 422 `lineas_invalidas` con los `errors[]`. */
function leerLineasRecepcion(orden: Orden, entrada: unknown): RecepcionLinea[] | RespuestaFixture {
    const errores: Errores = []
    const porLinea = new Map<number, RecepcionLinea>(orden.lineas.map(l => [l.id, { linea: l, recibida: new Decimal(l.cantidad), faltantes: [] }]))
    const filas = Array.isArray(entrada) ? entrada : []
    filas.forEach((valor: unknown, i) => {
        const f = typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {}
        const actual = typeof f.linea_id === 'number' ? porLinea.get(f.linea_id) : undefined
        if (!actual) {
            errores.push({ field: `lineas.${i}.linea_id`, message: 'La línea no es de esta orden', rule: 'exists' })
            return
        }
        const { linea } = actual
        if (linea.seguimiento === 'serie') {
            const ids = Array.isArray(f.unidad_ids_faltantes) ? f.unidad_ids_faltantes.filter((x): x is number => typeof x === 'number') : []
            const series = Array.isArray(f.series_faltantes) ? f.series_faltantes.filter((x): x is string => typeof x === 'string').map(x => x.trim().toUpperCase()) : []
            const porSerie = series.map(s => linea.unidades.find(u => (u.serie ?? '').toUpperCase() === s || (u.mac ?? '').replaceAll(':', '') === s.replace(/[^0-9A-F]/g, '')))
            if (ids.some(id => !linea.unidades.some(u => u.unidad_id === id)) || porSerie.some(u => !u)) {
                errores.push({ field: `lineas.${i}.${series.length ? 'series_faltantes' : 'unidad_ids_faltantes'}`, message: 'El equipo no viaja en esta línea', rule: 'exists' })
                return
            }
            actual.faltantes = [...new Set([...ids, ...porSerie.flatMap(u => (u ? [u.unidad_id] : []))])]
            actual.recibida = new Decimal(linea.unidades.length - actual.faltantes.length)
            if (typeof f.cantidad_recibida === 'string' && !new Decimal(f.cantidad_recibida).equals(actual.recibida)) {
                errores.push({ field: `lineas.${i}.cantidad_recibida`, message: 'Debe ser lo enviado menos lo faltante', rule: 'cantidad' })
            }
            return
        }
        if (f.cantidad_recibida === undefined || f.cantidad_recibida === null) {
            return
        }
        if (typeof f.cantidad_recibida !== 'string' || !CANTIDAD.test(f.cantidad_recibida) || new Decimal(f.cantidad_recibida).greaterThan(linea.cantidad)) {
            errores.push({ field: `lineas.${i}.cantidad_recibida`, message: 'Entre 0 y lo enviado', rule: 'cantidad' })
            return
        }
        actual.recibida = new Decimal(f.cantidad_recibida)
    })
    if (errores.length) {
        return problemaTipado(422, 'lineas_invalidas', 'Líneas inválidas', 'Revisa lo recibido en cada línea', errores)
    }
    return [...porLinea.values()]
}

async function recibirOrden(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const orden = ordenDe(idDe(solicitud))
    if (!orden) {
        return problemaTipado(404, 'traslado_no_encontrado', 'Traslado no encontrado', 'La orden no existe')
    }
    if (orden.estado === 'cancelada') {
        return problemaTipado(409, 'traslado_cancelado', 'Traslado cancelado', `La orden N.º ${orden.numero} está cancelada`)
    }
    if (orden.estado !== 'en_transito') {
        return yaRecibido(orden)
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (typeof cuerpo.version === 'number' && cuerpo.version !== orden.version) {
        return versionCambiada()
    }
    const usuario = usuarioDe(solicitud)
    const global = usuario?.alcance_global === true
    const destino = bodegaDe(orden.bodega_destino_id)
    if (destino?.tipo === 'tecnico' && destino.usuario_id !== usuario?.id && !global) {
        return problema(403, 'Sin permiso', 'Solo el técnico de la bodega destino (o un encargado con alcance global) recibe esta orden.')
    }
    const firma = typeof cuerpo.firma === 'object' && cuerpo.firma !== null ? cuerpo.firma as Record<string, unknown> : null
    const metodo = cuerpo.metodo_recepcion === 'firma_digital' || cuerpo.metodo_recepcion === 'firma_papel' || cuerpo.metodo_recepcion === 'aceptacion_sistema'
        ? cuerpo.metodo_recepcion
        : (firma ? 'firma_digital' : 'aceptacion_sistema')
    const configuracion = bd.inventarioFaseD.configuracion.find(c => c.empresa_id === orden.empresa_id)
    let firmaBytes: Uint8Array | null = null
    let firmaSha: string | null = null
    if (metodo === 'firma_digital') {
        if (!firma) {
            return datosInvalidos([{ field: 'firma', message: 'La firma es obligatoria', rule: 'requerida' }])
        }
        firmaBytes = typeof firma.png_base64 === 'string' ? bytesDeBase64(firma.png_base64) : null
        const error = firmaBytes ? errorFirma(firmaBytes) : 'La firma no es un PNG en base64'
        firmaSha = firmaBytes ? await sha256(firmaBytes) : null
        if (error || firmaSha !== firma.sha256) {
            return problemaTipado(422, 'firma_invalida', 'Firma inválida', error ?? 'El sha256 no coincide con el PNG', [{ field: 'firma', message: error ?? 'El sha256 no coincide con el PNG', rule: 'firma_invalida' }])
        }
    }
    else if (metodo === 'firma_papel') {
        if (!global) {
            return sinAlcance('La firma en papel la registra un encargado con alcance global')
        }
        if (firma) {
            return datosInvalidos([{ field: 'firma', message: 'La firma digital no aplica en papel', rule: 'no_aplica' }])
        }
    }
    else if (configuracion?.traslado_firma_obligatoria ?? true) {
        return datosInvalidos([{ field: 'firma', message: 'La empresa exige firma para recibir', rule: 'requerida' }])
    }
    const recibidoEn = typeof cuerpo.recibido_en === 'string' && cuerpo.recibido_en ? cuerpo.recibido_en : ahora()
    const momento = Date.parse(recibidoEn)
    if (Number.isNaN(momento) || momento < Date.parse(orden.enviado_en) - TOLERANCIA_MS || momento > Date.now() + TOLERANCIA_MS) {
        return datosInvalidos([{ field: 'recibido_en', message: 'No anterior al envío ni futura', rule: 'recibido_en' }])
    }
    const lineas = leerLineasRecepcion(orden, cuerpo.lineas)
    if (esRespuesta(lineas)) {
        return lineas
    }
    const transito = bodegaTransito(orden.empresa_id)
    const origen = bodegaDe(orden.bodega_origen_id)
    if (!destino || !origen) {
        return noEncontrado('la bodega')
    }
    const recibe = siguienteTraslado()
    const devuelve = recibe + 1
    let diferencias = false
    for (const { linea, recibida, faltantes } of lineas) {
        const producto = productoDe(linea.producto_id)
        if (!producto) {
            continue
        }
        if (linea.seguimiento === 'serie') {
            for (const u of linea.unidades) {
                const unidad = bd.unidadesInventario.find(x => x.id === u.unidad_id)
                const falta = faltantes.includes(u.unidad_id)
                tramo(orden, producto, transito, falta ? origen : destino, new Decimal(1), new Decimal(u.costo), falta ? devuelve : recibe, u.unidad_id, null)
                if (unidad) {
                    moverUnidad(unidad, falta ? origen : destino)
                }
                u.recibida = !falta
            }
            linea.costo_recibido = monto2(linea.unidades.filter(u => u.recibida).reduce((t, u) => t.plus(u.costo), new Decimal(0)))
        }
        else {
            const costoRecibido = recibida.times(linea.costo_total).dividedBy(linea.cantidad).toDecimalPlaces(2)
            const faltante = new Decimal(linea.cantidad).minus(recibida)
            if (recibida.greaterThan(0)) {
                tramo(orden, producto, transito, destino, recibida, costoRecibido, recibe, null, null)
            }
            if (faltante.greaterThan(0)) {
                tramo(orden, producto, transito, origen, faltante, new Decimal(linea.costo_total).minus(costoRecibido), devuelve, null, null)
            }
            linea.costo_recibido = monto2(costoRecibido)
        }
        linea.cantidad_recibida = cantidad3(recibida)
        linea.faltante = cantidad3(new Decimal(linea.cantidad).minus(recibida))
        diferencias ||= new Decimal(linea.faltante).greaterThan(0)
    }
    const recibidoPor = destino.tipo === 'tecnico' ? { id: destino.usuario_id, nombre: destino.usuario_nombre } : { id: usuario?.id ?? null, nombre: usuario?.nombre ?? null }
    if (firmaBytes) {
        bd.inventarioFaseD.firmas[orden.id] = firmaBytes
    }
    actualizarOrden(orden, {
        estado: diferencias ? 'recibida_con_diferencias' : 'recibida',
        metodo_recepcion: metodo,
        recibido_por: recibidoPor.id,
        recibido_por_nombre: recibidoPor.nombre,
        registrado_por: usuario?.id ?? null,
        registrado_por_nombre: usuario?.nombre ?? null,
        recibido_en: new Date(momento).toISOString(),
        observaciones: typeof cuerpo.observaciones === 'string' && cuerpo.observaciones.trim() ? cuerpo.observaciones.trim() : null,
        firma_sha256: firmaSha,
        firma_en: firmaSha ? new Date(momento).toISOString() : null,
    })
    registrarAccion(solicitud, 'inventario.recibir_traslado', { tipo: 'orden_traslado', id: orden.id }, { ...cuerpo, firma: firmaBytes ? { bytes: firmaBytes.length, sha256: firmaSha } : null })
    return { status: 200, cuerpo: orden }
}

function cancelarOrden(solicitud: SolicitudFixture): RespuestaFixture {
    const orden = ordenDe(idDe(solicitud))
    if (!orden) {
        return problemaTipado(404, 'traslado_no_encontrado', 'Traslado no encontrado', 'La orden no existe')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (typeof cuerpo.motivo !== 'string' || cuerpo.motivo.trim().length < 3) {
        return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
    }
    if (orden.estado === 'cancelada') {
        return problemaTipado(409, 'traslado_cancelado', 'Traslado cancelado', `La orden N.º ${orden.numero} ya está cancelada`)
    }
    if (orden.estado !== 'en_transito') {
        return yaRecibido(orden)
    }
    if (typeof cuerpo.version === 'number' && cuerpo.version !== orden.version) {
        return versionCambiada()
    }
    const transito = bodegaTransito(orden.empresa_id)
    const origen = bodegaDe(orden.bodega_origen_id)
    if (!origen) {
        return noEncontrado('la bodega de origen')
    }
    const trasladoId = siguienteTraslado()
    const motivo = cuerpo.motivo.trim()
    for (const linea of orden.lineas) {
        const producto = productoDe(linea.producto_id)
        if (!producto) {
            continue
        }
        if (linea.seguimiento === 'serie') {
            for (const u of linea.unidades) {
                tramo(orden, producto, transito, origen, new Decimal(1), new Decimal(u.costo), trasladoId, u.unidad_id, motivo)
                const unidad = bd.unidadesInventario.find(x => x.id === u.unidad_id)
                if (unidad) {
                    moverUnidad(unidad, origen)
                }
            }
        }
        else {
            tramo(orden, producto, transito, origen, new Decimal(linea.cantidad), new Decimal(linea.costo_total), trasladoId, null, motivo)
        }
    }
    const usuario = usuarioDe(solicitud)
    actualizarOrden(orden, { estado: 'cancelada', cancelado_por: usuario?.id ?? null, cancelado_en: ahora(), motivo_cancelacion: motivo })
    registrarAccion(solicitud, 'inventario.cancelar_traslado', { tipo: 'orden_traslado', id: orden.id }, cuerpo)
    return { status: 200, cuerpo: orden }
}

async function adjuntarDocumento(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const orden = ordenDe(idDe(solicitud))
    if (!orden) {
        return problemaTipado(404, 'traslado_no_encontrado', 'Traslado no encontrado', 'La orden no existe')
    }
    if (orden.estado === 'en_transito' || orden.estado === 'cancelada' || orden.metodo_recepcion !== 'firma_papel') {
        return conflicto('documento_no_aplica', 'Solo una orden recibida con firma en papel lleva el documento firmado')
    }
    if (orden.documento_sha256) {
        return conflicto('documento_registrado', `La orden N.º ${orden.numero} ya tiene su documento firmado`)
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const archivo = cuerpo.archivo
    if (!(archivo instanceof Blob)) {
        return datosInvalidos([{ field: 'archivo', message: 'Falta el archivo', rule: 'required' }])
    }
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const error = errorArchivoSorteo(bytes)
    const tipo = tipoArchivoSorteo(bytes)
    if (error || !tipo) {
        return datosInvalidos([{ field: 'archivo', message: error ?? 'Tipo no admitido', rule: 'archivo' }])
    }
    bd.inventarioFaseD.documentos[orden.id] = { bytes, tipo, nombre: archivo instanceof File ? archivo.name : 'documento' }
    actualizarOrden(orden, { documento_sha256: await sha256(bytes), documento_tipo: tipo, documento_en: ahora() })
    registrarAccion(solicitud, 'inventario.adjuntar_documento_traslado', { tipo: 'orden_traslado', id: orden.id }, { bytes: bytes.length, nota: cuerpo.nota ?? null })
    return { status: 200, cuerpo: orden }
}

/* Tipos de producto (D.2) */

function leerTipo(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    if (!parcial && (typeof cuerpo.codigo !== 'string' || !/^[a-z0-9_]{2,40}$/.test(cuerpo.codigo))) {
        errores.push({ field: 'codigo', message: 'Minúsculas, dígitos y _ (2 a 40)', rule: 'regex' })
    }
    if ((!parcial || (cuerpo.nombre !== undefined && cuerpo.nombre !== null)) && (typeof cuerpo.nombre !== 'string' || cuerpo.nombre.trim().length < 2 || cuerpo.nombre.length > 80)) {
        errores.push({ field: 'nombre', message: 'De 2 a 80 caracteres', rule: 'minLength' })
    }
    return errores
}

function compatible(seguimiento: TipoProducto['seguimiento_defecto'], modalidad: TipoProducto['modalidad_defecto']): boolean {
    return !((modalidad === 'comodato' && seguimiento !== 'serie') || (modalidad === 'consumible_gasto' && seguimiento !== 'cantidad'))
}

function tipoEditable(solicitud: SolicitudFixture): TipoProducto | RespuestaFixture {
    const tipo = bd.inventarioFaseD.tiposProducto.find(t => t.id === idDe(solicitud))
    if (!tipo) {
        return noEncontrado('el tipo de producto')
    }
    if (tipo.empresa_id === null && usuarioDe(solicitud)?.alcance_global !== true) {
        return sinAlcance('Un tipo global solo se edita con alcance global')
    }
    if (cuerpoObjeto(solicitud).version !== tipo.version) {
        return versionCambiada()
    }
    return tipo
}

/* Configuración */

function configuracionDe(solicitud: SolicitudFixture): Schema<'ConfiguracionInventario'> {
    const empresaId = empresaActivaDe(solicitud) ?? 1
    return bd.inventarioFaseD.configuracion.find(c => c.empresa_id === empresaId) ?? { empresa_id: empresaId, traslado_firma_obligatoria: true, version: 0 }
}

function iaDe(solicitud: SolicitudFixture): Schema<'ConfiguracionIa'> | undefined {
    const empresaId = empresaActivaDe(solicitud) ?? 1
    return bd.inventarioFaseD.ia.find(c => c.empresa_id === empresaId) ?? bd.inventarioFaseD.ia.find(c => c.empresa_id === null)
}

/* Mi bodega (D.6) */

function vistaMiBodega(bodega: Bodega, solicitud: SolicitudFixture): Schema<'MiBodegaInventario'> {
    const saldos = new Map<number, { cantidad: Decimal, valor: Decimal }>()
    for (const m of bd.movimientosInventario.filter(x => x.bodega_id === bodega.id)) {
        const s = saldos.get(m.producto_id) ?? { cantidad: new Decimal(0), valor: new Decimal(0) }
        saldos.set(m.producto_id, { cantidad: s.cantidad.plus(m.cantidad), valor: s.valor.plus(m.costo_total) })
    }
    const existencias: Schema<'ExistenciaInventario'>[] = [...saldos.entries()].flatMap(([productoId, saldo], i) => {
        const producto = productoDe(productoId)
        if (!producto || saldo.cantidad.isZero()) {
            return []
        }
        const total = new Decimal(vistaProducto(producto).existencia)
        return [{
            id: i + 1,
            empresa_id: bodega.empresa_id,
            producto_id: producto.id,
            producto_sku: producto.sku,
            producto_nombre: producto.nombre,
            unidad: producto.unidad,
            bodega_id: bodega.id,
            bodega_nombre: bodega.nombre,
            bodega_tipo: bodega.tipo,
            cantidad: cantidad3(saldo.cantidad),
            valor: monto2(saldo.valor),
            costo_promedio: saldo.valor.dividedBy(saldo.cantidad).toFixed(6),
            existencia_total: cantidad3(total),
            existencia_minima: producto.existencia_minima,
            bajo_minimo: producto.existencia_minima !== null && total.lessThan(producto.existencia_minima),
            modalidad: producto.modalidad,
        }]
    })
    void solicitud
    return {
        bodega,
        existencias: existencias.sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre)),
        unidades: bd.unidadesInventario.filter(u => u.bodega_id === bodega.id && (u.estado === 'disponible' || u.estado === 'en_reparacion')),
        traslados_pendientes: bd.inventarioFaseD.ordenes.filter(o => o.bodega_destino_id === bodega.id && o.estado === 'en_transito').map(vistaLista),
        kardex: bd.movimientosInventario.filter(m => m.bodega_id === bodega.id).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0, 50),
    }
}

/* Consumos con modalidad (D.3) */

type LineaConsumo = { producto: ProductoFixture, bodegaId: unknown, cantidad: Decimal, unidad: Unidad | null, precio: string | null, conceptoId: number | null }

async function consumir(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const cuerpo = cuerpoObjeto(solicitud)
    const varias = Array.isArray(cuerpo.lineas)
    const entrada: Record<string, unknown>[] = varias
        ? (cuerpo.lineas as unknown[]).map(l => (typeof l === 'object' && l !== null ? l as Record<string, unknown> : {}))
        : [cuerpo]
    const prefijo = (i: number) => (varias ? `lineas.${i}.` : '')
    const servicioId = typeof cuerpo.servicio_id === 'number' ? cuerpo.servicio_id : null
    const fecha = fechaDe(cuerpo.fecha)
    if (typeof fecha !== 'string') {
        return fecha
    }
    const lineas: LineaConsumo[] = []
    for (const [i, l] of entrada.entries()) {
        const par = productoYBodega({ producto_id: l.producto_id, bodega_id: cuerpo.bodega_id ?? l.bodega_id })
        if (esRespuesta(par)) {
            return par
        }
        const { producto, bodega } = par
        if (producto.modalidad === 'comodato') {
            return problemaTipado(422, 'producto_es_comodato', 'Producto en comodato', `${producto.nombre} se presta en comodato: va por los equipos del servicio`, [{ field: `${prefijo(i)}producto_id`, message: 'Un equipo en comodato va por los equipos del servicio', rule: 'producto_es_comodato' }])
        }
        const cobro = producto.modalidad === 'consumible_cobro'
        if (cobro && servicioId === null) {
            return problemaTipado(422, 'cobro_sin_cliente', 'Cobro sin cliente', `${producto.nombre} se cobra al cliente: indica el servicio`, [{ field: 'servicio_id', message: 'Indica el servicio al que se cobra', rule: 'cobro_sin_cliente' }])
        }
        if (!cobro && typeof l.precio_unitario === 'string') {
            return datosInvalidos([{ field: `${prefijo(i)}precio_unitario`, message: 'Un consumo como gasto no lleva precio', rule: 'no_aplica' }])
        }
        if (cobro && fecha !== hoy()) {
            return datosInvalidos([{ field: 'fecha', message: 'Un cobro va con la fecha de hoy', rule: 'no_aplica' }])
        }
        const precio = typeof l.precio_unitario === 'string' ? l.precio_unitario : producto.precio_venta
        const conceptoId = typeof l.concepto_id === 'number' ? l.concepto_id : producto.concepto_cargo_id
        if (cobro && !precio) {
            return datosInvalidos([{ field: `${prefijo(i)}precio_unitario`, message: 'El producto no tiene precio de venta: escribe el precio', rule: 'precio_requerido' }])
        }
        if (cobro && !conceptoId) {
            return datosInvalidos([{ field: `${prefijo(i)}concepto_id`, message: 'El producto no tiene concepto de cargo', rule: 'concepto_requerido' }])
        }
        if (producto.seguimiento === 'serie') {
            const unidad = unidadEnBodega(l.unidad_id, producto, bodega)
            if (esRespuesta(unidad)) {
                return unidad
            }
            lineas.push({ producto, bodegaId: bodega.id, cantidad: new Decimal(1), unidad, precio, conceptoId })
            continue
        }
        const cantidad = cantidadDe(l.cantidad, `${prefijo(i)}cantidad`)
        if (esRespuesta(cantidad)) {
            return cantidad
        }
        if (costoSalida(bd.movimientosInventario, producto.id, bodega.id, cantidad) === null) {
            return conflicto('existencia_insuficiente', `No alcanza la existencia de ${producto.nombre} en ${bodega.nombre}`)
        }
        lineas.push({ producto, bodegaId: bodega.id, cantidad, unidad: null, precio, conceptoId })
    }
    // Primero el cargo único (si algo se cobra): si falla, no sale nada del kardex.
    const cobros = lineas.filter(l => l.producto.modalidad === 'consumible_cobro')
    let facturaId: number | null = null
    const cargos: { id: number, producto_id: number, monto: string }[] = []
    if (cobros.length) {
        const respuesta = emitirCargoUnico({
            ...solicitud,
            cuerpo: { servicio_id: servicioId, lineas: cobros.map(l => ({ concepto_id: l.conceptoId, precio_unitario: l.precio, cantidad: l.cantidad.toString(), descripcion: l.producto.nombre })) },
        })
        if (respuesta.status >= 300) {
            return respuesta
        }
        const emitido = respuesta.cuerpo as Schema<'CargoUnicoEmitido'>
        const factura = emitido.factura
        if (!factura) {
            return conflicto('sin_factura', 'El cargo no generó factura')
        }
        facturaId = factura.id
        for (const l of cobros) {
            cargos.push({ id: factura.id, producto_id: l.producto.id, monto: monto2(new Decimal(l.precio ?? '0').times(l.cantidad)) })
        }
    }
    const movimientos: Movimiento[] = []
    for (const l of lineas) {
        const bodega = bodegaDe(l.bodegaId)
        if (!bodega) {
            continue
        }
        const cobro = l.producto.modalidad === 'consumible_cobro'
        const datos = { tipo: cobro ? 'venta' as const : 'consumo' as const, fecha, servicio_id: servicioId, motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null, factura_id: cobro ? facturaId : null }
        if (l.unidad) {
            movimientos.push(mover(l.producto, bodega, { ...datos, cantidad: -1, costo_total: new Decimal(l.unidad.costo).negated(), unidad_id: l.unidad.id }))
            Object.assign(l.unidad, { estado: 'vendida', bodega_id: null, bodega_nombre: null, servicio_id: servicioId, version: l.unidad.version + 1, updated_at: ahora() })
            continue
        }
        const movimiento = salida(l.producto, bodega, l.cantidad, datos)
        if (!esRespuesta(movimiento)) {
            movimientos.push(movimiento)
        }
    }
    const [primero] = movimientos
    if (!primero) {
        return conflicto('sin_movimientos', 'No se consumió nada')
    }
    registrarAccion(solicitud, 'inventario.consumir', { tipo: 'movimiento_inventario', id: primero.id }, cuerpo)
    const respuesta: Schema<'ConsumoInventario'> = { ...primero, movimientos, cargos, factura_id: facturaId }
    return { status: 201, cuerpo: respuesta }
}

/* Alta por lote (D.4) */

async function crearLote(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    if (!solicitud.headers.get('Idempotency-Key')) {
        return problemaTipado(400, 'idempotency_key_requerida', 'Falta Idempotency-Key', 'El alta por lote exige la cabecera Idempotency-Key')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const filas = Array.isArray(cuerpo.productos) ? cuerpo.productos.map(f => (typeof f === 'object' && f !== null ? f as Record<string, unknown> : {})) : []
    if (!filas.length || filas.length > 500) {
        return datosInvalidos([{ field: 'productos', message: 'De 1 a 500 productos', rule: 'array' }])
    }
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
    const usuario = usuarioDe(solicitud)
    // Validación previa de todo el lote (como la API): todos los errores juntos.
    const errores: Errores = []
    const skus = new Map<string, number>()
    filas.forEach((f, i) => {
        const sku = typeof f.sku === 'string' ? f.sku.trim().toLowerCase() : ''
        if (!sku) {
            errores.push({ field: `productos.${i}.sku`, message: 'El SKU es obligatorio', rule: 'required' })
        }
        else if (skus.has(sku)) {
            errores.push({ field: `productos.${i}.sku`, message: `SKU repetido en la fila ${(skus.get(sku) ?? 0) + 1}`, rule: 'repetido' })
        }
        else if (bd.productos.some(p => p.empresa_id === empresaId && p.sku.toLowerCase() === sku)) {
            errores.push({ field: `productos.${i}.sku`, message: 'La empresa ya tiene ese SKU', rule: 'sku_duplicado' })
        }
        skus.set(sku, i)
        if (typeof f.nombre !== 'string' || f.nombre.trim().length < 2) {
            errores.push({ field: `productos.${i}.nombre`, message: 'Al menos 2 caracteres', rule: 'minLength' })
        }
        const tipo = tipoDeProducto(f.tipo, empresaId)
        if (!tipo) {
            errores.push({ field: `productos.${i}.tipo`, message: 'El tipo no existe o está desactivado', rule: 'tipo' })
        }
        const seguimiento = f.seguimiento === 'serie' || f.seguimiento === 'cantidad' ? f.seguimiento : tipo?.seguimiento_defecto
        const modalidad = f.modalidad === 'comodato' || f.modalidad === 'consumible_gasto' || f.modalidad === 'consumible_cobro' ? f.modalidad : tipo?.modalidad_defecto
        if (seguimiento && modalidad && !compatible(seguimiento, modalidad)) {
            errores.push({ field: `productos.${i}.modalidad`, message: modalidad === 'comodato' ? 'El comodato es solo por serie' : 'El gasto es solo por cantidad', rule: 'modalidad' })
        }
        const entrada = typeof f.entrada === 'object' && f.entrada !== null ? f.entrada as Record<string, unknown> : null
        if (entrada) {
            const bodega = bodegaDe(entrada.bodega_id)
            if (!bodega || bodega.empresa_id !== empresaId || bodega.tipo === TIPO_BODEGA_TRANSITO) {
                errores.push({ field: `productos.${i}.entrada.bodega_id`, message: 'Elige una bodega de la empresa', rule: 'exists' })
            }
            if (seguimiento === 'serie') {
                const unidades = Array.isArray(entrada.unidades) ? entrada.unidades : []
                if (!unidades.length) {
                    errores.push({ field: `productos.${i}.entrada.unidades`, message: 'Agrega las series', rule: 'required' })
                }
            }
            else {
                if (typeof entrada.cantidad !== 'string' || !CANTIDAD.test(entrada.cantidad)) {
                    errores.push({ field: `productos.${i}.entrada.cantidad`, message: 'Cantidad con hasta 3 decimales', rule: 'regex' })
                }
                if (typeof entrada.costo_unitario !== 'string' || !/^\d{1,12}(\.\d{1,6})?$/.test(entrada.costo_unitario)) {
                    errores.push({ field: `productos.${i}.entrada.costo_unitario`, message: 'Costo unitario con hasta 6 decimales', rule: 'regex' })
                }
            }
        }
    })
    if (errores.length) {
        return datosInvalidos(errores)
    }
    if (filas.some(f => f.entrada) && !usuario?.permisos.includes('inventario.cargar_saldo_inicial')) {
        return problema(403, 'Sin permiso', 'Falta el permiso inventario.cargar_saldo_inicial.')
    }
    // Todo o nada: se guarda una copia y, si algo falla, se restaura.
    const respaldo = { productos: [...bd.productos], movimientos: [...bd.movimientosInventario], unidades: [...bd.unidadesInventario] }
    const restaurar = (respuesta: RespuestaFixture) => {
        bd.productos.splice(0, bd.productos.length, ...respaldo.productos)
        bd.movimientosInventario.splice(0, bd.movimientosInventario.length, ...respaldo.movimientos)
        bd.unidadesInventario.splice(0, bd.unidadesInventario.length, ...respaldo.unidades)
        return respuesta
    }
    const creados: ProductoFixture[] = []
    const movimientos: Movimiento[] = []
    for (const [i, f] of filas.entries()) {
        const producto = crearProductoFixture(f, empresaId, `productos.${i}.`)
        if (esRespuesta(producto)) {
            return restaurar(producto)
        }
        creados.push(producto)
        const entrada = typeof f.entrada === 'object' && f.entrada !== null ? f.entrada as Record<string, unknown> : null
        const bodega = entrada ? bodegaDe(entrada.bodega_id) : undefined
        if (!entrada || !bodega) {
            continue
        }
        const fecha = typeof entrada.fecha === 'string' && entrada.fecha ? entrada.fecha : hoy()
        if (producto.seguimiento === 'serie') {
            for (const [j, valor] of (Array.isArray(entrada.unidades) ? entrada.unidades : []).entries()) {
                const u = typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {}
                const serie = typeof u.serie === 'string' && u.serie.trim() ? u.serie.trim().toUpperCase() : null
                const mac = typeof u.mac === 'string' && u.mac.trim() ? u.mac.trim().toUpperCase() : null
                if (bd.unidadesInventario.some(x => x.empresa_id === empresaId && ((serie && x.serie === serie) || (mac && x.mac === mac)))) {
                    return restaurar(problemaTipado(422, 'serie_duplicada', 'Serie duplicada', `productos.${i}: ya hay un equipo con la serie o MAC ${serie ?? mac}`, [{ field: `productos.${i}.entrada.unidades.${j}.serie`, message: 'Serie o MAC repetida', rule: 'serie_duplicada' }]))
                }
                const momento = ahora()
                const unidad: Unidad = { id: Math.max(0, ...bd.unidadesInventario.map(x => x.id)) + 1, empresa_id: empresaId, producto_id: producto.id, producto_sku: producto.sku, producto_nombre: producto.nombre, serie, mac, estado: 'disponible', condicion: 'nuevo', bodega_id: bodega.id, bodega_nombre: bodega.nombre, costo: monto2(typeof u.costo === 'string' ? u.costo : '0'), servicio_id: null, cliente_id: null, activo_id: null, compra_id: null, version: 1, created_at: momento, updated_at: momento }
                bd.unidadesInventario.push(unidad)
                movimientos.push(mover(producto, bodega, { tipo: 'saldo_inicial', fecha, cantidad: 1, costo_total: unidad.costo, unidad_id: unidad.id }))
            }
        }
        else {
            const cantidad = new Decimal(String(entrada.cantidad))
            movimientos.push(mover(producto, bodega, { tipo: 'saldo_inicial', fecha, cantidad, costo_total: cantidad.times(String(entrada.costo_unitario)).toDecimalPlaces(2) }))
        }
    }
    registrarAccion(solicitud, 'productos.crear_lote', { tipo: 'producto', id: creados[0]?.id ?? 0 }, { productos: filas.length })
    const respuesta: Schema<'ProductosLote'> = { data: creados.map(vistaProducto), movimientos }
    return { status: 201, cuerpo: respuesta }
}

export const rutasInventarioFaseD: RutasFixture = {
    /* Órdenes de traslado */
    'GET /api/v1/inventario/traslados': conPermiso('inventario.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const bodegaId = numeroQuery(solicitud, 'bodega_id')
        const numero = numeroQuery(solicitud, 'numero')
        const filas = deLaEmpresa(bd.inventarioFaseD.ordenes, solicitud)
            .filter(o => !estado || o.estado === estado)
            .filter(o => bodegaId === undefined || o.bodega_origen_id === bodegaId || o.bodega_destino_id === bodegaId)
            .filter(o => numero === undefined || o.numero === numero)
            .sort((a, b) => b.enviado_en.localeCompare(a.enviado_en) || b.id - a.id)
            .map(vistaLista)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'GET /api/v1/inventario/traslados/:id': conPermiso('inventario.ver', (solicitud) => {
        const orden = ordenDe(idDe(solicitud))
        return orden ? { status: 200, cuerpo: orden } : problemaTipado(404, 'traslado_no_encontrado', 'Traslado no encontrado', 'La orden no existe')
    }),
    'POST /api/v1/inventario/traslados/enviar': conPermiso('inventario.crear_traslado', conIdempotencia(enviarOrden)),
    'POST /api/v1/inventario/traslados/:id/recibir': conPermiso('inventario.recibir_traslado', conIdempotencia(recibirOrden)),
    'POST /api/v1/inventario/traslados/:id/cancelar': conPermiso('inventario.cancelar_traslado', conIdempotencia(cancelarOrden)),
    'POST /api/v1/inventario/traslados/:id/documento': conPermiso('inventario.adjuntar_documento_traslado', conIdempotencia(adjuntarDocumento)),
    'GET /api/v1/inventario/traslados/:id/documento': conPermiso('inventario.ver', (solicitud) => {
        const documento = bd.inventarioFaseD.documentos[idDe(solicitud) ?? 0]
        return documento ? { status: 200, cuerpo: documento.bytes, contentType: documento.tipo } : noEncontrado('el documento firmado')
    }),
    'GET /api/v1/inventario/traslados/:id/firma': conPermiso('inventario.ver', (solicitud) => {
        const firma = bd.inventarioFaseD.firmas[idDe(solicitud) ?? 0]
        return firma ? { status: 200, cuerpo: firma, contentType: 'image/png' } : noEncontrado('la firma')
    }),
    'GET /api/v1/inventario/traslados/:id/pdf': conPermiso('inventario.ver', (solicitud) => {
        const orden = ordenDe(idDe(solicitud))
        return orden ? { status: 200, cuerpo: pdfFixture(`Orden de traslado N. ${orden.numero}`), contentType: 'application/pdf' } : problemaTipado(404, 'traslado_no_encontrado', 'Traslado no encontrado', 'La orden no existe')
    }),

    /* Configuración */
    'GET /api/v1/inventario/configuracion': conPermiso('inventario.ver', solicitud => ({ status: 200, cuerpo: configuracionDe(solicitud) })),
    'POST /api/v1/inventario/configuracion': conPermiso('inventario.configurar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const actual = configuracionDe(solicitud)
        if (typeof cuerpo.traslado_firma_obligatoria !== 'boolean') {
            return datosInvalidos([{ field: 'traslado_firma_obligatoria', message: 'Sí o no', rule: 'boolean' }])
        }
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const nueva = { ...actual, traslado_firma_obligatoria: cuerpo.traslado_firma_obligatoria, version: actual.version + 1 }
        bd.inventarioFaseD.configuracion = [...bd.inventarioFaseD.configuracion.filter(c => c.empresa_id !== nueva.empresa_id), nueva]
        registrarAccion(solicitud, 'inventario.configurar', { tipo: 'configuracion_inventario', id: nueva.empresa_id }, cuerpo)
        return { status: 200, cuerpo: nueva }
    })),
    'GET /api/v1/inventario/ia/configuracion': conPermiso('inventario.configurar_ia', (solicitud) => {
        const configuracion = iaDe(solicitud)
        return configuracion ? { status: 200, cuerpo: configuracion } : noEncontrado('una IA configurada')
    }),
    'POST /api/v1/inventario/ia/configuracion': conPermiso('inventario.configurar_ia', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const empresaId = cuerpo.global === true ? null : (empresaActivaDe(solicitud) ?? 1)
        if (empresaId === null && usuarioDe(solicitud)?.alcance_global !== true) {
            return sinAlcance('La IA global solo se configura con alcance global')
        }
        const proveedor = cuerpo.proveedor
        const errores: Errores = []
        if (proveedor !== 'privada' && proveedor !== 'anthropic' && proveedor !== 'deepseek' && proveedor !== 'openai') {
            errores.push({ field: 'proveedor', message: 'Elige el proveedor', rule: 'enum' })
        }
        if (typeof cuerpo.modelo !== 'string' || !cuerpo.modelo.trim()) {
            errores.push({ field: 'modelo', message: 'Escribe el modelo', rule: 'required' })
        }
        if (proveedor === 'privada' && (typeof cuerpo.url_base !== 'string' || !/^https?:\/\//.test(cuerpo.url_base))) {
            errores.push({ field: 'url_base', message: 'La URL base es obligatoria en una IA privada', rule: 'required' })
        }
        if (errores.length || (proveedor !== 'privada' && proveedor !== 'anthropic' && proveedor !== 'deepseek' && proveedor !== 'openai')) {
            return datosInvalidos(errores)
        }
        const actual = bd.inventarioFaseD.ia.find(c => c.empresa_id === empresaId)
        if (cuerpo.version !== (actual?.version ?? 0)) {
            return versionCambiada()
        }
        const momento = ahora()
        const nueva: Schema<'ConfiguracionIa'> = {
            id: actual?.id ?? Math.max(0, ...bd.inventarioFaseD.ia.map(c => c.id)) + 1,
            empresa_id: empresaId,
            proveedor,
            modelo: String(cuerpo.modelo).trim(),
            url_base: typeof cuerpo.url_base === 'string' && cuerpo.url_base ? cuerpo.url_base : null,
            activo: cuerpo.activo === true,
            clave_configurada: 'api_key' in cuerpo ? typeof cuerpo.api_key === 'string' && cuerpo.api_key.length > 0 : (actual?.clave_configurada ?? false),
            version: (actual?.version ?? 0) + 1,
            created_at: actual?.created_at ?? momento,
            updated_at: momento,
        }
        bd.inventarioFaseD.ia = [...bd.inventarioFaseD.ia.filter(c => c.empresa_id !== empresaId), nueva]
        registrarAccion(solicitud, 'inventario.configurar_ia', { tipo: 'configuracion_ia', id: nueva.id }, { ...cuerpo, api_key: 'api_key' in cuerpo ? '***' : undefined })
        return { status: 200, cuerpo: nueva }
    })),

    /* Tipos de producto */
    'GET /api/v1/inventario/tipos-producto': conPermiso('inventario.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const empresaId = empresaActivaDe(solicitud)
        const filas = bd.inventarioFaseD.tiposProducto
            .filter(t => t.empresa_id === null || empresaId === null || t.empresa_id === empresaId)
            .filter(t => activo === null || String(t.activo) === activo)
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'POST /api/v1/inventario/tipos-producto': conPermiso('tipos_producto.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = leerTipo(cuerpo, false)
        const seguimiento = cuerpo.seguimiento_defecto === 'serie' ? 'serie' : 'cantidad'
        const modalidad = cuerpo.modalidad_defecto === 'comodato' || cuerpo.modalidad_defecto === 'consumible_cobro' ? cuerpo.modalidad_defecto : 'consumible_gasto'
        if (!compatible(seguimiento, modalidad)) {
            errores.push({ field: 'modalidad_defecto', message: 'La modalidad no va con ese seguimiento', rule: 'modalidad_defecto' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const global = cuerpo.global === true
        if (global && usuarioDe(solicitud)?.alcance_global !== true) {
            return sinAlcance('Un tipo global solo se crea con alcance global')
        }
        const empresaId = global ? null : (empresaActivaDe(solicitud) ?? 1)
        const codigo = String(cuerpo.codigo)
        if (bd.inventarioFaseD.tiposProducto.some(t => t.codigo === codigo && (t.empresa_id === null || t.empresa_id === empresaId))) {
            return conflicto('codigo_duplicado', `Ya hay un tipo con el código ${codigo}`, 'Código duplicado')
        }
        const momento = ahora()
        const tipo: TipoProducto = { id: Math.max(0, ...bd.inventarioFaseD.tiposProducto.map(t => t.id)) + 1, empresa_id: empresaId, codigo, nombre: String(cuerpo.nombre).trim(), seguimiento_defecto: seguimiento, modalidad_defecto: modalidad, activo: true, version: 1, created_at: momento, updated_at: momento }
        bd.inventarioFaseD.tiposProducto.push(tipo)
        registrarAccion(solicitud, 'tipos_producto.crear', { tipo: 'tipo_producto', id: tipo.id }, cuerpo)
        return { status: 201, cuerpo: tipo }
    })),
    'POST /api/v1/inventario/tipos-producto/:id/editar': conPermiso('tipos_producto.editar', (solicitud) => {
        const tipo = tipoEditable(solicitud)
        if (esRespuesta(tipo)) {
            return tipo
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = leerTipo(cuerpo, true)
        const seguimiento = cuerpo.seguimiento_defecto === 'serie' || cuerpo.seguimiento_defecto === 'cantidad' ? cuerpo.seguimiento_defecto : tipo.seguimiento_defecto
        const modalidad = cuerpo.modalidad_defecto === 'comodato' || cuerpo.modalidad_defecto === 'consumible_gasto' || cuerpo.modalidad_defecto === 'consumible_cobro' ? cuerpo.modalidad_defecto : tipo.modalidad_defecto
        if (!compatible(seguimiento, modalidad)) {
            errores.push({ field: 'modalidad_defecto', message: 'La modalidad no va con ese seguimiento', rule: 'modalidad_defecto' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        Object.assign(tipo, { nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : tipo.nombre, seguimiento_defecto: seguimiento, modalidad_defecto: modalidad, version: tipo.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'tipos_producto.editar', { tipo: 'tipo_producto', id: tipo.id }, cuerpo)
        return { status: 200, cuerpo: tipo }
    }),
    'POST /api/v1/inventario/tipos-producto/:id/desactivar': conPermiso('tipos_producto.desactivar', (solicitud) => {
        const tipo = tipoEditable(solicitud)
        if (esRespuesta(tipo)) {
            return tipo
        }
        Object.assign(tipo, { activo: false, version: tipo.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'tipos_producto.desactivar', { tipo: 'tipo_producto', id: tipo.id }, cuerpoObjeto(solicitud))
        return { status: 200, cuerpo: tipo }
    }),

    /* Técnicos y «Mi bodega» */
    'GET /api/v1/inventario/tecnicos': conPermiso('inventario.ver', (solicitud) => {
        const porUsuario = new Map<number, Schema<'TecnicoInventario'>>()
        for (const b of deLaEmpresa(bd.bodegas, solicitud).filter(x => x.tipo === 'tecnico' && x.usuario_id !== null)) {
            const usuario = bd.usuarios.find(u => u.id === b.usuario_id)
            if (!usuario) {
                continue
            }
            const fila = porUsuario.get(usuario.id) ?? { id_externo: String(usuario.id), correo: usuario.email, nombre: usuario.nombre, bodegas: [] }
            fila.bodegas.push({ id: b.id, empresa_id: b.empresa_id, activa: b.activo })
            porUsuario.set(usuario.id, fila)
        }
        return { status: 200, cuerpo: paginar([...porUsuario.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)), solicitud) }
    }),
    'GET /api/v1/inventario/mi-bodega': conPermiso('inventario.ver', (solicitud) => {
        const usuario = usuarioDe(solicitud)
        const otro = numeroQuery(solicitud, 'usuario_id') ?? (solicitud.query.get('id_externo') ? Number(solicitud.query.get('id_externo')) : undefined)
        const correo = solicitud.query.get('correo')?.toLowerCase()
        const pedido = correo ? bd.usuarios.find(u => u.email.toLowerCase() === correo)?.id : otro
        if ((otro !== undefined || correo) && pedido !== usuario?.id && usuario?.alcance_global !== true) {
            return problema(403, 'Sin permiso', 'Solo con alcance global se consulta la bodega de otro técnico.')
        }
        const usuarioId = pedido ?? usuario?.id
        if ((otro !== undefined || correo) && !bd.usuarios.some(u => u.id === usuarioId && u.activo)) {
            return problemaTipado(422, 'tecnico_no_encontrado', 'Técnico no encontrado', 'No hay un usuario activo para ese técnico')
        }
        const empresaId = numeroQuery(solicitud, 'empresa_id') ?? empresaActivaDe(solicitud)
        const bodegas = bd.bodegas.filter(b => b.tipo === 'tecnico' && b.usuario_id === usuarioId && b.activo && (empresaId === null || empresaId === undefined || b.empresa_id === empresaId))
        const [bodega] = bodegas
        if (!bodega) {
            return problemaTipado(404, 'tecnico_sin_bodega', 'Técnico sin bodega', 'El técnico no tiene bodega activa en esta empresa')
        }
        if (bodegas.length > 1) {
            return { status: 200, cuerpo: { bodegas } }
        }
        return { status: 200, cuerpo: vistaMiBodega(bodega, solicitud) }
    }),

    /* Consumo con modalidad y alta por lote */
    'POST /api/v1/inventario/consumos': conPermiso('inventario.consumir', conIdempotencia(consumir)),
    'POST /api/v1/productos/lote': conPermiso('productos.crear_lote', conIdempotencia(crearLote)),
}
