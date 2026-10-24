import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { agregarMovimiento, cantidad3, costoSalida, monto2, saldoDe } from './kardex'
import { FECHAS_COMODATO } from './datos'

type Producto = Schema<'Producto'>
type Bodega = Schema<'Bodega'>
type Movimiento = Schema<'MovimientoInventario'>
type Unidad = Schema<'UnidadInventario'>
type Errores = NonNullable<Problem['errors']>

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/
const CANTIDAD_CON_SIGNO = /^-?\d{1,11}(\.\d{1,3})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const hoy = () => ahora().slice(0, 10)

/** 409 con el título del código, como la API (`existencia_insuficiente` → «Existencia insuficiente»). */
const conflicto = (codigo: string, detalle: string, titulo?: string): RespuestaFixture => {
    const texto = codigo.replaceAll('_', ' ')
    return problemaTipado(409, codigo, titulo ?? texto.charAt(0).toUpperCase() + texto.slice(1), detalle)
}
const regla = (codigo: string, detalle: string, campo?: string): RespuestaFixture => problemaTipado(422, codigo, 'Regla de negocio', detalle, campo ? [{ field: campo, message: detalle, rule: codigo }] : undefined)

/** Producto con su existencia y valor totales (todas sus bodegas), como `GET /productos`. */
function vistaProducto(p: Producto): Producto {
    const propios = bd.movimientosInventario.filter(m => m.producto_id === p.id)
    const cantidad = propios.reduce((t, m) => t.plus(m.cantidad), new Decimal(0))
    const valor = propios.reduce((t, m) => t.plus(m.costo_total), new Decimal(0))
    return { ...p, existencia: cantidad3(cantidad), valor: monto2(valor) }
}

function productoDe(id: unknown): Producto | undefined {
    return bd.productos.find(p => p.id === id)
}

function bodegaDe(id: unknown): Bodega | undefined {
    return bd.bodegas.find(b => b.id === id)
}

function nombres(producto: Producto, bodega: Bodega) {
    return { producto, bodega: bodega.nombre }
}

function mover(producto: Producto, bodega: Bodega, datos: Omit<Parameters<typeof agregarMovimiento>[2], 'producto_id' | 'bodega_id' | 'fecha'> & { fecha?: string }): Movimiento {
    return agregarMovimiento(bd.movimientosInventario, nombres(producto, bodega), { ...datos, fecha: datos.fecha || hoy(), producto_id: producto.id, bodega_id: bodega.id }, ahora())
}

/** Producto y bodega de la petición, de la misma empresa (404 si no). */
function productoYBodega(cuerpo: Record<string, unknown>, campoBodega = 'bodega_id'): { producto: Producto, bodega: Bodega } | RespuestaFixture {
    const producto = productoDe(cuerpo.producto_id)
    const bodega = bodegaDe(cuerpo[campoBodega])
    if (!producto) {
        return noEncontrado('el producto')
    }
    if (!bodega || bodega.empresa_id !== producto.empresa_id) {
        return noEncontrado('la bodega')
    }
    if (!bodega.activo || !producto.activo) {
        return regla('inactivo', 'El producto o la bodega están desactivados')
    }
    return { producto, bodega }
}

function esRespuesta<T extends object>(valor: T | RespuestaFixture): valor is RespuestaFixture {
    return 'status' in valor && 'cuerpo' in valor
}

/** Unidad nueva de un producto de serie: serie o MAC, únicas entre las vivas de la empresa. */
function nuevaUnidad(producto: Producto, bodega: Bodega, datos: unknown, costo: Decimal, condicion: Unidad['condicion']): Unidad | RespuestaFixture {
    const entrada = typeof datos === 'object' && datos !== null ? datos as Record<string, unknown> : {}
    const serie = typeof entrada.serie === 'string' && entrada.serie.trim() ? entrada.serie.trim().toUpperCase() : null
    const mac = typeof entrada.mac === 'string' && entrada.mac.trim() ? normalizarMac(entrada.mac) : null
    if (!serie && !mac) {
        return datosInvalidos([{ field: 'unidad.serie', message: 'Escribe la serie o la MAC', rule: 'required' }])
    }
    const muertas: Unidad['estado'][] = ['anulada', 'devuelta_proveedor']
    if (bd.unidadesInventario.some(u => u.empresa_id === producto.empresa_id && !muertas.includes(u.estado) && ((serie && u.serie === serie) || (mac && u.mac === mac)))) {
        return regla('serie_duplicada', `Ya hay un equipo con la serie o MAC ${serie ?? mac}`, serie ? 'unidad.serie' : 'unidad.mac')
    }
    const momento = ahora()
    const unidad: Unidad = {
        id: Math.max(0, ...bd.unidadesInventario.map(u => u.id)) + 1,
        empresa_id: producto.empresa_id,
        producto_id: producto.id,
        producto_sku: producto.sku,
        producto_nombre: producto.nombre,
        serie,
        mac,
        estado: 'disponible',
        condicion,
        bodega_id: bodega.id,
        bodega_nombre: bodega.nombre,
        costo: monto2(costo),
        servicio_id: null,
        cliente_id: null,
        activo_id: null,
        compra_id: null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    bd.unidadesInventario.push(unidad)
    return unidad
}

/** MAC como la guarda la API: `AA:BB:CC:DD:EE:FF`. */
export function normalizarMac(mac: string): string {
    const limpia = mac.replace(/[^0-9a-f]/gi, '').toUpperCase()
    return limpia.length === 12 ? limpia.match(/.{2}/g)?.join(':') ?? mac : mac.toUpperCase()
}

/** Unidad disponible (o en reparación, para bajas y traslados) en la bodega pedida. */
function unidadEnBodega(id: unknown, producto: Producto, bodega: Bodega, enReparacion = false): Unidad | RespuestaFixture {
    const unidad = bd.unidadesInventario.find(u => u.id === id && u.producto_id === producto.id)
    if (!unidad) {
        return noEncontrado('el equipo')
    }
    if (unidad.estado === 'en_comodato' || unidad.estado === 'por_recuperar') {
        return conflicto('unidad_en_comodato', 'El equipo está en comodato: devuélvelo o declara la pérdida antes')
    }
    const estados: Unidad['estado'][] = enReparacion ? ['disponible', 'en_reparacion'] : ['disponible']
    if (!estados.includes(unidad.estado) || unidad.bodega_id !== bodega.id) {
        return conflicto('unidad_no_disponible', 'El equipo no está disponible en esa bodega')
    }
    return unidad
}

function cantidadDe(valor: unknown, campo = 'cantidad', conSigno = false): Decimal | RespuestaFixture {
    if (typeof valor !== 'string' || !(conSigno ? CANTIDAD_CON_SIGNO : CANTIDAD).test(valor) || new Decimal(valor).isZero()) {
        return datosInvalidos([{ field: campo, message: 'Cantidad mayor que 0, hasta 3 decimales', rule: 'regex' }])
    }
    return new Decimal(valor)
}

function fechaDe(valor: unknown): string | RespuestaFixture {
    if (valor === undefined || valor === null || valor === '') {
        return hoy()
    }
    if (typeof valor !== 'string' || !FECHA.test(valor)) {
        return datosInvalidos([{ field: 'fecha', message: 'Fecha AAAA-MM-DD', rule: 'date' }])
    }
    return valor > hoy() ? regla('futuro', 'La fecha no puede ser futura', 'fecha') : valor
}

/** Salida por cantidad al promedio; 409 si no alcanza. */
function salida(producto: Producto, bodega: Bodega, cantidad: Decimal, datos: Omit<Parameters<typeof mover>[2], 'cantidad' | 'costo_total'>): Movimiento | RespuestaFixture {
    const costo = costoSalida(bd.movimientosInventario, producto.id, bodega.id, cantidad)
    if (costo === null) {
        return conflicto('existencia_insuficiente', `No alcanza la existencia de ${producto.nombre} en ${bodega.nombre}`)
    }
    return mover(producto, bodega, { ...datos, cantidad: cantidad.negated(), costo_total: costo.negated() })
}

function equipoDe(unidad: Unidad): Schema<'EquipoServicio'> {
    const asignado = bd.movimientosInventario.filter(m => m.unidad_id === unidad.id && m.tipo === 'asignacion_comodato').at(-1)
    return { ...unidad, valor_libros: unidad.activo_id ? unidad.costo : null, fecha_asignacion: asignado?.fecha ?? FECHAS_COMODATO[unidad.id] ?? null }
}

function actualizarUnidad(unidad: Unidad, cambios: Partial<Unidad>): Unidad {
    Object.assign(unidad, cambios, { version: unidad.version + 1, updated_at: ahora() })
    return unidad
}

function filtrarProductos(solicitud: SolicitudFixture): Producto[] {
    const q = (solicitud.query.get('q') ?? '').trim().toLowerCase()
    const tipo = solicitud.query.get('tipo')
    const seguimiento = solicitud.query.get('seguimiento')
    const activo = solicitud.query.get('activo')
    return deLaEmpresa(bd.productos, solicitud)
        .filter(p => !q || p.sku.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q))
        .filter(p => !tipo || p.tipo === tipo)
        .filter(p => !seguimiento || p.seguimiento === seguimiento)
        .filter(p => activo === null || String(p.activo) === activo)
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .map(vistaProducto)
}

function textoProducto(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    const sku = cuerpo.sku
    const nombre = cuerpo.nombre
    if ((!parcial || (sku !== undefined && sku !== null)) && (typeof sku !== 'string' || !sku.trim() || sku.length > 60)) {
        errores.push({ field: 'sku', message: 'El SKU es obligatorio (hasta 60)', rule: 'required' })
    }
    if ((!parcial || (nombre !== undefined && nombre !== null)) && (typeof nombre !== 'string' || nombre.trim().length < 2)) {
        errores.push({ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' })
    }
    if (cuerpo.precio_venta !== undefined && cuerpo.precio_venta !== null && (typeof cuerpo.precio_venta !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(cuerpo.precio_venta))) {
        errores.push({ field: 'precio_venta', message: 'Precio con hasta 2 decimales, sin signo', rule: 'regex' })
    }
    if (cuerpo.existencia_minima !== undefined && cuerpo.existencia_minima !== null && (typeof cuerpo.existencia_minima !== 'string' || !CANTIDAD.test(cuerpo.existencia_minima))) {
        errores.push({ field: 'existencia_minima', message: 'Cantidad con hasta 3 decimales', rule: 'regex' })
    }
    return errores
}

function lineaConteo(conteo: Schema<'ConteoInventarioDetalle'>, producto: Producto, cuerpo: Record<string, unknown>): Schema<'ConteoInventarioDetalle'>['lineas'][number] | RespuestaFixture {
    const saldo = saldoDe(bd.movimientosInventario, producto.id, conteo.bodega_id)
    const serie = producto.seguimiento === 'serie'
    const series = Array.isArray(cuerpo.series) ? cuerpo.series.filter((s): s is string => typeof s === 'string').map(s => s.trim().toUpperCase()).filter(Boolean) : []
    let contado: Decimal
    if (serie) {
        contado = new Decimal(series.length)
    }
    else {
        const leida = cantidadDe(cuerpo.contado, 'contado')
        if (esRespuesta(leida)) {
            if (cuerpo.contado === '0' || cuerpo.contado === '0.000') {
                contado = new Decimal(0)
            }
            else {
                return leida
            }
        }
        else {
            contado = leida
        }
    }
    const diferencia = contado.minus(saldo.cantidad)
    const promedio = saldo.cantidad.isZero() ? null : saldo.valor.dividedBy(saldo.cantidad)
    const costo = typeof cuerpo.costo_unitario === 'string' && cuerpo.costo_unitario ? new Decimal(cuerpo.costo_unitario) : promedio
    const momento = ahora()
    return {
        id: Math.max(0, ...bd.conteosInventario.flatMap(c => c.lineas.map(l => l.id))) + 1,
        producto_id: producto.id,
        producto_sku: producto.sku,
        producto_nombre: producto.nombre,
        seguimiento: producto.seguimiento,
        contado: cantidad3(contado),
        series,
        costo_unitario: typeof cuerpo.costo_unitario === 'string' && cuerpo.costo_unitario ? new Decimal(cuerpo.costo_unitario).toFixed(6) : null,
        esperado: cantidad3(saldo.cantidad),
        diferencia: cantidad3(diferencia),
        valor_diferencia: costo ? monto2(diferencia.times(costo)) : null,
        capturado_en: momento,
        esperado_captura: cantidad3(saldo.cantidad),
        valor_captura: monto2(saldo.valor),
        movimientos_desde_captura: 0,
    }
}

export const rutasInventario: RutasFixture = {
    /* Productos */
    'GET /api/v1/productos': conPermiso('inventario.ver', solicitud => ({ status: 200, cuerpo: paginar(filtrarProductos(solicitud), solicitud) })),

    'GET /api/v1/productos/:id': conPermiso('inventario.ver', (solicitud) => {
        const producto = productoDe(idDe(solicitud))
        return producto ? { status: 200, cuerpo: vistaProducto(producto) } : noEncontrado('el producto')
    }),

    /** Como `CrearProducto` (A3): SKU único por empresa (409 `sku_duplicado`). */
    'POST /api/v1/productos': conPermiso('productos.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = textoProducto(cuerpo, false)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
        const sku = String(cuerpo.sku).trim()
        if (bd.productos.some(p => p.empresa_id === empresaId && p.sku.toLowerCase() === sku.toLowerCase())) {
            return conflicto('sku_duplicado', `La empresa ya tiene un producto con el SKU ${sku}`, 'SKU duplicado')
        }
        const seguimiento = cuerpo.seguimiento === 'serie' ? 'serie' : 'cantidad'
        const momento = ahora()
        const producto: Producto = {
            id: Math.max(0, ...bd.productos.map(p => p.id)) + 1,
            empresa_id: empresaId,
            sku,
            nombre: String(cuerpo.nombre).trim(),
            unidad: typeof cuerpo.unidad === 'string' && cuerpo.unidad.trim() ? cuerpo.unidad.trim() : 'unidad',
            tipo: cuerpo.tipo === 'equipo' || cuerpo.tipo === 'otro' ? cuerpo.tipo : 'material',
            seguimiento,
            clase_activo: seguimiento === 'serie' ? (typeof cuerpo.clase_activo === 'string' ? cuerpo.clase_activo : 'equipo_red') : null,
            concepto_cargo_id: typeof cuerpo.concepto_cargo_id === 'number' ? cuerpo.concepto_cargo_id : null,
            cuenta_costo: typeof cuerpo.cuenta_costo === 'string' ? cuerpo.cuenta_costo : null,
            cuenta_consumo: typeof cuerpo.cuenta_consumo === 'string' ? cuerpo.cuenta_consumo : null,
            existencia_minima: typeof cuerpo.existencia_minima === 'string' ? cantidad3(cuerpo.existencia_minima) : null,
            precio_venta: typeof cuerpo.precio_venta === 'string' ? monto2(cuerpo.precio_venta) : null,
            activo: true,
            existencia: '0.000',
            valor: '0.00',
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.productos.push(producto)
        registrarAccion(solicitud, 'productos.crear', { tipo: 'producto', id: producto.id }, cuerpo)
        return { status: 201, cuerpo: vistaProducto(producto) }
    })),

    /** Como `EditarProducto`: con `version`; el seguimiento no cambia si ya tiene movimientos. */
    'POST /api/v1/productos/:id/editar': conPermiso('productos.editar', (solicitud) => {
        const producto = productoDe(idDe(solicitud))
        if (!producto) {
            return noEncontrado('el producto')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = textoProducto(cuerpo, true)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== producto.version) {
            return versionCambiada()
        }
        if (typeof cuerpo.seguimiento === 'string' && cuerpo.seguimiento !== producto.seguimiento && bd.movimientosInventario.some(m => m.producto_id === producto.id)) {
            return conflicto('seguimiento_con_movimientos', 'El producto ya tiene movimientos: su seguimiento no cambia')
        }
        const texto = (campo: 'sku' | 'nombre' | 'unidad') => (typeof cuerpo[campo] === 'string' ? String(cuerpo[campo]).trim() : producto[campo])
        Object.assign(producto, {
            sku: texto('sku'),
            nombre: texto('nombre'),
            unidad: texto('unidad'),
            tipo: cuerpo.tipo === 'equipo' || cuerpo.tipo === 'material' || cuerpo.tipo === 'otro' ? cuerpo.tipo : producto.tipo,
            seguimiento: cuerpo.seguimiento === 'serie' || cuerpo.seguimiento === 'cantidad' ? cuerpo.seguimiento : producto.seguimiento,
            clase_activo: 'clase_activo' in cuerpo ? (typeof cuerpo.clase_activo === 'string' ? cuerpo.clase_activo : null) : producto.clase_activo,
            cuenta_costo: 'cuenta_costo' in cuerpo ? (typeof cuerpo.cuenta_costo === 'string' ? cuerpo.cuenta_costo : null) : producto.cuenta_costo,
            cuenta_consumo: 'cuenta_consumo' in cuerpo ? (typeof cuerpo.cuenta_consumo === 'string' ? cuerpo.cuenta_consumo : null) : producto.cuenta_consumo,
            existencia_minima: 'existencia_minima' in cuerpo ? (typeof cuerpo.existencia_minima === 'string' ? cantidad3(cuerpo.existencia_minima) : null) : producto.existencia_minima,
            precio_venta: 'precio_venta' in cuerpo ? (typeof cuerpo.precio_venta === 'string' ? monto2(cuerpo.precio_venta) : null) : producto.precio_venta,
            version: producto.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'productos.editar', { tipo: 'producto', id: producto.id }, cuerpo)
        return { status: 200, cuerpo: vistaProducto(producto) }
    }),

    /** Como `DesactivarProducto`: existencia 0 (409 `producto_con_existencias`). */
    'POST /api/v1/productos/:id/desactivar': conPermiso('productos.desactivar', (solicitud) => {
        const producto = productoDe(idDe(solicitud))
        if (!producto) {
            return noEncontrado('el producto')
        }
        if (cuerpoObjeto(solicitud).version !== producto.version) {
            return versionCambiada()
        }
        if (!new Decimal(vistaProducto(producto).existencia).isZero()) {
            return conflicto('producto_con_existencias', `${producto.nombre} todavía tiene existencias`)
        }
        Object.assign(producto, { activo: false, version: producto.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'productos.desactivar', { tipo: 'producto', id: producto.id }, cuerpoObjeto(solicitud))
        return { status: 200, cuerpo: vistaProducto(producto) }
    }),

    /* Bodegas */
    'GET /api/v1/bodegas': conPermiso('inventario.ver', (solicitud) => {
        const tipo = solicitud.query.get('tipo')
        const activo = solicitud.query.get('activo')
        const usuario = numeroQuery(solicitud, 'usuario_id')
        const filas = deLaEmpresa(bd.bodegas, solicitud)
            .filter(b => !tipo || b.tipo === tipo)
            .filter(b => activo === null || String(b.activo) === activo)
            .filter(b => usuario === undefined || b.usuario_id === usuario)
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/bodegas/:id': conPermiso('inventario.ver', (solicitud) => {
        const bodega = bodegaDe(idDe(solicitud))
        return bodega ? { status: 200, cuerpo: bodega } : noEncontrado('la bodega')
    }),

    /** Como `CrearBodega`: una de técnico exige `usuario_id`. */
    'POST /api/v1/bodegas': conPermiso('bodegas.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        const tipo = cuerpo.tipo === 'tecnico' ? 'tecnico' : 'bodega'
        const usuario = tipo === 'tecnico' ? bd.usuarios.find(u => u.id === cuerpo.usuario_id) : undefined
        const errores: Errores = [
            ...(nombre.length < 2 ? [{ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' }] : []),
            ...(tipo === 'tecnico' && !usuario ? [{ field: 'usuario_id', message: 'Una bodega de técnico lleva su usuario', rule: 'required' }] : []),
        ]
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const momento = ahora()
        const bodega: Bodega = {
            id: Math.max(0, ...bd.bodegas.map(b => b.id)) + 1,
            empresa_id: typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1),
            nombre,
            tipo,
            usuario_id: usuario?.id ?? null,
            usuario_nombre: usuario?.nombre ?? null,
            zona_id: typeof cuerpo.zona_id === 'number' ? cuerpo.zona_id : null,
            router_id: typeof cuerpo.router_id === 'number' ? cuerpo.router_id : null,
            activo: true,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.bodegas.push(bodega)
        registrarAccion(solicitud, 'bodegas.crear', { tipo: 'bodega', id: bodega.id }, cuerpo)
        return { status: 201, cuerpo: bodega }
    })),

    /** Como `EditarBodega`: cambiar el técnico de una bodega con existencias es 409. */
    'POST /api/v1/bodegas/:id/editar': conPermiso('bodegas.editar', (solicitud) => {
        const bodega = bodegaDe(idDe(solicitud))
        if (!bodega) {
            return noEncontrado('la bodega')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim().length < 2) {
            return datosInvalidos([{ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' }])
        }
        if (cuerpo.version !== bodega.version) {
            return versionCambiada()
        }
        const conExistencias = bd.productos.some(p => !saldoDe(bd.movimientosInventario, p.id, bodega.id).cantidad.isZero())
        if ('usuario_id' in cuerpo && cuerpo.usuario_id !== bodega.usuario_id && conExistencias) {
            return conflicto('bodega_con_existencias', 'La bodega tiene existencias: traslada antes de cambiar el técnico')
        }
        const usuario = typeof cuerpo.usuario_id === 'number' ? bd.usuarios.find(u => u.id === cuerpo.usuario_id) : undefined
        Object.assign(bodega, {
            nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : bodega.nombre,
            usuario_id: 'usuario_id' in cuerpo ? (usuario?.id ?? null) : bodega.usuario_id,
            usuario_nombre: 'usuario_id' in cuerpo ? (usuario?.nombre ?? null) : bodega.usuario_nombre,
            version: bodega.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'bodegas.editar', { tipo: 'bodega', id: bodega.id }, cuerpo)
        return { status: 200, cuerpo: bodega }
    }),

    'POST /api/v1/bodegas/:id/desactivar': conPermiso('bodegas.desactivar', (solicitud) => {
        const bodega = bodegaDe(idDe(solicitud))
        if (!bodega) {
            return noEncontrado('la bodega')
        }
        if (cuerpoObjeto(solicitud).version !== bodega.version) {
            return versionCambiada()
        }
        if (bd.productos.some(p => !saldoDe(bd.movimientosInventario, p.id, bodega.id).cantidad.isZero())) {
            return conflicto('bodega_con_existencias', `${bodega.nombre} todavía tiene existencias`)
        }
        Object.assign(bodega, { activo: false, version: bodega.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'bodegas.desactivar', { tipo: 'bodega', id: bodega.id }, cuerpoObjeto(solicitud))
        return { status: 200, cuerpo: bodega }
    }),

    /* Existencias y kardex */
    'GET /api/v1/inventario/existencias': conPermiso('inventario.ver', (solicitud) => {
        const productoId = numeroQuery(solicitud, 'producto_id')
        const bodegaId = numeroQuery(solicitud, 'bodega_id')
        const bajoMinimo = solicitud.query.get('bajo_minimo') === 'true'
        const pares = new Map<string, { producto: Producto, bodega: Bodega }>()
        for (const m of deLaEmpresa(bd.movimientosInventario, solicitud)) {
            const producto = productoDe(m.producto_id)
            const bodega = bodegaDe(m.bodega_id)
            if (producto && bodega) {
                pares.set(`${producto.id}/${bodega.id}`, { producto, bodega })
            }
        }
        const filas: Schema<'ExistenciaInventario'>[] = [...pares.values()].map(({ producto, bodega }, indice) => {
            const saldo = saldoDe(bd.movimientosInventario, producto.id, bodega.id)
            const total = new Decimal(vistaProducto(producto).existencia)
            return {
                id: indice + 1,
                empresa_id: producto.empresa_id,
                producto_id: producto.id,
                producto_sku: producto.sku,
                producto_nombre: producto.nombre,
                unidad: producto.unidad,
                bodega_id: bodega.id,
                bodega_nombre: bodega.nombre,
                bodega_tipo: bodega.tipo,
                cantidad: cantidad3(saldo.cantidad),
                valor: monto2(saldo.valor),
                costo_promedio: saldo.cantidad.isZero() ? null : saldo.valor.dividedBy(saldo.cantidad).toFixed(6),
                existencia_total: cantidad3(total),
                existencia_minima: producto.existencia_minima,
                bajo_minimo: producto.existencia_minima !== null && total.lessThan(producto.existencia_minima),
            }
        })
            .filter(f => productoId === undefined || f.producto_id === productoId)
            .filter(f => bodegaId === undefined || f.bodega_id === bodegaId)
            .filter(f => !bajoMinimo || f.bajo_minimo)
            .sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre) || a.bodega_nombre.localeCompare(b.bodega_nombre))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/inventario/movimientos': conPermiso('inventario.ver', (solicitud) => {
        const productoId = numeroQuery(solicitud, 'producto_id')
        const bodegaId = numeroQuery(solicitud, 'bodega_id')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        const tipo = solicitud.query.get('tipo')
        const filas = deLaEmpresa(bd.movimientosInventario, solicitud)
            .filter(m => productoId === undefined || m.producto_id === productoId)
            .filter(m => bodegaId === undefined || m.bodega_id === bodegaId)
            .filter(m => !desde || m.fecha >= desde)
            .filter(m => !hasta || m.fecha <= hasta)
            .filter(m => !tipo || m.tipo === tipo)
            .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /* Operaciones */
    /** Como `CargarSaldoInicial`: una vez por producto y bodega, antes de otro movimiento allí (por cantidad). */
    'POST /api/v1/inventario/saldos-iniciales': conPermiso('inventario.cargar_saldo_inicial', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const par = productoYBodega(cuerpo)
        if (esRespuesta(par)) {
            return par
        }
        const fecha = fechaDe(cuerpo.fecha)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const { producto, bodega } = par
        const previos = bd.movimientosInventario.filter(m => m.producto_id === producto.id && m.bodega_id === bodega.id)
        const costoUnitario = typeof cuerpo.costo_unitario === 'string' && cuerpo.costo_unitario ? new Decimal(cuerpo.costo_unitario) : null
        if (producto.seguimiento === 'serie') {
            if (previos.some(m => m.tipo !== 'saldo_inicial')) {
                return conflicto('saldo_inicial_con_movimientos', 'Ya hay movimientos de este producto en la bodega')
            }
            const costo = typeof cuerpo.costo_total === 'string' && cuerpo.costo_total ? new Decimal(cuerpo.costo_total) : (costoUnitario ?? new Decimal(0))
            const unidad = nuevaUnidad(producto, bodega, cuerpo.unidad, costo, 'nuevo')
            if (esRespuesta(unidad)) {
                return unidad
            }
            const movimiento = mover(producto, bodega, { tipo: 'saldo_inicial', fecha, cantidad: 1, costo_total: costo, unidad_id: unidad.id, motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null })
            registrarAccion(solicitud, 'inventario.cargar_saldo_inicial', { tipo: 'movimiento_inventario', id: movimiento.id }, cuerpo)
            return { status: 201, cuerpo: movimiento }
        }
        if (previos.some(m => m.tipo === 'saldo_inicial')) {
            return conflicto('saldo_inicial_registrado', 'El saldo inicial de este producto en la bodega ya se cargó')
        }
        if (previos.length) {
            return conflicto('saldo_inicial_con_movimientos', 'Ya hay movimientos de este producto en la bodega')
        }
        const cantidad = cantidadDe(cuerpo.cantidad)
        if (esRespuesta(cantidad)) {
            return cantidad
        }
        const costo = typeof cuerpo.costo_total === 'string' && cuerpo.costo_total ? new Decimal(cuerpo.costo_total) : (costoUnitario ? costoUnitario.times(cantidad).toDecimalPlaces(2) : null)
        if (!costo) {
            return regla('costo_requerido', 'Escribe el costo unitario o el total', 'costo_unitario')
        }
        const movimiento = mover(producto, bodega, { tipo: 'saldo_inicial', fecha, cantidad, costo_total: costo, motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null })
        registrarAccion(solicitud, 'inventario.cargar_saldo_inicial', { tipo: 'movimiento_inventario', id: movimiento.id }, cuerpo)
        return { status: 201, cuerpo: movimiento }
    })),

    /** Como `Consumir`: solo por cantidad (422 `requiere_unidades` con serie), al promedio. */
    'POST /api/v1/inventario/consumos': conPermiso('inventario.consumir', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const par = productoYBodega(cuerpo)
        if (esRespuesta(par)) {
            return par
        }
        if (par.producto.seguimiento === 'serie') {
            return datosInvalidos([{ field: 'cantidad', message: `El producto ${par.producto.sku} se lleva por serie: indica sus unidades`, rule: 'requiere_unidades' }])
        }
        const cantidad = cantidadDe(cuerpo.cantidad)
        const fecha = fechaDe(cuerpo.fecha)
        if (esRespuesta(cantidad)) {
            return cantidad
        }
        if (typeof fecha !== 'string') {
            return fecha
        }
        const movimiento = salida(par.producto, par.bodega, cantidad, { tipo: 'consumo', fecha, servicio_id: typeof cuerpo.servicio_id === 'number' ? cuerpo.servicio_id : null, motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null })
        if (esRespuesta(movimiento)) {
            return movimiento
        }
        registrarAccion(solicitud, 'inventario.consumir', { tipo: 'movimiento_inventario', id: movimiento.id }, cuerpo)
        return { status: 201, cuerpo: movimiento }
    })),

    /** Como `Trasladar`: mismo costo, sin asiento; por serie, `unidad_ids`. */
    'POST /api/v1/inventario/traslados': conPermiso('inventario.trasladar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const origen = productoYBodega(cuerpo, 'bodega_origen_id')
        const destino = productoYBodega(cuerpo, 'bodega_destino_id')
        if (esRespuesta(origen)) {
            return origen
        }
        if (esRespuesta(destino)) {
            return destino
        }
        if (origen.bodega.id === destino.bodega.id) {
            return datosInvalidos([{ field: 'bodega_destino_id', message: 'El destino debe ser otra bodega', rule: 'different' }])
        }
        const trasladoId = Math.max(0, ...bd.movimientosInventario.map(m => m.traslado_id ?? 0)) + 1
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null
        const movimientos: Movimiento[] = []
        if (origen.producto.seguimiento === 'serie') {
            const ids = Array.isArray(cuerpo.unidad_ids) ? cuerpo.unidad_ids : []
            if (!ids.length) {
                return regla('requiere_unidades', 'Elige los equipos que se trasladan', 'unidad_ids')
            }
            const unidades: Unidad[] = []
            for (const id of ids) {
                const unidad = unidadEnBodega(id, origen.producto, origen.bodega, true)
                if (esRespuesta(unidad)) {
                    return unidad
                }
                unidades.push(unidad)
            }
            for (const unidad of unidades) {
                movimientos.push(mover(origen.producto, origen.bodega, { tipo: 'traslado', cantidad: -1, costo_total: new Decimal(unidad.costo).negated(), unidad_id: unidad.id, traslado_id: trasladoId, motivo, asiento_id: null }))
                movimientos.push(mover(origen.producto, destino.bodega, { tipo: 'traslado', cantidad: 1, costo_total: unidad.costo, unidad_id: unidad.id, traslado_id: trasladoId, motivo, asiento_id: null }))
                actualizarUnidad(unidad, { bodega_id: destino.bodega.id, bodega_nombre: destino.bodega.nombre })
            }
        }
        else {
            const cantidad = cantidadDe(cuerpo.cantidad)
            if (esRespuesta(cantidad)) {
                return cantidad
            }
            const sale = salida(origen.producto, origen.bodega, cantidad, { tipo: 'traslado', traslado_id: trasladoId, motivo, asiento_id: null })
            if (esRespuesta(sale)) {
                return sale
            }
            movimientos.push(sale, mover(origen.producto, destino.bodega, { tipo: 'traslado', cantidad, costo_total: new Decimal(sale.costo_total).negated(), traslado_id: trasladoId, motivo, asiento_id: null }))
        }
        registrarAccion(solicitud, 'inventario.trasladar', { tipo: 'traslado_inventario', id: trasladoId }, cuerpo)
        const [primeraSalida, primeraEntrada] = movimientos
        return primeraSalida && primeraEntrada ? { status: 201, cuerpo: { traslado_id: trasladoId, salida: primeraSalida, entrada: primeraEntrada, movimientos } } : conflicto('sin_movimientos', 'No se trasladó nada')
    })),

    /** Como `Ajustar`: + entra (al promedio o al costo dado), − sale al promedio; con motivo. */
    'POST /api/v1/inventario/ajustes': conPermiso('inventario.ajustar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const par = productoYBodega(cuerpo)
        if (esRespuesta(par)) {
            return par
        }
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        const fecha = fechaDe(cuerpo.fecha)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const { producto, bodega } = par
        const costoDado = typeof cuerpo.costo_unitario === 'string' && cuerpo.costo_unitario ? new Decimal(cuerpo.costo_unitario) : null
        let movimiento: Movimiento | RespuestaFixture
        if (producto.seguimiento === 'serie') {
            if (typeof cuerpo.unidad_id === 'number') {
                const unidad = unidadEnBodega(cuerpo.unidad_id, producto, bodega, true)
                if (esRespuesta(unidad)) {
                    return unidad
                }
                movimiento = mover(producto, bodega, { tipo: 'ajuste', fecha, cantidad: -1, costo_total: new Decimal(unidad.costo).negated(), unidad_id: unidad.id, motivo })
                actualizarUnidad(unidad, { estado: 'dada_de_baja', bodega_id: null, bodega_nombre: null })
            }
            else {
                const costo = costoDado ?? new Decimal(bd.unidadesInventario.filter(u => u.producto_id === producto.id).at(-1)?.costo ?? '0')
                const unidad = nuevaUnidad(producto, bodega, cuerpo.unidad, costo, 'usado')
                if (esRespuesta(unidad)) {
                    return unidad
                }
                movimiento = mover(producto, bodega, { tipo: 'ajuste', fecha, cantidad: 1, costo_total: costo, unidad_id: unidad.id, motivo })
            }
        }
        else {
            const cantidad = cantidadDe(cuerpo.cantidad, 'cantidad', true)
            if (esRespuesta(cantidad)) {
                return cantidad
            }
            if (cantidad.isNegative()) {
                movimiento = salida(producto, bodega, cantidad.abs(), { tipo: 'ajuste', fecha, motivo })
            }
            else {
                const saldo = saldoDe(bd.movimientosInventario, producto.id, bodega.id)
                const promedio = saldo.cantidad.isZero() ? null : saldo.valor.dividedBy(saldo.cantidad)
                const costo = promedio ?? costoDado
                if (!costo) {
                    return regla('costo_requerido', 'Sin existencia, escribe el costo unitario del sobrante', 'costo_unitario')
                }
                movimiento = mover(producto, bodega, { tipo: 'ajuste', fecha, cantidad, costo_total: cantidad.times(costo).toDecimalPlaces(2), motivo })
            }
        }
        if (esRespuesta(movimiento)) {
            return movimiento
        }
        registrarAccion(solicitud, 'inventario.ajustar', { tipo: 'movimiento_inventario', id: movimiento.id }, cuerpo)
        return { status: 201, cuerpo: movimiento }
    })),

    /** Como `DarDeBaja`: sale a mermas (`5.6.02`) con causa y motivo. */
    'POST /api/v1/inventario/bajas': conPermiso('inventario.dar_de_baja', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const par = productoYBodega(cuerpo)
        if (esRespuesta(par)) {
            return par
        }
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        const causa = cuerpo.causa === 'danado' || cuerpo.causa === 'robado' || cuerpo.causa === 'obsoleto' || cuerpo.causa === 'otro' ? cuerpo.causa : null
        if (motivo.length < 3 || !causa) {
            return datosInvalidos([...(!causa ? [{ field: 'causa', message: 'Elige la causa', rule: 'enum' }] : []), ...(motivo.length < 3 ? [{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }] : [])])
        }
        const { producto, bodega } = par
        let movimiento: Movimiento | RespuestaFixture
        if (producto.seguimiento === 'serie') {
            const unidad = unidadEnBodega(cuerpo.unidad_id, producto, bodega, true)
            if (esRespuesta(unidad)) {
                return unidad
            }
            movimiento = mover(producto, bodega, { tipo: 'baja', cantidad: -1, costo_total: new Decimal(unidad.costo).negated(), unidad_id: unidad.id, causa, motivo })
            actualizarUnidad(unidad, { estado: 'dada_de_baja', bodega_id: null, bodega_nombre: null })
        }
        else {
            const cantidad = cantidadDe(cuerpo.cantidad)
            if (esRespuesta(cantidad)) {
                return cantidad
            }
            movimiento = salida(producto, bodega, cantidad, { tipo: 'baja', causa, motivo })
        }
        if (esRespuesta(movimiento)) {
            return movimiento
        }
        registrarAccion(solicitud, 'inventario.dar_de_baja', { tipo: 'movimiento_inventario', id: movimiento.id }, cuerpo)
        return { status: 201, cuerpo: movimiento }
    })),

    /* Unidades */
    'GET /api/v1/inventario/unidades': conPermiso('inventario.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const productoId = numeroQuery(solicitud, 'producto_id')
        const bodegaId = numeroQuery(solicitud, 'bodega_id')
        const servicioId = numeroQuery(solicitud, 'servicio_id')
        const q = (solicitud.query.get('q') ?? '').trim().toUpperCase()
        const qMac = q.replace(/[^0-9A-F]/g, '')
        const filas = deLaEmpresa(bd.unidadesInventario, solicitud)
            .filter(u => !estado || u.estado === estado)
            .filter(u => productoId === undefined || u.producto_id === productoId)
            .filter(u => bodegaId === undefined || u.bodega_id === bodegaId)
            .filter(u => servicioId === undefined || u.servicio_id === servicioId)
            .filter(u => !q || (u.serie ?? '').includes(q) || (qMac.length >= 2 && (u.mac ?? '').replaceAll(':', '').includes(qMac)))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/inventario/unidades/:id': conPermiso('inventario.ver', (solicitud) => {
        const unidad = bd.unidadesInventario.find(u => u.id === idDe(solicitud))
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        const historial = bd.movimientosInventario.filter(m => m.unidad_id === unidad.id).map(m => ({
            id: m.id, tipo: m.tipo, fecha: m.fecha, bodega_id: m.bodega_id, bodega_nombre: m.bodega_nombre, cantidad: m.cantidad, costo_total: m.costo_total,
            servicio_id: m.servicio_id, asiento_id: m.asiento_id, origen_tipo: m.origen_tipo, origen_id: m.origen_id, motivo: m.motivo, created_at: m.created_at,
        }))
        return { status: 200, cuerpo: { ...unidad, historial } }
    }),

    /** Como `MarcarReparada`: de `en_reparacion` a `disponible`, sin movimiento. */
    'POST /api/v1/inventario/unidades/:id/marcar-reparada': conPermiso('inventario.marcar_reparada', (solicitud) => {
        const unidad = bd.unidadesInventario.find(u => u.id === idDe(solicitud))
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        if (unidad.estado !== 'en_reparacion') {
            return conflicto('unidad_no_en_reparacion', 'El equipo no está en reparación')
        }
        actualizarUnidad(unidad, { estado: 'disponible' })
        registrarAccion(solicitud, 'inventario.marcar_reparada', { tipo: 'unidad_inventario', id: unidad.id }, { motivo })
        return { status: 200, cuerpo: unidad }
    }),

    /* Comodato */
    'GET /api/v1/servicios/:id/equipos': conPermiso('inventario.ver', (solicitud) => {
        const servicioId = idDe(solicitud)
        const filas = bd.unidadesInventario.filter(u => u.servicio_id === servicioId && (u.estado === 'en_comodato' || u.estado === 'por_recuperar')).map(equipoDe)
        return { status: 200, cuerpo: filas }
    }),

    /** Como `AsignarComodato`: unidad disponible → servicio vigente de la misma empresa. */
    'POST /api/v1/servicios/:id/equipos': conPermiso('inventario.asignar_comodato', conIdempotencia((solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        if (!servicio) {
            return noEncontrado('el servicio')
        }
        if (servicio.estado === 'retirado') {
            return conflicto('servicio_retirado', 'Un servicio retirado no recibe equipos en comodato')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const unidad = bd.unidadesInventario.find(u => u.id === cuerpo.unidad_id)
        if (!unidad || unidad.empresa_id !== servicio.empresa_id) {
            return noEncontrado('el equipo')
        }
        if (unidad.estado !== 'disponible' || unidad.bodega_id === null) {
            return conflicto('unidad_no_disponible', 'El equipo no está disponible en una bodega')
        }
        const fecha = fechaDe(cuerpo.fecha)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const producto = productoDe(unidad.producto_id)
        const bodega = bodegaDe(unidad.bodega_id)
        if (!producto || !bodega) {
            return noEncontrado('el equipo')
        }
        mover(producto, bodega, { tipo: 'asignacion_comodato', fecha, cantidad: -1, costo_total: new Decimal(unidad.costo).negated(), unidad_id: unidad.id, servicio_id: servicio.id })
        actualizarUnidad(unidad, { estado: 'en_comodato', bodega_id: null, bodega_nombre: null, servicio_id: servicio.id, cliente_id: servicio.cliente_id, activo_id: 900 + unidad.id })
        registrarAccion(solicitud, 'inventario.asignar_comodato', { tipo: 'unidad', id: unidad.id }, cuerpo)
        return { status: 201, cuerpo: unidad }
    })),

    /** Como `DevolverComodato`: a una bodega, nueva o usada, o a reparación; reingresa a su valor en libros. */
    'POST /api/v1/servicios/:id/equipos/:unidadId/devolver': conPermiso('inventario.devolver_comodato', conIdempotencia((solicitud) => {
        const servicioId = idDe(solicitud)
        const unidad = bd.unidadesInventario.find(u => u.id === idDe(solicitud, 'unidadId') && u.servicio_id === servicioId)
        if (!unidad || (unidad.estado !== 'en_comodato' && unidad.estado !== 'por_recuperar')) {
            return noEncontrado('el equipo en comodato')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const bodega = bodegaDe(cuerpo.bodega_id)
        const producto = productoDe(unidad.producto_id)
        if (!bodega || !producto || bodega.empresa_id !== unidad.empresa_id) {
            return noEncontrado('la bodega')
        }
        const fecha = fechaDe(cuerpo.fecha)
        if (typeof fecha !== 'string') {
            return fecha
        }
        mover(producto, bodega, { tipo: 'devolucion_comodato', fecha, cantidad: 1, costo_total: unidad.costo, unidad_id: unidad.id, servicio_id: servicioId, motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null })
        actualizarUnidad(unidad, {
            estado: cuerpo.en_reparacion === true ? 'en_reparacion' : 'disponible',
            condicion: cuerpo.condicion === 'nuevo' ? 'nuevo' : 'usado',
            bodega_id: bodega.id,
            bodega_nombre: bodega.nombre,
            servicio_id: null,
            cliente_id: null,
            activo_id: null,
        })
        registrarAccion(solicitud, 'inventario.devolver_comodato', { tipo: 'unidad', id: unidad.id }, cuerpo)
        return { status: 200, cuerpo: unidad }
    })),

    /** Como `DeclararPerdidaComodato`: baja del activo a pérdida, sin kardex; la unidad queda dada de baja. */
    'POST /api/v1/servicios/:id/equipos/:unidadId/perdida': conPermiso('inventario.declarar_perdida_comodato', conIdempotencia((solicitud) => {
        const servicioId = idDe(solicitud)
        const unidad = bd.unidadesInventario.find(u => u.id === idDe(solicitud, 'unidadId') && u.servicio_id === servicioId)
        if (!unidad || (unidad.estado !== 'en_comodato' && unidad.estado !== 'por_recuperar')) {
            return noEncontrado('el equipo en comodato')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        actualizarUnidad(unidad, { estado: 'dada_de_baja', activo_id: null })
        registrarAccion(solicitud, 'inventario.declarar_perdida_comodato', { tipo: 'unidad', id: unidad.id }, { motivo })
        return { status: 200, cuerpo: unidad }
    })),

    /* Conteos */
    'GET /api/v1/inventario/conteos': conPermiso('inventario.ver', (solicitud) => {
        const bodegaId = numeroQuery(solicitud, 'bodega_id')
        const estado = solicitud.query.get('estado')
        const filas = deLaEmpresa(bd.conteosInventario, solicitud)
            .filter(c => bodegaId === undefined || c.bodega_id === bodegaId)
            .filter(c => !estado || c.estado === estado)
            .sort((a, b) => b.id - a.id)
            .map(({ lineas: _lineas, ...conteo }) => conteo)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/inventario/conteos/:id': conPermiso('inventario.ver', (solicitud) => {
        const conteo = bd.conteosInventario.find(c => c.id === idDe(solicitud))
        return conteo ? { status: 200, cuerpo: conteo } : noEncontrado('el conteo')
    }),

    /** Como `AbrirConteo`: uno abierto por bodega (409 `conteo_abierto`). */
    'POST /api/v1/inventario/conteos': conPermiso('inventario.abrir_conteo', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const bodega = bodegaDe(cuerpo.bodega_id)
        if (!bodega) {
            return noEncontrado('la bodega')
        }
        if (bd.conteosInventario.some(c => c.bodega_id === bodega.id && c.estado === 'abierto')) {
            return conflicto('conteo_abierto', `${bodega.nombre} ya tiene un conteo abierto`)
        }
        const conteo: Schema<'ConteoInventarioDetalle'> = {
            id: Math.max(0, ...bd.conteosInventario.map(c => c.id)) + 1,
            empresa_id: bodega.empresa_id,
            bodega_id: bodega.id,
            bodega_nombre: bodega.nombre,
            estado: 'abierto',
            fecha_corte: hoy(),
            motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null,
            abierto_por: 1,
            cerrado_por: null,
            cerrado_en: null,
            faltante: '0.00',
            sobrante: '0.00',
            version: 1,
            created_at: ahora(),
            lineas: [],
        }
        bd.conteosInventario.push(conteo)
        registrarAccion(solicitud, 'inventario.abrir_conteo', { tipo: 'conteo_inventario', id: conteo.id }, cuerpo)
        return { status: 201, cuerpo: conteo }
    })),

    /** Como `Contar`: lo esperado se toma al capturar; capturar otra vez reemplaza la línea. */
    'POST /api/v1/inventario/conteos/:id/lineas': conPermiso('inventario.contar', (solicitud) => {
        const conteo = bd.conteosInventario.find(c => c.id === idDe(solicitud))
        if (!conteo) {
            return noEncontrado('el conteo')
        }
        if (conteo.estado !== 'abierto') {
            return conflicto('conteo_cerrado', 'El conteo ya no está abierto')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const producto = productoDe(cuerpo.producto_id)
        if (!producto || producto.empresa_id !== conteo.empresa_id) {
            return noEncontrado('el producto')
        }
        const linea = lineaConteo(conteo, producto, cuerpo)
        if (esRespuesta(linea)) {
            return linea
        }
        conteo.lineas = [...conteo.lineas.filter(l => l.producto_id !== producto.id), linea]
        conteo.version += 1
        registrarAccion(solicitud, 'inventario.contar', { tipo: 'conteo_inventario', id: conteo.id }, cuerpo)
        return { status: 200, cuerpo: conteo }
    }),

    /** Como `CerrarConteo`: ajusta faltantes y sobrantes (`ajuste_conteo`) de lo contado. */
    'POST /api/v1/inventario/conteos/:id/cerrar': conPermiso('inventario.cerrar_conteo', conIdempotencia((solicitud) => {
        const conteo = bd.conteosInventario.find(c => c.id === idDe(solicitud))
        if (!conteo) {
            return noEncontrado('el conteo')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.version === 'number' && cuerpo.version !== conteo.version) {
            return versionCambiada()
        }
        if (conteo.estado !== 'abierto') {
            return conflicto('conteo_cerrado', 'El conteo ya se cerró o se canceló')
        }
        const bodega = bodegaDe(conteo.bodega_id)
        let faltante = new Decimal(0)
        let sobrante = new Decimal(0)
        for (const linea of conteo.lineas) {
            const producto = productoDe(linea.producto_id)
            const diferencia = new Decimal(linea.diferencia)
            if (!producto || !bodega || diferencia.isZero() || producto.seguimiento === 'serie') {
                continue
            }
            if (diferencia.isNegative()) {
                const sale = salida(producto, bodega, diferencia.abs(), { tipo: 'ajuste_conteo', origen_tipo: 'conteo', origen_id: conteo.id })
                if (!esRespuesta(sale)) {
                    faltante = faltante.plus(new Decimal(sale.costo_total).abs())
                }
            }
            else {
                const valor = new Decimal(linea.valor_diferencia ?? '0')
                mover(producto, bodega, { tipo: 'ajuste_conteo', cantidad: diferencia, costo_total: valor, origen_tipo: 'conteo', origen_id: conteo.id })
                sobrante = sobrante.plus(valor)
            }
        }
        Object.assign(conteo, { estado: 'cerrado', cerrado_por: 1, cerrado_en: ahora(), faltante: monto2(faltante), sobrante: monto2(sobrante), version: conteo.version + 1 })
        registrarAccion(solicitud, 'inventario.cerrar_conteo', { tipo: 'conteo_inventario', id: conteo.id }, cuerpo)
        return { status: 200, cuerpo: conteo }
    })),

    'POST /api/v1/inventario/conteos/:id/cancelar': conPermiso('inventario.cancelar_conteo', conIdempotencia((solicitud) => {
        const conteo = bd.conteosInventario.find(c => c.id === idDe(solicitud))
        if (!conteo) {
            return noEncontrado('el conteo')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        if (conteo.estado !== 'abierto') {
            return conflicto('conteo_cerrado', 'El conteo ya se cerró o se canceló')
        }
        Object.assign(conteo, { estado: 'cancelado', motivo, version: conteo.version + 1 })
        registrarAccion(solicitud, 'inventario.cancelar_conteo', { tipo: 'conteo_inventario', id: conteo.id }, { motivo })
        return { status: 200, cuerpo: conteo }
    })),

    /* Reportes */
    /** Existencias y valor a una fecha, reconstruidos del kardex, con el cuadre contra `1.1.14`. */
    'GET /api/v1/reportes/inventario-valorizado': conPermiso('inventario.ver', (solicitud) => {
        const fecha = solicitud.query.get('fecha') || hoy()
        const bodegaId = numeroQuery(solicitud, 'bodega_id')
        const productoId = numeroQuery(solicitud, 'producto_id')
        const conCeros = solicitud.query.get('con_ceros') === 'true'
        const hasta = deLaEmpresa(bd.movimientosInventario, solicitud).filter(m => m.fecha <= fecha)
        const grupos = new Map<string, { producto: Producto, bodega: Bodega, cantidad: Decimal, valor: Decimal }>()
        for (const m of hasta) {
            const producto = productoDe(m.producto_id)
            const bodega = bodegaDe(m.bodega_id)
            if (!producto || !bodega) {
                continue
            }
            const clave = `${producto.id}/${bodega.id}`
            const actual = grupos.get(clave) ?? { producto, bodega, cantidad: new Decimal(0), valor: new Decimal(0) }
            grupos.set(clave, { ...actual, cantidad: actual.cantidad.plus(m.cantidad), valor: actual.valor.plus(m.costo_total) })
        }
        const data = [...grupos.values()]
            .filter(g => conCeros || !g.cantidad.isZero())
            .filter(g => bodegaId === undefined || g.bodega.id === bodegaId)
            .filter(g => productoId === undefined || g.producto.id === productoId)
            .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre) || a.bodega.nombre.localeCompare(b.bodega.nombre))
            .map(g => ({
                empresa_id: g.producto.empresa_id,
                producto_id: g.producto.id,
                producto_sku: g.producto.sku,
                producto_nombre: g.producto.nombre,
                unidad: g.producto.unidad,
                seguimiento: g.producto.seguimiento,
                bodega_id: g.bodega.id,
                bodega_nombre: g.bodega.nombre,
                cantidad: cantidad3(g.cantidad),
                valor: monto2(g.valor),
                costo_promedio: g.cantidad.isZero() ? null : g.valor.dividedBy(g.cantidad).toFixed(6),
            }))
        const empresas = [...new Set(hasta.map(m => m.empresa_id))].sort()
        const cuadre = empresas.map((empresaId) => {
            const valor = hasta.filter(m => m.empresa_id === empresaId).reduce((t, m) => t.plus(m.costo_total), new Decimal(0))
            return { empresa_id: empresaId, valor_kardex: monto2(valor), saldo_libro: monto2(valor), diferencia: '0.00' }
        })
        const total = data.reduce((t, f) => t.plus(f.valor), new Decimal(0))
        return { status: 200, cuerpo: { fecha, data, total: monto2(total), cuadre } }
    }),

    'GET /api/v1/reportes/equipos-por-recuperar': conPermiso('inventario.ver', (solicitud) => {
        const clienteId = numeroQuery(solicitud, 'cliente_id')
        const productoId = numeroQuery(solicitud, 'producto_id')
        const filas = deLaEmpresa(bd.unidadesInventario, solicitud)
            .filter(u => u.estado === 'por_recuperar')
            .filter(u => clienteId === undefined || u.cliente_id === clienteId)
            .filter(u => productoId === undefined || u.producto_id === productoId)
            .map(equipoDe)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}

/**
 * Lo que una compra mueve en el inventario (A3, §5 y desvío B.6): una línea `bien` con
 * `producto_id` entra al kardex a su costo (base, o total sin crédito fiscal) y, por serie, crea
 * sus unidades; en una NCRE, sale lo devuelto al proveedor (`devolucion_proveedor`). Valida todo
 * antes de mover nada; `null` si salió bien.
 */
export function inventarioDeCompra(compra: Schema<'Compra'>, entrada: unknown, creditoFiscal: boolean): RespuestaFixture | null {
    const brutas = Array.isArray(entrada) ? entrada : []
    const pedidos: { indice: number, producto: Producto, bodega: Bodega, cantidad: number, costo: Decimal, unidades: unknown[], unidadIds: number[] }[] = []
    for (const [indice, bruta] of brutas.entries()) {
        const l = (typeof bruta === 'object' && bruta !== null ? bruta : {}) as Record<string, unknown>
        if (l.producto_id === undefined || l.producto_id === null) {
            continue
        }
        const campo = (nombre: string) => `lineas.${indice}.${nombre}`
        const producto = productoDe(l.producto_id)
        const bodega = bodegaDe(l.bodega_id)
        const linea = compra.lineas[indice]
        if (!producto || producto.empresa_id !== compra.empresa_id) {
            return datosInvalidos([{ field: campo('producto_id'), message: 'El producto no existe en la empresa', rule: 'exists' }])
        }
        if (!bodega || bodega.empresa_id !== compra.empresa_id || (l.tipo ?? 'servicio') !== 'bien' || !linea) {
            return regla('linea_inventario', 'Una línea de inventario es un bien con su bodega', campo('bodega_id'))
        }
        const cantidad = typeof l.cantidad === 'number' && l.cantidad > 0 ? l.cantidad : 1
        const costo = creditoFiscal ? new Decimal(linea.base) : new Decimal(linea.base).plus(linea.iva)
        const unidades = Array.isArray(l.unidades) ? l.unidades : []
        const unidadIds = Array.isArray(l.unidad_ids) ? l.unidad_ids.filter((n): n is number => typeof n === 'number') : []
        // Como `compras.ts` de A3: menos unidades que la cantidad (o ninguna) es 422 de validación
        // `requiere_unidades` en `unidades` (NCRE: `unidad_ids`); más, `cantidad`
        if (producto.seguimiento === 'serie') {
            const devolucion = compra.tipo_documento === 'NCRE'
            const recibidas = devolucion ? unidadIds.length : unidades.length
            if (recibidas < cantidad) {
                return datosInvalidos([{
                    field: campo(devolucion ? 'unidad_ids' : 'unidades'),
                    message: devolucion ? `Indica los ${cantidad} equipos que se devuelven (vienen ${recibidas})` : `Escribe ${cantidad} series o MAC, una por equipo (vienen ${recibidas})`,
                    rule: 'requiere_unidades',
                }])
            }
            if (recibidas !== cantidad) {
                return datosInvalidos([{ field: campo('cantidad'), message: `La cantidad (${cantidad}) es el número de unidades (${recibidas})`, rule: 'cantidad' }])
            }
        }
        if (producto.seguimiento === 'serie' && compra.tipo_documento === 'NCRE') {
            const devueltas = bd.unidadesInventario.filter(u => unidadIds.includes(u.id))
            if (!devueltas.length || devueltas.some(u => u.compra_id !== compra.compra_referencia_id || u.estado !== 'disponible' || u.bodega_id !== bodega.id)) {
                return conflicto('unidades_en_uso', 'Los equipos devueltos deben ser de esa compra y estar disponibles en la bodega')
            }
        }
        pedidos.push({ indice, producto, bodega, cantidad, costo, unidades, unidadIds })
    }
    for (const p of pedidos) {
        const linea = compra.lineas[p.indice]
        if (linea) {
            Object.assign(linea, { producto_id: p.producto.id, bodega_id: p.bodega.id, cantidad: p.cantidad })
        }
        const origen = { origen_tipo: 'compra', origen_id: compra.id, asiento_id: compra.asiento_id }
        if (compra.tipo_documento === 'NCRE') {
            if (p.producto.seguimiento === 'serie') {
                for (const unidad of bd.unidadesInventario.filter(u => p.unidadIds.includes(u.id))) {
                    mover(p.producto, p.bodega, { tipo: 'devolucion_proveedor', fecha: compra.fecha, cantidad: -1, costo_total: new Decimal(unidad.costo).negated(), unidad_id: unidad.id, ...origen })
                    actualizarUnidad(unidad, { estado: 'devuelta_proveedor', bodega_id: null, bodega_nombre: null })
                }
            }
            else {
                mover(p.producto, p.bodega, { tipo: 'devolucion_proveedor', fecha: compra.fecha, cantidad: -p.cantidad, costo_total: p.costo.negated(), ...origen })
            }
            continue
        }
        if (p.producto.seguimiento === 'serie') {
            // el costo se reparte entre las unidades; el residuo de centavos va en la última
            const parte = p.costo.dividedBy(p.unidades.length).toDecimalPlaces(2, Decimal.ROUND_DOWN)
            p.unidades.forEach((datos, i) => {
                const costo = i === p.unidades.length - 1 ? p.costo.minus(parte.times(p.unidades.length - 1)) : parte
                const unidad = nuevaUnidad(p.producto, p.bodega, datos, costo, 'nuevo')
                if (!esRespuesta(unidad)) {
                    unidad.compra_id = compra.id
                    mover(p.producto, p.bodega, { tipo: 'entrada_compra', fecha: compra.fecha, cantidad: 1, costo_total: costo, unidad_id: unidad.id, ...origen })
                }
            })
        }
        else {
            mover(p.producto, p.bodega, { tipo: 'entrada_compra', fecha: compra.fecha, cantidad: p.cantidad, costo_total: p.costo, ...origen })
        }
    }
    return null
}

/**
 * Venta de inventario por cargo único (A3, desvío C.1): cada línea con `producto_id` sale de su
 * bodega al costo promedio (o al costo de la unidad, que queda `vendida`), con el movimiento
 * `venta` en la misma transacción de la factura. Valida todo antes de mover nada.
 */
export function ventaDeCargo(factura: { id: number, empresa_id: number }, entrada: unknown, sinCosto: boolean): RespuestaFixture | null {
    const brutas = (Array.isArray(entrada) ? entrada : []).map(b => (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>)
    const conProducto = brutas.map((l, indice) => ({ l, indice })).filter(({ l }) => l.producto_id !== undefined && l.producto_id !== null)
    if (!conProducto.length) {
        return null
    }
    if (sinCosto) {
        return regla('producto_sin_costo', 'Un bien no se regala con un cargo sin costo: va como premio o baja')
    }
    const ventas: { producto: Producto, bodega: Bodega, cantidad: Decimal, unidad: Unidad | null }[] = []
    for (const { l, indice } of conProducto) {
        const campo = (nombre: string) => `lineas.${indice}.${nombre}`
        const producto = productoDe(l.producto_id)
        const bodega = bodegaDe(l.bodega_id)
        if (!producto || producto.empresa_id !== factura.empresa_id) {
            return datosInvalidos([{ field: campo('producto_id'), message: 'El producto no existe en la empresa', rule: 'exists' }])
        }
        if (!bodega || bodega.empresa_id !== factura.empresa_id) {
            return datosInvalidos([{ field: campo('bodega_id'), message: 'Elija la bodega de donde sale', rule: 'exists' }])
        }
        if (producto.seguimiento === 'serie') {
            const unidad = unidadEnBodega(l.unidad_id, producto, bodega)
            if (esRespuesta(unidad)) {
                return unidad
            }
            ventas.push({ producto, bodega, cantidad: new Decimal(1), unidad })
        }
        else {
            const cantidad = new Decimal(typeof l.cantidad === 'string' ? l.cantidad : '1')
            if (costoSalida(bd.movimientosInventario, producto.id, bodega.id, cantidad) === null) {
                return conflicto('existencia_insuficiente', `No alcanza la existencia de ${producto.nombre} en ${bodega.nombre}`)
            }
            ventas.push({ producto, bodega, cantidad, unidad: null })
        }
    }
    for (const v of ventas) {
        const origen = { origen_tipo: 'factura', origen_id: factura.id }
        if (v.unidad) {
            mover(v.producto, v.bodega, { tipo: 'venta', cantidad: -1, costo_total: new Decimal(v.unidad.costo).negated(), unidad_id: v.unidad.id, ...origen })
            actualizarUnidad(v.unidad, { estado: 'vendida', bodega_id: null, bodega_nombre: null })
        }
        else {
            salida(v.producto, v.bodega, v.cantidad, { tipo: 'venta', ...origen })
        }
    }
    return null
}
