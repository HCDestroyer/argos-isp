/**
 * Cargo único y bonificaciones (A3, rama `a3/decisiones-pm`): catálogos de conceptos y motivos
 * (lectura), `POST /facturas/cargo-unico` (factura o, con total Q0, bonificación: nunca una factura
 * de Q0), `GET /bonificaciones[/:id]` y `GET /reportes/bonificaciones`. Mismos permisos y errores que
 * la API: 403 sin `facturas.cargo_sin_costo`, 422 `concepto_inactivo`, `concepto_de_otra_empresa`,
 * descuentos sobre el bruto, motivo con total > 0.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, empresasDeLista, idDe, noEncontrado, numeroQuery, paginar, problema, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { ventaDeCargo } from '../inventario/rutas'
import { asientoFactura, fechaGuatemala } from '../libro/datos'
import { COLUMNAS_EMPRESA, csv, totales } from '../reportes/rutas'
import { asientoBonificacion, baseSinIva } from './datos'
import { extrasDetalle } from '../facturacion/detalle'

type Bonificacion = Schema<'Bonificacion'>
type Factura = Schema<'Factura'>
type Linea = Schema<'FacturaLinea'>
type Errores = NonNullable<Problem['errors']>
type Columna = Schema<'ColumnaReporte'>
type Valor = string | number | null

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const CANTIDAD = /^\d{1,6}(\.\d{1,4})?$/
const ORIGENES: readonly Bonificacion['origen'][] = ['mes_gratis', 'descuento_100', 'cargo_sin_costo', 'canje']

function regla(codigo: string, detalle: string, errores?: Errores): RespuestaFixture {
    return problemaTipado(422, codigo, 'Regla de negocio', detalle, errores)
}

function hoy(): string {
    return fechaGuatemala(ahora())
}

function soloActivos<T extends { activo: boolean }>(filas: T[], solicitud: SolicitudFixture): T[] {
    const activo = solicitud.query.get('activo')
    return activo === null ? filas : filas.filter(f => String(f.activo) === activo)
}

interface LineaLeida {
    concepto: Schema<'ConceptoCargo'>
    descripcion: string | null
    cantidad: Decimal
    precio: Decimal
    bruto: Decimal
    descuentos: { concepto: string, monto: Decimal }[]
}

/** Como `EmitirCargoUnico` (A3): valida y responde factura o, con total Q0, bonificación. */
function emitirCargoUnico(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    const servicioId = typeof cuerpo.servicio_id === 'number' ? cuerpo.servicio_id : null
    const servicio = servicioId === null ? null : bd.servicios.find(s => s.id === servicioId)
    if (servicioId !== null && !servicio) {
        return noEncontrado('el servicio')
    }
    const clienteId = typeof cuerpo.cliente_id === 'number' ? cuerpo.cliente_id : null
    if (!servicio && clienteId === null) {
        errores.push({ field: 'cliente_id', message: 'Sin servicio, el cliente es obligatorio', rule: 'required' })
    }
    if (servicio && clienteId !== null && clienteId !== servicio.cliente_id) {
        errores.push({ field: 'cliente_id', message: 'El cliente no es el dueño del servicio', rule: 'cliente' })
    }
    const cliente = bd.clientes.find(c => c.id === (servicio?.cliente_id ?? clienteId))
    if (!cliente && clienteId !== null) {
        return noEncontrado('el cliente')
    }
    const empresaId = servicio?.empresa_id ?? (typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud))
    if (!servicio && empresaId === null) {
        errores.push({ field: 'empresa_id', message: 'Elija la empresa del cargo', rule: 'required' })
    }
    const venceEn = typeof cuerpo.vence_en === 'string' && cuerpo.vence_en ? cuerpo.vence_en : null
    if (venceEn !== null && (!FECHA.test(venceEn) || venceEn < hoy())) {
        errores.push({ field: 'vence_en', message: 'Hoy o después', rule: 'fecha' })
    }
    const entrada = Array.isArray(cuerpo.lineas) ? cuerpo.lineas : []
    if (entrada.length === 0 || entrada.length > 50) {
        errores.push({ field: 'lineas', message: 'De 1 a 50 líneas', rule: 'array' })
    }
    const lineas: LineaLeida[] = []
    entrada.forEach((valor: unknown, i) => {
        const l = typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {}
        const concepto = bd.conceptosCargo.find(c => c.id === l.concepto_id)
        const precio = typeof l.precio_unitario === 'string' ? l.precio_unitario : ''
        const cantidad = typeof l.cantidad === 'string' ? l.cantidad : '1'
        if (!concepto) {
            errores.push({ field: `lineas.${i}.concepto_id`, message: 'El concepto no existe', rule: 'exists' })
            return
        }
        if (!MONTO.test(precio) || !new Decimal(precio).gt(0)) {
            errores.push({ field: `lineas.${i}.precio_unitario`, message: 'Precio bruto con IVA mayor que 0', rule: 'monto' })
            return
        }
        if (!CANTIDAD.test(cantidad) || !new Decimal(cantidad).gt(0)) {
            errores.push({ field: `lineas.${i}.cantidad`, message: 'Cantidad mayor que 0', rule: 'cantidad' })
            return
        }
        const descuentos = (Array.isArray(l.descuentos) ? l.descuentos : []).map((d: unknown) => {
            const fila = typeof d === 'object' && d !== null ? d as Record<string, unknown> : {}
            return { concepto: typeof fila.concepto === 'string' ? fila.concepto.trim() : '', monto: typeof fila.monto === 'string' && MONTO.test(fila.monto) ? new Decimal(fila.monto) : new Decimal(-1) }
        })
        const bruto = new Decimal(cantidad).times(precio).toDecimalPlaces(2)
        descuentos.forEach((d, j) => {
            if (d.concepto.length < 2 || d.monto.lt(0)) {
                errores.push({ field: `lineas.${i}.descuentos.${j}.monto`, message: 'Concepto y monto del descuento', rule: 'descuento' })
            }
        })
        if (descuentos.reduce((s, d) => s.plus(Decimal.max(d.monto, 0)), new Decimal(0)).gt(bruto)) {
            errores.push({ field: `lineas.${i}.descuentos.0.monto`, message: 'Los descuentos pasan del bruto de la línea', rule: 'descuentos' })
        }
        lineas.push({ concepto, descripcion: typeof l.descripcion === 'string' && l.descripcion.trim() ? l.descripcion.trim() : null, cantidad: new Decimal(cantidad), precio: new Decimal(precio), bruto, descuentos })
    })
    if (errores.length) {
        return datosInvalidos(errores)
    }
    for (const l of lineas) {
        if (!l.concepto.activo) {
            return regla('concepto_inactivo', `El concepto ${l.concepto.nombre} está desactivado`)
        }
        if (l.concepto.empresa_id !== empresaId) {
            return regla('concepto_de_otra_empresa', `El concepto ${l.concepto.nombre} es de otra empresa`)
        }
    }
    const total = lineas.reduce((s, l) => s.plus(l.bruto).minus(l.descuentos.reduce((d, x) => d.plus(x.monto), new Decimal(0))), new Decimal(0))
    const motivoId = typeof cuerpo.motivo_sin_costo_id === 'number' ? cuerpo.motivo_sin_costo_id : null
    const motivoTexto = typeof cuerpo.motivo_sin_costo_texto === 'string' ? cuerpo.motivo_sin_costo_texto.trim() : ''
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const momento = ahora()
    const clienteFinal = servicio?.cliente_id ?? clienteId ?? 0
    const empresaFinal = empresaId ?? 1

    if (total.gt(0)) {
        if (motivoId !== null) {
            return regla('motivo_con_total', 'El motivo sin costo solo va con total Q 0.00', [{ field: 'motivo_sin_costo_id', message: 'Solo con total Q 0.00', rule: 'motivo' }])
        }
        const id = siguienteId(bd.facturas)
        const base = bd.facturas[0]
        if (!base) {
            return problema(500, 'Sin facturas de referencia en los fixtures')
        }
        let siguienteLinea = id * 10
        const filas: Linea[] = []
        let subtotal = new Decimal(0)
        for (const l of lineas) {
            const lineaId = ++siguienteLinea
            const baseBruto = baseSinIva(l.bruto, l.concepto.gravable)
            filas.push({ id: lineaId, concepto: l.descripcion ?? l.concepto.nombre, tipo: l.concepto.tipo, cantidad: l.cantidad.toFixed(3), precio_unitario: l.precio.toFixed(2), gravable: l.concepto.gravable, iva: l.bruto.minus(baseBruto).toFixed(2), total: l.bruto.toFixed(2), cuenta_codigo: l.concepto.cuenta_codigo })
            subtotal = subtotal.plus(baseBruto)
            for (const d of l.descuentos) {
                const baseD = baseSinIva(d.monto, l.concepto.gravable)
                filas.push({ id: ++siguienteLinea, concepto: d.concepto, tipo: 'descuento', cantidad: '1.000', precio_unitario: d.monto.negated().toFixed(2), gravable: l.concepto.gravable, iva: d.monto.minus(baseD).negated().toFixed(2), total: d.monto.negated().toFixed(2), linea_id: lineaId, cuenta_codigo: '5.1.01' })
                subtotal = subtotal.minus(baseD)
            }
        }
        const factura: Factura = {
            ...structuredClone(base),
            id,
            empresa_id: empresaFinal,
            cliente_id: clienteFinal,
            cliente_nombre: bd.clientes.find(c => c.id === clienteFinal)?.nombre ?? '',
            servicio_id: servicio?.id ?? null,
            periodo: hoy(),
            clave_unica: `cargo-${crypto.randomUUID()}`,
            emitida_en: momento,
            vence_en: venceEn ?? hoy(),
            estado: 'emitida',
            subtotal: subtotal.toFixed(2),
            iva: total.minus(subtotal).toFixed(2),
            total: total.toFixed(2),
            pagado: '0.00',
            acreditado: '0.00',
            fel_uuid: null,
            fel_serie: null,
            fel_numero: null,
            fel_estado: null,
            dte_id: null,
            fel_error: null,
            tipo: 'servicio',
            factura_origen_id: null,
            vencida_en: null,
            anulada_en: null,
            motivo_anulacion: null,
            origen: null,
            id_externo: null,
            sustituida_por: null,
            sustituye_a: null,
            cargo_unico: true,
            motivo_sin_costo_id: null,
            motivo_sin_costo_nombre: null,
            motivo_sin_costo_texto: null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        // Inventario (A3): lo vendido sale de su bodega con su costo, en la misma factura
        const venta = ventaDeCargo(factura, cuerpo.lineas, false)
        if (venta) {
            return venta
        }
        bd.facturas.push(factura)
        bd.lineasCargoUnico[id] = filas
        bd.asientos.push(asientoFactura(siguienteId(bd.asientos), factura))
        registrarAccion(solicitud, 'facturas.emitir_cargo_unico', { tipo: 'factura', id }, cuerpo)
        const respuesta: Schema<'CargoUnicoEmitido'> = { documento: 'factura', factura: { ...factura, notas_credito: [], ...extrasDetalle(factura.id), lineas: structuredClone(filas), reglas_snapshot: {} }, bonificacion: null }
        return { status: 201, cuerpo: respuesta }
    }

    // Total Q0: nunca una factura de Q0, sino una bonificación (decisión del PM).
    const regalo = ventaDeCargo({ id: 0, empresa_id: empresaFinal }, cuerpo.lineas, true)
    if (regalo) {
        return regalo
    }
    if (!usuario?.permisos.includes('facturas.cargo_sin_costo')) {
        return problema(403, 'Sin permiso', 'Falta el permiso facturas.cargo_sin_costo.')
    }
    const motivo = bd.motivosSinCosto.find(m => m.id === motivoId && m.empresa_id === empresaFinal && m.activo)
    const faltan: Errores = []
    if (!motivo) {
        faltan.push({ field: 'motivo_sin_costo_id', message: 'Con total Q 0.00 el motivo es obligatorio', rule: 'required' })
    }
    if (!motivoTexto) {
        faltan.push({ field: 'motivo_sin_costo_texto', message: 'Explique por qué no se cobra', rule: 'required' })
    }
    if (faltan.length || !motivo) {
        return datosInvalidos(faltan)
    }
    const id = siguienteId(bd.bonificaciones)
    const bruto = lineas.reduce((s, l) => s.plus(l.bruto), new Decimal(0))
    const baseTotal = lineas.reduce((s, l) => s.plus(baseSinIva(l.bruto, l.concepto.gravable)), new Decimal(0))
    const bonificacion: Bonificacion = {
        id,
        empresa_id: empresaFinal,
        cliente_id: clienteFinal,
        servicio_id: servicio?.id ?? null,
        periodo: hoy(),
        clave_unica: `cargo-${crypto.randomUUID()}`,
        concepto: lineas.map(l => l.descripcion ?? l.concepto.nombre).join(', '),
        origen: 'cargo_sin_costo',
        bruto: bruto.toFixed(2),
        base: baseTotal.toFixed(2),
        lineas: lineas.map(l => ({ concepto: l.descripcion ?? l.concepto.nombre, tipo: l.concepto.tipo, cantidad: l.cantidad.toFixed(3), precio_unitario: l.precio.toFixed(2), gravable: l.concepto.gravable, iva: l.bruto.minus(baseSinIva(l.bruto, l.concepto.gravable)).toFixed(2), total: l.bruto.toFixed(2), cuenta_codigo: l.concepto.cuenta_codigo })),
        motivo_id: motivo.id,
        motivo_nombre: motivo.nombre,
        motivo_texto: motivoTexto,
        canje_id: null,
        asiento_id: siguienteId(bd.asientos),
        created_at: momento,
    }
    bd.bonificaciones.push(bonificacion)
    bd.asientos.push(asientoBonificacion(bonificacion.asiento_id, bonificacion))
    registrarAccion(solicitud, 'facturas.emitir_cargo_unico', { tipo: 'bonificacion', id }, cuerpo)
    const respuesta: Schema<'CargoUnicoEmitido'> = { documento: 'bonificacion', factura: null, bonificacion }
    return { status: 201, cuerpo: respuesta }
}

/** Filtros comunes de la lista y del reporte. */
function filtrar(solicitud: SolicitudFixture): Bonificacion[] | RespuestaFixture {
    const { query } = solicitud
    const desde = query.get('desde')
    const hasta = query.get('hasta')
    const origen = query.get('origen')
    const errores: Errores = [['desde', desde], ['hasta', hasta]]
        .filter(([, v]) => v && !FECHA.test(v))
        .map(([field]) => ({ field: field ?? '', message: 'Fecha inválida (AAAA-MM-DD)', rule: 'regex' }))
    if (origen && !(ORIGENES as readonly string[]).includes(origen)) {
        errores.push({ field: 'origen', message: 'Origen inválido', rule: 'enum' })
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const cliente = numeroQuery(solicitud, 'cliente_id')
    const servicio = numeroQuery(solicitud, 'servicio_id')
    const motivo = numeroQuery(solicitud, 'motivo_id')
    return deLaEmpresa(bd.bonificaciones, solicitud)
        .filter(b => cliente === undefined || b.cliente_id === cliente)
        .filter(b => servicio === undefined || b.servicio_id === servicio)
        .filter(b => motivo === undefined || b.motivo_id === motivo)
        .filter(b => !origen || b.origen === origen)
        .filter(b => !desde || b.periodo >= desde)
        .filter(b => !hasta || b.periodo <= hasta)
}

const COLUMNAS: Columna[] = [
    { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
    { clave: 'motivo_id', titulo: 'Motivo', tipo: 'id' },
    { clave: 'motivo', titulo: 'Motivo', tipo: 'texto' },
    { clave: 'origen', titulo: 'Origen', tipo: 'texto' },
    { clave: 'bonificaciones', titulo: 'Bonificaciones', tipo: 'entero' },
    { clave: 'valor_bruto', titulo: 'Valor bruto', tipo: 'dinero' },
    { clave: 'base', titulo: 'Base sin IVA', tipo: 'dinero' },
]

/** Como `reporteBonificaciones` (A3): por mes, motivo y origen; consolidado con la empresa al frente. */
function reporte(solicitud: SolicitudFixture): RespuestaFixture {
    const filtradas = filtrar(solicitud)
    if (!Array.isArray(filtradas)) {
        return filtradas
    }
    const empresas = empresasDeLista(solicitud)
    const consolidado = empresas === null || empresas.length > 1
    const grupos = new Map<string, Record<string, Valor>>()
    for (const b of [...filtradas].sort((x, y) => x.periodo.localeCompare(y.periodo) || x.motivo_id - y.motivo_id)) {
        const clave = `${b.empresa_id}|${b.periodo.slice(0, 7)}|${b.motivo_id}|${b.origen}`
        const fila = grupos.get(clave) ?? {
            ...(consolidado ? { empresa_id: b.empresa_id, empresa: bd.empresas.find(e => e.id === b.empresa_id)?.nombre_comercial ?? null } : {}),
            periodo: b.periodo.slice(0, 7),
            motivo_id: b.motivo_id,
            motivo: b.motivo_nombre,
            origen: b.origen,
            bonificaciones: 0,
            valor_bruto: '0.00',
            base: '0.00',
        }
        fila.bonificaciones = Number(fila.bonificaciones) + 1
        fila.valor_bruto = new Decimal(String(fila.valor_bruto)).plus(b.bruto).toFixed(2)
        fila.base = new Decimal(String(fila.base)).plus(b.base).toFixed(2)
        grupos.set(clave, fila)
    }
    const columnas = consolidado ? [...COLUMNAS_EMPRESA, ...COLUMNAS] : COLUMNAS
    const filas = [...grupos.values()]
    const suma = totales(columnas, filas)
    const formato = solicitud.query.get('formato')
    if (formato === 'csv') {
        return { status: 200, cuerpo: csv(columnas, filas, suma), contentType: 'text/csv; charset=utf-8' }
    }
    if (formato === 'xlsx') {
        return { status: 200, cuerpo: new Uint8Array([0x50, 0x4B, 0x03, 0x04]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    }
    return {
        status: 200,
        cuerpo: { reporte: 'bonificaciones', titulo: 'Bonificaciones por motivo, origen y mes', filtros: Object.fromEntries(solicitud.query.entries()), columnas, filas, totales: suma, generado_en: ahora() },
    }
}

export const rutasBonificaciones: RutasFixture = {
    'GET /api/v1/conceptos-cargo': conPermiso('facturas.ver', solicitud => ({ status: 200, cuerpo: soloActivos(deLaEmpresa(bd.conceptosCargo, solicitud), solicitud) })),
    'GET /api/v1/motivos-sin-costo': conPermiso('facturas.ver', solicitud => ({ status: 200, cuerpo: soloActivos(deLaEmpresa(bd.motivosSinCosto, solicitud), solicitud) })),
    'POST /api/v1/facturas/cargo-unico': conPermiso('facturas.emitir_cargo_unico', conIdempotencia(emitirCargoUnico)),

    'GET /api/v1/bonificaciones': conPermiso('facturas.ver', (solicitud) => {
        const filtradas = filtrar(solicitud)
        return Array.isArray(filtradas) ? { status: 200, cuerpo: paginar([...filtradas].sort((a, b) => b.id - a.id), solicitud) } : filtradas
    }),
    'GET /api/v1/bonificaciones/:id': conPermiso('facturas.ver', (solicitud) => {
        const b = bd.bonificaciones.find(x => x.id === idDe(solicitud))
        return b ? { status: 200, cuerpo: b } : noEncontrado('la bonificación')
    }),
    'GET /api/v1/reportes/bonificaciones': conPermiso('reportes.ver', reporte),
}
