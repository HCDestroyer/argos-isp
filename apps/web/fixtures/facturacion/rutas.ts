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
import { nombreCuentaDestino } from '../bancos/datos'
import { asientoPago, asientoReverso } from '../libro/datos'
import { nuevaSesion } from '../sesiones/datos'
import { dinero, estadoFactura } from './datos'
import { notasDeFactura, rutasNotasCredito } from './notasCredito'

type Factura = Schema<'Factura'>
type FacturaDetalle = Schema<'FacturaDetalle'>
type Pago = Schema<'Pago'>
type ServicioEvaluado = Schema<'ServicioEvaluado'>
type Errores = NonNullable<Problem['errors']>

const METODOS: readonly Pago['metodo'][] = ['caja', 'pasarela', 'deposito', 'transferencia', 'ach', 'remesa', 'agente', 'debito']

/** Como `DATOS_POR_METODO` de `registrarPago` (A3). */
const DATOS_POR_METODO: Partial<Record<Pago['metodo'], readonly ('referencia' | 'cuenta_bancaria_id' | 'banco_origen_id')[]>> = {
    deposito: ['cuenta_bancaria_id', 'referencia'],
    transferencia: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    ach: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    remesa: ['cuenta_bancaria_id', 'referencia'],
}
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const ESTADOS_FACTURA: readonly Factura['estado'][] = ['emitida', 'parcial', 'pagada', 'vencida', 'anulada']
const ESTADOS_PAGO: readonly Pago['estado'][] = ['registrado', 'pendiente_verificacion', 'anulado']

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
}

/** Como `ReglaNegocio` de la API: 422 con `type` `urn:argosisp:problema:<codigo>`. */
/** Como `Conflicto` de la API (`anularFactura`): 409 con `type` `urn:argosisp:problema:<codigo>`. */
function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

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
        acreditado: factura.acreditado ?? '0.00',
        notas_credito: notasDeFactura(factura.id),
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
    errores.push(...validarBancarios(cuerpo))
    // Pago de terceros (A3): cada factura pedida puede ser de cualquier cliente, pero debe existir
    // y tener saldo; el error va en `facturas.<índice>`.
    if (Array.isArray(cuerpo.facturas)) {
        cuerpo.facturas.forEach((id: unknown, indice: number) => {
            const factura = bd.facturas.find(f => f.id === Number(id))
            if (!factura || factura.estado === 'pagada' || factura.estado === 'anulada') {
                errores.push({ field: `facturas.${indice}`, message: `La factura ${String(id)} no existe o no tiene saldo pendiente`, rule: 'factura_pendiente' })
            }
        })
    }
    return errores
}

/** Datos bancarios por método, como `datosBancarios` de `registrarPago`: un error por campo. */
function validarBancarios(cuerpo: Record<string, unknown>): Errores {
    if (!esMetodo(cuerpo.metodo)) {
        return []
    }
    const metodo = cuerpo.metodo
    const requeridos = DATOS_POR_METODO[metodo] ?? []
    const valores = {
        referencia: textoOpcional(cuerpo.referencia),
        cuenta_bancaria_id: typeof cuerpo.cuenta_bancaria_id === 'number' ? cuerpo.cuenta_bancaria_id : null,
        banco_origen_id: typeof cuerpo.banco_origen_id === 'number' ? cuerpo.banco_origen_id : null,
    }
    const errores: Errores = []
    for (const campo of requeridos) {
        if (valores[campo] === null) {
            errores.push({ field: campo, message: `Obligatorio con método ${metodo}`, rule: 'required' })
        }
    }
    for (const campo of ['cuenta_bancaria_id', 'banco_origen_id'] as const) {
        if (valores[campo] !== null && !requeridos.includes(campo)) {
            errores.push({ field: campo, message: `No aplica con método ${metodo}`, rule: 'no_aplica' })
        }
    }
    if (valores.cuenta_bancaria_id !== null && requeridos.includes('cuenta_bancaria_id')) {
        const cuenta = bd.cuentasBancarias.find(c => c.id === valores.cuenta_bancaria_id && c.activa)
        if (!cuenta) {
            errores.push({ field: 'cuenta_bancaria_id', message: `La cuenta bancaria ${valores.cuenta_bancaria_id} no existe o está inactiva`, rule: 'exists' })
        }
        else if (cuenta.moneda !== 'GTQ') {
            errores.push({ field: 'cuenta_bancaria_id', message: `La cuenta bancaria ${cuenta.id} es en ${cuenta.moneda}; los pagos se registran en quetzales`, rule: 'moneda' })
        }
    }
    if (valores.banco_origen_id !== null && requeridos.includes('banco_origen_id') && !bd.bancos.some(b => b.id === valores.banco_origen_id)) {
        errores.push({ field: 'banco_origen_id', message: `El banco ${valores.banco_origen_id} no existe`, rule: 'exists' })
    }
    return errores
}

/** 409 `referencia_duplicada`: la referencia es única por (método, cuenta bancaria, referencia). */
function referenciaRepetida(cuerpo: Record<string, unknown>): RespuestaFixture | null {
    const referencia = textoOpcional(cuerpo.referencia)
    if (!referencia) {
        return null
    }
    const cuenta = typeof cuerpo.cuenta_bancaria_id === 'number' ? cuerpo.cuenta_bancaria_id : null
    const repetido = bd.pagos.find(p => p.metodo === cuerpo.metodo && p.referencia === referencia && (p.cuenta_bancaria_id ?? null) === cuenta)
    if (!repetido) {
        return null
    }
    const cuerpoProblema: Problem = {
        type: 'urn:argosisp:problema:referencia_duplicada',
        title: 'Referencia duplicada',
        status: 409,
        detail: `La referencia ${referencia} ya está registrada en el pago ${repetido.id} (${String(cuerpo.metodo)}${cuenta ? `, cuenta bancaria ${cuenta})` : ')'}`,
    }
    return { status: 409, cuerpo: cuerpoProblema }
}

/** Facturas con saldo del cliente en el orden de `facturasPendientes` (vencimiento, periodo, id). */
function pendientesDe(clienteId: number) {
    return bd.facturas
        .filter(f => f.cliente_id === clienteId && f.estado !== 'pagada' && f.estado !== 'anulada')
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.periodo.localeCompare(b.periodo) || a.id - b.id)
}

/**
 * Como `registrarPago`: primero las `facturas` pedidas (en ese orden), luego las demás de la más
 * antigua a la más nueva; el excedente queda como anticipo.
 */
function aplicar(clienteId: number, monto: Decimal, indicadas: number[] | null): Pago['aplicaciones'] {
    const propias = pendientesDe(clienteId)
    const primero = (indicadas ?? []).map(id => bd.facturas.find(f => f.id === id)).filter(f => f !== undefined)
    const pendientes = [...primero, ...propias.filter(f => !primero.includes(f))]
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
        // Como `conAplicaciones` de la API: el dueño de cada factura (puede no ser el pagador).
        aplicaciones.push({
            factura_id: factura.id,
            monto: dinero(parte),
            cliente_id: factura.cliente_id,
            cliente_nombre: bd.clientes.find(c => c.id === factura.cliente_id)?.nombre ?? '',
        })
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
            empresa_id: 1,
            empresa_nombre: 'ArgosIsp',
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
    const requeridos = DATOS_POR_METODO[metodo] ?? []
    const cuenta = requeridos.includes('cuenta_bancaria_id') ? bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id) : undefined
    const banco = requeridos.includes('banco_origen_id') ? bd.bancos.find(b => b.id === cuerpo.banco_origen_id) : undefined
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
        historico: false,
        aplicaciones: aplicar(clienteId, monto, indicadas),
        anulado_en: null,
        motivo_anulacion: null,
        banco_origen_id: banco?.id ?? null,
        banco_origen_nombre: banco?.nombre ?? null,
        cuenta_bancaria_id: cuenta?.id ?? null,
        cuenta_bancaria_nombre: cuenta ? nombreCuentaDestino(cuenta) : null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
}

/**
 * Todo `POST /pagos` después del ACL: validar, 409 por referencia, aplicar, asiento, bitácora y
 * `servicios[]`. Lo reutiliza `POST /comprobantes/:id/aprobar`, que registra el pago anidado.
 */
export function procesarPago(solicitud: SolicitudFixture): RespuestaFixture {
    const errores = validar(cuerpoObjeto(solicitud))
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const repetida = referenciaRepetida(cuerpoObjeto(solicitud))
    if (repetida) {
        return repetida
    }
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
}

export const rutasFacturacion: RutasFixture = {
    ...rutasNotasCredito(evaluarServicios, detalle),

    'POST /api/v1/pagos': conPermiso('pagos.registrar', conIdempotencia(procesarPago)),

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
     * Como `anularFactura` (A3): una factura con pagos aplicados no se anula (409
     * `factura_con_pagos`, primero se anula el pago); al anular se revierte su asiento.
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
            return conflicto('factura_anulada', 'Factura anulada', `La factura ${factura.id} ya está anulada`)
        }
        if (new Decimal(factura.pagado).gt(0)) {
            return conflicto('factura_con_pagos', 'Factura con pagos', `La factura ${factura.id} tiene pagos aplicados (factura ${factura.id}: Q${factura.pagado}); anula primero el pago`)
        }
        const momento = ahora()
        Object.assign(factura, { estado: 'anulada', anulada_en: momento, motivo_anulacion: motivo, version: factura.version + 1, updated_at: momento })
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
