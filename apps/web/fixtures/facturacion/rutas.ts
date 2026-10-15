import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    idDe,
    noEncontrado,
    registrarAccion,
    usuariosPorToken,
} from '../comun'
import { nuevaSesion } from '../sesiones/datos'
import { dinero, estadoFactura } from './datos'

type Pago = Schema<'Pago'>
type ServicioEvaluado = Schema<'ServicioEvaluado'>
type Errores = NonNullable<Problem['errors']>

const METODOS: readonly Pago['metodo'][] = ['caja', 'pasarela', 'deposito', 'agente', 'debito']
const MONTO = /^\d{1,12}(\.\d{1,2})?$/

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
        registrarAccion(solicitud, 'pagos.registrar', { tipo: 'pago', id: resultado.id }, cuerpoObjeto(solicitud))
        const tocados = new Set(resultado.aplicaciones
            .map(a => bd.facturas.find(f => f.id === a.factura_id)?.servicio_id)
            .filter((id): id is number => typeof id === 'number'))
        const servicios = evaluarServicios([...tocados])
        return { status: 201, cuerpo: { ...resultado, servicios } }
    })),

    'GET /api/v1/pagos/:id': conPermiso('pagos.ver', (solicitud) => {
        const pago = bd.pagos.find(p => p.id === idDe(solicitud))
        return pago ? { status: 200, cuerpo: pago } : noEncontrado('el pago')
    }),

    'GET /api/v1/cajas': conPermiso('cajas.ver', () => ({ status: 200, cuerpo: bd.cajas })),
}
