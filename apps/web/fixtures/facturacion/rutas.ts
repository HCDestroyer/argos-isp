import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    idDe,
    noEncontrado,
    numeroQuery,
    paginar,
    registrarAccion,
    usuariosPorToken,
} from '../comun'
import { asientoPago, asientoReverso } from '../libro/datos'
import { nuevaSesion } from '../sesiones/datos'
import { dinero, estadoFactura } from './datos'

type Factura = Schema<'Factura'>
type FacturaDetalle = Schema<'FacturaDetalle'>
type Pago = Schema<'Pago'>
type ServicioEvaluado = Schema<'ServicioEvaluado'>
type Errores = NonNullable<Problem['errors']>

const METODOS: readonly Pago['metodo'][] = ['caja', 'pasarela', 'deposito', 'agente', 'debito']
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const ESTADOS_FACTURA: readonly Factura['estado'][] = ['emitida', 'parcial', 'pagada', 'vencida', 'anulada']
const ESTADOS_PAGO: readonly Pago['estado'][] = ['registrado', 'pendiente_verificacion', 'anulado']

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
}

/** Como `ReglaNegocio` de la API: 422 con `type` `urn:argosisp:problema:<codigo>`. */
function reglaNegocio(codigo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: 'Regla de negocio', status: 422, detail: detalle }
    return { status: 422, cuerpo }
}

/** Motivo de anulación: 3 a 500 caracteres, como los validadores de anular de la API. */
function validarMotivo(solicitud: SolicitudFixture): string | Errores {
    const { motivo } = cuerpoObjeto(solicitud)
    const texto = typeof motivo === 'string' ? motivo.trim() : ''
    if (texto.length < 3 || texto.length > 500) {
        return [{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }]
    }
    return texto
}

/** Detalle de un aviso: una línea por el servicio del periodo (o la mora), como `facturas_lineas`. */
function detalle(factura: Factura): FacturaDetalle {
    const servicio = bd.servicios.find(s => s.id === factura.servicio_id)
    const plan = bd.planes.find(p => p.id === servicio?.plan_id)
    const mora = factura.tipo === 'mora'
    return {
        ...factura,
        lineas: [{
            id: factura.id * 10 + 1,
            concepto: mora
                ? `Recargo por mora de la factura ${factura.factura_origen_id ?? ''}`.trim()
                : `Internet ${plan?.nombre ?? 'residencial'} · periodo ${factura.periodo.slice(0, 7)}`,
            tipo: mora ? 'mora' : 'servicio',
            cantidad: '1.000',
            precio_unitario: factura.subtotal,
            gravable: true,
            iva: factura.iva,
            total: factura.total,
        }],
        reglas_snapshot: {
            plantilla_facturacion_id: servicio?.plantilla_facturacion_id ?? null,
            dias_gracia: 0,
        },
    }
}

/** Revierte lo que el pago aplicó a cada factura (el pago anulado deja de contar). */
function desaplicar(pago: Pago): void {
    for (const aplicacion of pago.aplicaciones) {
        const factura = bd.facturas.find(f => f.id === aplicacion.factura_id)
        if (!factura) {
            continue
        }
        const pagado = Decimal.max(new Decimal(factura.pagado).minus(aplicacion.monto), 0)
        Object.assign(factura, {
            pagado: dinero(pagado),
            estado: estadoFactura(pagado, new Decimal(factura.total), factura.vence_en),
            version: factura.version + 1,
            updated_at: ahora(),
        })
    }
}

/** Caja principal (cuenta "Caja principal"): la que usa `POST /pagos` con `caja` sin `caja_id`. */
export const CAJA_PRINCIPAL_ID = 1

function esMetodo(valor: unknown): valor is Pago['metodo'] {
    return typeof valor === 'string' && (METODOS as readonly string[]).includes(valor)
}

function textoOpcional(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

/** Espejo del validador de `POST /pagos` (A3) más las reglas que la acción revisa en la base. */
function validar(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
    const { cliente_id: clienteId, metodo, monto, caja_id: cajaId, referencia, nota } = cuerpo
    if (!bd.clientes.some(c => c.id === clienteId)) {
        errores.push({ field: 'cliente_id', message: 'El cliente no existe', rule: 'exists' })
    }
    if (!esMetodo(metodo)) {
        errores.push({ field: 'metodo', message: 'Método de pago inválido', rule: 'enum' })
    }
    if (typeof monto !== 'string' || !MONTO.test(monto) || new Decimal(monto).lte(0)) {
        errores.push({ field: 'monto', message: 'El monto debe ser mayor que cero, con hasta 2 decimales', rule: 'regex' })
    }
    // Como la API: `caja` sin `caja_id` va a la caja principal; una caja elegida debe estar activa.
    if (metodo === 'caja' && cajaId !== undefined && cajaId !== null) {
        const caja = bd.cajas.find(c => c.id === cajaId)
        if (!caja?.activa) {
            errores.push({ field: 'caja_id', message: `La caja ${String(cajaId)} no existe o está inactiva`, rule: 'caja' })
        }
    }
    if (typeof referencia === 'string' && referencia.length > 100) {
        errores.push({ field: 'referencia', message: 'Máximo 100 caracteres', rule: 'maxLength' })
    }
    if (typeof nota === 'string' && nota.length > 500) {
        errores.push({ field: 'nota', message: 'Máximo 500 caracteres', rule: 'maxLength' })
    }
    return errores
}

/** Aplica el monto a las facturas pendientes, la más antigua primero (o a las indicadas). */
function aplicar(clienteId: number, monto: Decimal, indicadas: number[] | null): Pago['aplicaciones'] {
    const pendientes = bd.facturas
        .filter(f => f.cliente_id === clienteId && f.estado !== 'pagada' && f.estado !== 'anulada')
        .filter(f => !indicadas || indicadas.includes(f.id))
        .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.id - b.id)
    const aplicaciones: Pago['aplicaciones'] = []
    let resto = monto
    for (const factura of pendientes) {
        if (resto.lte(0)) {
            break
        }
        const saldo = new Decimal(factura.total).minus(factura.pagado)
        const parte = Decimal.min(resto, saldo)
        const pagado = new Decimal(factura.pagado).plus(parte)
        Object.assign(factura, {
            pagado: dinero(pagado),
            estado: estadoFactura(pagado, new Decimal(factura.total), factura.vence_en),
            version: factura.version + 1,
            updated_at: ahora(),
        })
        aplicaciones.push({ factura_id: factura.id, monto: dinero(parte) })
        resto = resto.minus(parte)
    }
    return aplicaciones
}

/**
 * Lo que hace `evaluarEstadoServicio` dentro de `registrarPago` (misma transacción): cada
 * servicio cuyas facturas tocó el pago y que ya no debe facturas vencidas vuelve a `activo`, y el
 * Disconnect hace que el equipo vuelva a conectarse. Un servicio suspendido a mano no se toca.
 * Devuelve `Pago.servicios[]`.
 */
function evaluarServicios(servicioIds: number[]): ServicioEvaluado[] {
    const evaluados: ServicioEvaluado[] = []
    for (const servicioId of servicioIds) {
        const indice = bd.servicios.findIndex(s => s.id === servicioId)
        const servicio = bd.servicios[indice]
        if (!servicio) {
            continue
        }
        const base = { servicio_id: servicio.id, de: servicio.estado, estado: servicio.estado, cambiado: false }
        if (servicio.estado === 'retirado') {
            evaluados.push({ ...base, motivo: 'servicio retirado' })
            continue
        }
        if (servicio.suspension_manual) {
            evaluados.push({ ...base, motivo: 'suspensión manual' })
            continue
        }
        const vencidas = bd.facturas.filter(f => f.servicio_id === servicio.id && f.estado === 'vencida').length
        if (vencidas > 0 || servicio.estado === 'activo') {
            evaluados.push({ ...base, motivo: vencidas ? `${vencidas} ${vencidas === 1 ? 'factura vencida' : 'facturas vencidas'}` : 'sin facturas vencidas' })
            continue
        }
        const momento = ahora()
        const activo = { ...servicio, estado: 'activo' as const, version: servicio.version + 1, updated_at: momento }
        bd.servicios[indice] = activo
        for (const sesion of bd.sesiones) {
            if (sesion.servicio_id === servicio.id && sesion.fin === null) {
                sesion.fin = momento
                sesion.causa_fin = 'Admin-Reset'
            }
        }
        bd.sesiones.push(nuevaSesion(siguienteId(bd.sesiones), activo, momento))
        const id = siguienteId(bd.acciones)
        bd.acciones.push({
            id,
            actor_tipo: 'sistema',
            actor_id: null,
            actor_nombre: null,
            canal: 'panel',
            accion: 'servicios.cambiar_estado',
            entidad_tipo: 'servicio',
            entidad_id: servicio.id,
            entrada: { servicioId: servicio.id, nuevo: 'activo', motivo: 'sin facturas vencidas' },
            resultado: 'ok',
            error: null,
            request_id: `req-fixture-${id}`,
            created_at: momento,
        })
        evaluados.push({ ...base, estado: 'activo', cambiado: true, motivo: 'sin facturas vencidas' })
    }
    return evaluados
}

function registrarPago(solicitud: SolicitudFixture): Pago | Errores {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validar(cuerpo)
    if (errores.length) {
        return errores
    }
    const clienteId = Number(cuerpo.cliente_id)
    const monto = new Decimal(String(cuerpo.monto))
    const indicadas = Array.isArray(cuerpo.facturas) ? cuerpo.facturas.filter((f): f is number => typeof f === 'number') : null
    const metodo = cuerpo.metodo as Pago['metodo']
    const momento = ahora()
    const usuario = solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
    return {
        id: siguienteId(bd.pagos),
        cliente_id: clienteId,
        metodo,
        monto: dinero(monto),
        comision: '0.00',
        referencia: textoOpcional(cuerpo.referencia),
        caja_id: metodo === 'caja' ? (typeof cuerpo.caja_id === 'number' ? cuerpo.caja_id : CAJA_PRINCIPAL_ID) : null,
        pasarela: null,
        estado: 'registrado',
        nota: textoOpcional(cuerpo.nota),
        registrado_por: usuario,
        aplicaciones: aplicar(clienteId, monto, indicadas),
        anulado_en: null,
        motivo_anulacion: null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
}

export const rutasFacturacion: RutasFixture = {
    'POST /api/v1/pagos': conPermiso('pagos.registrar', conIdempotencia((solicitud) => {
        const resultado = registrarPago(solicitud)
        if (Array.isArray(resultado)) {
            return datosInvalidos(resultado)
        }
        bd.pagos.push(resultado)
        bd.asientos.push(asientoPago(siguienteId(bd.asientos), resultado))
        registrarAccion(solicitud, 'pagos.registrar', { tipo: 'pago', id: resultado.id }, cuerpoObjeto(solicitud))
        const tocados = new Set(resultado.aplicaciones
            .map(a => bd.facturas.find(f => f.id === a.factura_id)?.servicio_id)
            .filter((id): id is number => typeof id === 'number'))
        const servicios = evaluarServicios([...tocados])
        return { status: 201, cuerpo: { ...resultado, servicios } }
    })),

    'GET /api/v1/pagos': conPermiso('pagos.ver', (solicitud) => {
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const caja = numeroQuery(solicitud, 'caja_id')
        const metodo = solicitud.query.get('metodo')
        const estado = solicitud.query.get('estado')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        if (metodo && !esMetodo(metodo)) {
            return datosInvalidos([{ field: 'metodo', message: 'Método de pago inválido', rule: 'enum' }])
        }
        if (estado && !(ESTADOS_PAGO as readonly string[]).includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        const filas = bd.pagos
            .filter(p => cliente === undefined || p.cliente_id === cliente)
            .filter(p => caja === undefined || p.caja_id === caja)
            .filter(p => !metodo || p.metodo === metodo)
            .filter(p => !estado || p.estado === estado)
            .filter(p => !desde || new Date(p.created_at) >= new Date(desde))
            .filter(p => !hasta || new Date(p.created_at) <= new Date(hasta))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/pagos/:id/anular': conPermiso('pagos.anular', conIdempotencia((solicitud) => {
        const pago = bd.pagos.find(p => p.id === idDe(solicitud))
        if (!pago) {
            return noEncontrado('el pago')
        }
        const motivo = validarMotivo(solicitud)
        if (Array.isArray(motivo)) {
            return datosInvalidos(motivo)
        }
        if (pago.estado === 'anulado') {
            return reglaNegocio('pago_anulado', `El pago ${pago.id} ya está anulado`)
        }
        const momento = ahora()
        desaplicar(pago)
        Object.assign(pago, { estado: 'anulado', anulado_en: momento, motivo_anulacion: motivo, version: pago.version + 1, updated_at: momento })
        const original = bd.asientos.find(a => a.origen_tipo === 'pago' && a.origen_id === pago.id && a.reversa_de === null)
        if (original) {
            bd.asientos.push(asientoReverso(siguienteId(bd.asientos), original, `Anulación del pago ${pago.id} · ${motivo}`, momento, usuarioDe(solicitud)))
        }
        registrarAccion(solicitud, 'pagos.anular', { tipo: 'pago', id: pago.id }, { motivo })
        return { status: 200, cuerpo: pago }
    })),

    'GET /api/v1/facturas': conPermiso('facturas.ver', (solicitud) => {
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const servicio = numeroQuery(solicitud, 'servicio_id')
        const estado = solicitud.query.get('estado')
        const periodo = solicitud.query.get('periodo')
        if (estado && !(ESTADOS_FACTURA as readonly string[]).includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        const filas = bd.facturas
            .filter(f => cliente === undefined || f.cliente_id === cliente)
            .filter(f => servicio === undefined || f.servicio_id === servicio)
            .filter(f => !estado || f.estado === estado)
            .filter(f => !periodo || f.periodo === periodo)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/facturas/:id': conPermiso('facturas.ver', (solicitud) => {
        const factura = bd.facturas.find(f => f.id === idDe(solicitud))
        return factura ? { status: 200, cuerpo: detalle(factura) } : noEncontrado('la factura')
    }),

    /**
     * Hoy 501 en la API (A3, día 4). Aquí el camino feliz: una factura con pagos aplicados no se
     * anula (422, primero se anulan los pagos); al anular se revierte su asiento.
     */
    'POST /api/v1/facturas/:id/anular': conPermiso('facturas.anular', conIdempotencia((solicitud) => {
        const factura = bd.facturas.find(f => f.id === idDe(solicitud))
        if (!factura) {
            return noEncontrado('la factura')
        }
        const motivo = validarMotivo(solicitud)
        if (Array.isArray(motivo)) {
            return datosInvalidos(motivo)
        }
        if (factura.estado === 'anulada') {
            return reglaNegocio('factura_anulada', `La factura ${factura.id} ya está anulada`)
        }
        if (new Decimal(factura.pagado).gt(0)) {
            return reglaNegocio('factura_con_pagos', `La factura ${factura.id} tiene pagos aplicados: anula primero esos pagos`)
        }
        const momento = ahora()
        Object.assign(factura, { estado: 'anulada', version: factura.version + 1, updated_at: momento })
        const original = bd.asientos.find(a => a.origen_tipo === 'factura' && a.origen_id === factura.id && a.reversa_de === null)
        if (original) {
            bd.asientos.push(asientoReverso(siguienteId(bd.asientos), original, `Anulación de la factura ${factura.id} · ${motivo}`, momento, usuarioDe(solicitud)))
        }
        registrarAccion(solicitud, 'facturas.anular', { tipo: 'factura', id: factura.id }, { motivo })
        return { status: 200, cuerpo: factura }
    })),

    'GET /api/v1/pagos/:id': conPermiso('pagos.ver', (solicitud) => {
        const pago = bd.pagos.find(p => p.id === idDe(solicitud))
        return pago ? { status: 200, cuerpo: pago } : noEncontrado('el pago')
    }),

    'GET /api/v1/cajas': conPermiso('cajas.ver', () => ({ status: 200, cuerpo: bd.cajas })),
}
