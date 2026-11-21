import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { servicios } from '../servicios/datos'
import { clientes } from '../clientes/datos'

/**
 * Equipos del cliente (A48) y bodega de cuadrilla (A47) como la API: estado del equipo, historial de
 * estados, garantías, intentos y contactos de recuperación, la cola de cobros de equipo, el cambio
 * de equipo en un paso y los miembros de la cuadrilla. El técnico nunca decide pérdidas ni cobros:
 * un cambio solo propone el cobro y la declaración de no recuperado exige `inventario.cobrar_equipo`.
 */

type Unidad = Schema<'UnidadInventario'>
type Detalle = Schema<'UnidadInventarioDetalle'>
type EstadoEquipo = NonNullable<Unidad['estado_equipo']>
type CambioEstado = Detalle['historial_estados'][number]
type Garantia = Detalle['garantias'][number]
type Intento = Detalle['intentos'][number]
type Contacto = Detalle['contactos'][number]
type Cobro = Schema<'CobroEquipo'>

export interface EquiposFixtures {
    estados: Record<number, CambioEstado[]>
    garantias: Record<number, Garantia[]>
    intentos: Record<number, Intento[]>
    contactos: Record<number, Contacto[]>
    cobros: Cobro[]
    miembros: Record<number, Schema<'MiembrosCuadrilla'>>
    siguiente: number
}

/** Bodega de cuadrilla de la empresa 1 (llega de Iris, A47): jefe Pedro y dos miembros. */
export const BODEGA_CUADRILLA_ID = 4

const SERVICIO_RETIRADO = servicios.find(s => s.estado === 'retirado')
const nombreCliente = (id: number | null) => (id ? clientes.find(c => c.id === id)?.nombre ?? `Cliente #${id}` : '')

const cambio = (fecha: string, de: EstadoEquipo, a: EstadoEquipo, motivo: string | null, servicioId: number | null = null, orden: string | null = null): CambioEstado => ({
    fecha,
    de,
    a,
    motivo,
    servicio_id: servicioId,
    origen_externo_tipo: orden ? 'iris_orden' : null,
    origen_externo_id: orden,
})

export function equiposIniciales(): EquiposFixtures {
    const retirado = SERVICIO_RETIRADO?.id ?? 9
    const clienteRetirado = SERVICIO_RETIRADO?.cliente_id ?? 9
    return {
        estados: {
            1: [cambio('2026-09-10T16:00:00.000Z', 'disponible', 'en_comodato', 'asignacion_comodato', 1, 'OT-1302')],
            5: [
                cambio('2026-09-12T16:00:00.000Z', 'disponible', 'en_comodato', 'asignacion_comodato', retirado),
                cambio('2026-11-02T16:00:00.000Z', 'en_comodato', 'por_recuperar', 'servicio_retirado', retirado),
            ],
            7: [cambio('2026-11-10T18:00:00.000Z', 'en_comodato', 'revision', 'cambio_equipo · «no enciende»', 1, 'OT-1288')],
            8: [
                cambio('2026-11-05T15:00:00.000Z', 'en_comodato', 'revision', 'cambio_equipo · wifi intermitente', 2, 'OT-1270'),
                cambio('2026-11-12T15:00:00.000Z', 'revision', 'garantia', 'enviada_garantia'),
            ],
            9: [
                cambio('2026-09-20T16:00:00.000Z', 'disponible', 'en_comodato', 'asignacion_comodato', retirado),
                cambio('2026-10-02T16:00:00.000Z', 'en_comodato', 'por_recuperar', 'servicio_retirado', retirado),
                cambio('2026-10-30T16:00:00.000Z', 'por_recuperar', 'no_recuperada', 'declarada_no_recuperada', retirado),
            ],
        },
        garantias: {
            8: [{ id: 1, proveedor_id: null, proveedor_nombre: 'Distribuidora Red', rma: '7781', vence_en: '2026-12-12', enviada_en: '2026-11-12T15:00:00.000Z', origen: 'cambio_equipo', abierta_en: '2026-11-05T15:00:00.000Z', resultado: null, resuelta_en: null, serie_anterior: null, mac_anterior: null, nota: null } as unknown as Garantia],
        },
        intentos: {
            5: [
                { id: 1, servicio_id: retirado, intento_n: 1, motivo: 'cliente_ausente', foto_ref: null, lat: '14.634915', lng: '-90.506882', precision_m: '12', nota: null, fecha: '2026-11-08T16:30:00.000Z', actor_tecnico: 'iris:usuario:15', actor_tecnico_id: 4, actor_tecnico_nombre: 'Pedro Técnico', origen_externo_id: 'OT-1290', created_at: '2026-11-08T16:31:00.000Z' },
                { id: 2, servicio_id: retirado, intento_n: 2, motivo: 'se_nego', foto_ref: 'adj-77', lat: '14.634915', lng: '-90.506882', precision_m: '9', nota: 'Dice que lo pagó', fecha: '2026-11-15T17:10:00.000Z', actor_tecnico: 'iris:usuario:16', actor_tecnico_id: null, actor_tecnico_nombre: 'Luis Ajú', origen_externo_id: 'OT-1301', created_at: '2026-11-15T17:11:00.000Z' },
            ],
        },
        contactos: {},
        cobros: [
            { id: 1, empresa_id: 1, unidad_id: 9, serie: 'HWTC1A2B3C09', mac: 'AA:BB:CC:00:00:09', producto_nombre: 'ONU Huawei HG8145', servicio_id: retirado, cliente_id: clienteRetirado, cliente_nombre: nombreCliente(clienteRetirado), origen: 'no_recuperado', cambio_id: null, motivo: 'Equipo no devuelto', nota: null, estado: 'aprobado', monto: '248.00', factura_id: null, decidido_por: 1, decidido_en: '2026-10-30T16:00:00.000Z', motivo_decision: null, version: 2, created_at: '2026-10-30T16:00:00.000Z' },
            { id: 2, empresa_id: 1, unidad_id: 7, serie: 'HWTC1A2B3C07', mac: 'AA:BB:CC:00:00:07', producto_nombre: 'ONU Huawei HG8145', servicio_id: 1, cliente_id: 1, cliente_nombre: nombreCliente(1), origen: 'cambio_equipo', cambio_id: 1, motivo: 'Daño por mal uso', nota: 'Carcasa quebrada', estado: 'propuesto', monto: null, factura_id: null, decidido_por: null, decidido_en: null, motivo_decision: null, version: 1, created_at: '2026-11-10T18:00:00.000Z' },
        ],
        miembros: {
            [BODEGA_CUADRILLA_ID]: {
                bodega_id: BODEGA_CUADRILLA_ID,
                cuadrilla_id_iris: 'cua-norte',
                version: 1,
                jefe_id: 4,
                miembros: [
                    { iris_usuario_id: 'iris-15', usuario_id: 4, nombre: 'Pedro Técnico', aceptado: true, motivo: null, desde: '2026-11-01T15:00:00.000Z' },
                    { iris_usuario_id: 'iris-16', usuario_id: null, nombre: 'Luis Ajú', aceptado: false, motivo: 'sin_vinculo', desde: '2026-11-01T15:00:00.000Z' },
                ],
            },
        },
        siguiente: 10,
    }
}

const eq = () => bd.equipos

/** Estado del equipo como la API (SQL): `en_reparacion` es garantía con una garantía abierta y si no revisión. */
export function estadoEquipo(unidad: Unidad): EstadoEquipo {
    if (unidad.estado === 'en_reparacion') {
        return (eq().garantias[unidad.id] ?? []).some(g => g.resuelta_en === null && g.enviada_en !== null) ? 'garantia' : 'revision'
    }
    return unidad.estado
}

export function vistaUnidad<T extends Unidad>(unidad: T): T {
    return { ...unidad, estado_equipo: estadoEquipo(unidad) }
}

export function detalleUnidad(unidad: Unidad): Detalle {
    const historial = bd.movimientosInventario.filter(m => m.unidad_id === unidad.id).map(m => ({
        id: m.id, tipo: m.tipo, fecha: m.fecha, bodega_id: m.bodega_id, bodega_nombre: m.bodega_nombre, cantidad: m.cantidad, costo_total: m.costo_total,
        servicio_id: m.servicio_id, asiento_id: m.asiento_id, origen_tipo: m.origen_tipo, origen_id: m.origen_id, origen_externo_tipo: null, origen_externo_id: null, motivo: m.motivo, created_at: m.created_at,
    })) as unknown as Detalle['historial']
    return {
        ...vistaUnidad(unidad),
        estado_equipo: estadoEquipo(unidad),
        historial,
        historial_estados: eq().estados[unidad.id] ?? [],
        garantias: eq().garantias[unidad.id] ?? [],
        intentos: eq().intentos[unidad.id] ?? [],
        contactos: eq().contactos[unidad.id] ?? [],
    }
}

function registrarCambio(unidad: Unidad, de: EstadoEquipo, motivo: string | null, servicioId: number | null = null) {
    const lista = eq().estados[unidad.id] ?? []
    lista.push(cambio(ahora(), de, estadoEquipo(unidad), motivo, servicioId))
    eq().estados[unidad.id] = lista
}

function cambiarUnidad(unidad: Unidad, cambios: Partial<Unidad>) {
    Object.assign(unidad, cambios, { version: unidad.version + 1, updated_at: ahora() })
}

const estadoCambiado = (detalle: string) => problemaTipado(409, 'estado_unidad_cambiado', 'El equipo cambió de estado', detalle)
const unidadDe = (solicitud: SolicitudFixture) => bd.unidadesInventario.find(u => u.id === idDe(solicitud))
const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '')

export const rutasEquipos: RutasFixture = {
    'GET /api/v1/inventario/unidades/:id': conPermiso('inventario.ver', (solicitud) => {
        const unidad = unidadDe(solicitud)
        return unidad ? { status: 200, cuerpo: detalleUnidad(unidad) } : noEncontrado('el equipo')
    }),

    'POST /api/v1/inventario/unidades/:id/enviar-garantia': conPermiso('inventario.enviar_garantia', (solicitud) => {
        const unidad = unidadDe(solicitud)
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const proveedor = texto(cuerpo.proveedor_nombre)
        const rma = texto(cuerpo.rma)
        const vence = texto(cuerpo.vence_en)
        if (!proveedor && !cuerpo.proveedor_id) {
            return datosInvalidos([{ field: 'proveedor_nombre', message: 'Escribe el proveedor', rule: 'required' }])
        }
        if (!rma || !/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
            return datosInvalidos([{ field: rma ? 'vence_en' : 'rma', message: rma ? 'Elige la fecha' : 'Escribe el RMA', rule: 'required' }])
        }
        if (estadoEquipo(unidad) !== 'revision') {
            return estadoCambiado('Solo se envía a garantía un equipo en revisión')
        }
        const lista = eq().garantias[unidad.id] ?? []
        lista.push({ id: eq().siguiente++, proveedor_id: null, proveedor_nombre: proveedor, rma, vence_en: vence, enviada_en: ahora(), origen: 'panel', abierta_en: ahora(), resultado: null, resuelta_en: null, serie_anterior: null, mac_anterior: null, nota: texto(cuerpo.nota) || null } as unknown as Garantia)
        eq().garantias[unidad.id] = lista
        cambiarUnidad(unidad, {})
        registrarCambio(unidad, 'revision', 'enviada_garantia')
        registrarAccion(solicitud, 'inventario.enviar_garantia', { tipo: 'unidad_inventario', id: unidad.id }, cuerpo)
        return { status: 200, cuerpo: vistaUnidad(unidad) }
    }),

    'POST /api/v1/inventario/unidades/:id/resolver-garantia': conPermiso('inventario.resolver_garantia', (solicitud) => {
        const unidad = unidadDe(solicitud)
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const resultado = cuerpo.resultado
        if (resultado !== 'reparada' && resultado !== 'reemplazada' && resultado !== 'rechazada') {
            return datosInvalidos([{ field: 'resultado', message: 'Elige el resultado', rule: 'enum' }])
        }
        const abierta = (eq().garantias[unidad.id] ?? []).find(g => g.resuelta_en === null)
        if (!abierta || estadoEquipo(unidad) !== 'garantia') {
            return estadoCambiado('El equipo no está en garantía')
        }
        const serie = texto(cuerpo.serie).toUpperCase()
        const mac = texto(cuerpo.mac).toUpperCase()
        if (resultado === 'reemplazada' && !serie && !mac) {
            return datosInvalidos([{ field: 'serie', message: 'Escribe la serie o la MAC del equipo nuevo', rule: 'required' }])
        }
        Object.assign(abierta, { resultado, resuelta_en: ahora(), nota: texto(cuerpo.nota) || null, ...(resultado === 'reemplazada' ? { serie_anterior: unidad.serie, mac_anterior: unidad.mac } : {}) })
        if (resultado === 'rechazada') {
            cambiarUnidad(unidad, {})
        }
        else {
            cambiarUnidad(unidad, { estado: 'disponible', condicion: resultado === 'reemplazada' ? 'nuevo' : 'usado', ...(resultado === 'reemplazada' ? { serie: serie || null, mac: mac || null } : {}) })
        }
        registrarCambio(unidad, 'garantia', `garantia_${resultado}`)
        registrarAccion(solicitud, 'inventario.resolver_garantia', { tipo: 'unidad_inventario', id: unidad.id }, cuerpo)
        return { status: 200, cuerpo: vistaUnidad(unidad) }
    }),

    'POST /api/v1/inventario/unidades/:id/contactos-recuperacion': conPermiso('inventario.registrar_contacto_recuperacion', (solicitud) => {
        const unidad = unidadDe(solicitud)
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const nota = texto(cuerpo.nota)
        const medio = texto(cuerpo.medio)
        if (!medio || nota.length < 3) {
            return datosInvalidos([{ field: medio ? 'nota' : 'medio', message: medio ? 'Escribe qué pasó (mínimo 3 caracteres)' : 'Elige cómo lo contactaste', rule: 'required' }])
        }
        if (unidad.estado !== 'en_comodato' && unidad.estado !== 'por_recuperar') {
            return estadoCambiado('Solo se registra un contacto de un equipo en comodato o por recuperar')
        }
        const contacto: Contacto = { id: eq().siguiente++, servicio_id: unidad.servicio_id, medio, nota, registrado_por: 1, registrado_por_nombre: 'Ana Administradora', created_at: ahora() }
        eq().contactos[unidad.id] = [...(eq().contactos[unidad.id] ?? []), contacto]
        registrarAccion(solicitud, 'inventario.registrar_contacto_recuperacion', { tipo: 'unidad_inventario', id: unidad.id }, cuerpo)
        return { status: 201, cuerpo: { id: contacto.id, unidad_id: unidad.id, servicio_id: unidad.servicio_id, medio, created_at: contacto.created_at } }
    }),

    'POST /api/v1/inventario/unidades/:id/declarar-no-recuperada': conPermiso('inventario.cobrar_equipo', conIdempotencia((solicitud) => {
        const unidad = unidadDe(solicitud)
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = texto(cuerpo.motivo)
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        if (unidad.estado !== 'por_recuperar') {
            return estadoCambiado('Solo se declara no recuperado un equipo por recuperar')
        }
        const intentos = eq().intentos[unidad.id] ?? []
        const tecnicos = new Set(intentos.map(i => i.actor_tecnico ?? i.actor_tecnico_id)).size
        if (tecnicos < 2 && !(eq().contactos[unidad.id] ?? []).length) {
            return problemaTipado(422, 'intentos_insuficientes', 'Faltan intentos', 'Hacen falta intentos de 2 técnicos distintos o un contacto con el cliente registrado')
        }
        const monto = texto(cuerpo.monto)
        if (monto && !/^\d{1,12}(\.\d{1,2})?$/.test(monto)) {
            return datosInvalidos([{ field: 'monto', message: 'Escribe un monto válido', rule: 'regex' }])
        }
        const servicioId = unidad.servicio_id ?? 0
        let cobroId: number | null = null
        if (monto && new Decimal(monto).gt(0)) {
            cobroId = Math.max(0, ...eq().cobros.map(c => c.id)) + 1
            eq().cobros.unshift({ id: cobroId, empresa_id: unidad.empresa_id, unidad_id: unidad.id, serie: unidad.serie, mac: unidad.mac, producto_nombre: unidad.producto_nombre, servicio_id: servicioId, cliente_id: unidad.cliente_id ?? 0, cliente_nombre: nombreCliente(unidad.cliente_id), origen: 'no_recuperado', cambio_id: null, motivo: 'Equipo no devuelto', nota: motivo, estado: 'aprobado', monto: new Decimal(monto).toFixed(2), factura_id: null, decidido_por: 1, decidido_en: ahora(), motivo_decision: null, version: 1, created_at: ahora() })
        }
        cambiarUnidad(unidad, { estado: 'no_recuperada' })
        registrarCambio(unidad, 'por_recuperar', 'declarada_no_recuperada', servicioId)
        registrarAccion(solicitud, 'inventario.declarar_no_recuperada', { tipo: 'unidad_inventario', id: unidad.id }, cuerpo)
        return { status: 200, cuerpo: { ...vistaUnidad(unidad), cobro_id: cobroId, factura_id: null } }
    })),

    'GET /api/v1/inventario/cobros-equipo/pendientes-declarar': conPermiso('inventario.ver', (solicitud) => {
        const filas = deLaEmpresa(bd.unidadesInventario, solicitud).filter(u => u.estado === 'por_recuperar' && (eq().intentos[u.id] ?? []).length > 0).map((u) => {
            const intentos = eq().intentos[u.id] ?? []
            return {
                unidad_id: u.id,
                empresa_id: u.empresa_id,
                serie: u.serie,
                mac: u.mac,
                producto_nombre: u.producto_nombre,
                servicio_id: u.servicio_id ?? 0,
                cliente_id: u.cliente_id ?? 0,
                cliente_nombre: nombreCliente(u.cliente_id),
                intentos: intentos.length,
                tecnicos_distintos: new Set(intentos.map(i => i.actor_tecnico ?? i.actor_tecnico_id)).size,
                contactos: (eq().contactos[u.id] ?? []).length,
                ultimo_intento: intentos.at(-1)?.fecha ?? '',
            }
        })
        return { status: 200, cuerpo: filas }
    }),

    'GET /api/v1/inventario/cobros-equipo': conPermiso('inventario.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        return { status: 200, cuerpo: paginar(deLaEmpresa(eq().cobros, solicitud).filter(c => !estado || c.estado === estado), solicitud) }
    }),

    'POST /api/v1/inventario/cobros-equipo/:id/aprobar': conPermiso('inventario.cobrar_equipo', conIdempotencia((solicitud) => {
        const cobro = eq().cobros.find(c => c.id === idDe(solicitud))
        if (!cobro) {
            return noEncontrado('el cobro')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== cobro.version) {
            return versionCambiada()
        }
        const monto = texto(cuerpo.monto)
        if (!/^\d{1,12}(\.\d{1,2})?$/.test(monto) || new Decimal(monto).lte(0)) {
            return datosInvalidos([{ field: 'monto', message: 'Escribe el monto a cobrar', rule: 'regex' }])
        }
        if (cobro.estado !== 'propuesto') {
            return problemaTipado(409, 'cobro_decidido', 'Cobro ya decidido', 'Este cobro ya se aprobó o se rechazó')
        }
        Object.assign(cobro, { estado: 'aprobado', monto: new Decimal(monto).toFixed(2), decidido_por: 1, decidido_en: ahora(), motivo_decision: texto(cuerpo.motivo) || null, version: cobro.version + 1 })
        registrarAccion(solicitud, 'inventario.cobrar_equipo', { tipo: 'cobro_equipo', id: cobro.id }, cuerpo)
        return { status: 200, cuerpo: cobro }
    })),

    'POST /api/v1/inventario/cobros-equipo/:id/rechazar': conPermiso('inventario.cobrar_equipo', conIdempotencia((solicitud) => {
        const cobro = eq().cobros.find(c => c.id === idDe(solicitud))
        if (!cobro) {
            return noEncontrado('el cobro')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== cobro.version) {
            return versionCambiada()
        }
        const motivo = texto(cuerpo.motivo)
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        if (cobro.estado !== 'propuesto') {
            return problemaTipado(409, 'cobro_decidido', 'Cobro ya decidido', 'Este cobro ya se aprobó o se rechazó')
        }
        Object.assign(cobro, { estado: 'rechazado', decidido_por: 1, decidido_en: ahora(), motivo_decision: motivo, version: cobro.version + 1 })
        registrarAccion(solicitud, 'inventario.cobrar_equipo', { tipo: 'cobro_equipo', id: cobro.id }, cuerpo)
        return { status: 200, cuerpo: cobro }
    })),

    'GET /api/v1/bodegas/:id/miembros': conPermiso('inventario.ver', (solicitud) => {
        const bodega = bd.bodegas.find(b => b.id === idDe(solicitud))
        if (!bodega) {
            return noEncontrado('la bodega')
        }
        const miembros = eq().miembros[bodega.id]
        if (bodega.tipo !== 'cuadrilla' || !miembros) {
            return problemaTipado(422, 'bodega_no_es_de_cuadrilla', 'Regla de negocio', 'La bodega no es de cuadrilla')
        }
        return { status: 200, cuerpo: miembros }
    }),

    /** Como `CambiarEquipo`: sale uno y entra otro; el que sale vuelve a la bodega del que entra. */
    'POST /api/v1/servicios/:id/equipos/cambiar': conPermiso('servicios.cambiar_equipo', conIdempotencia((solicitud) => {
        const servicioId = idDe(solicitud)
        const cuerpo = cuerpoObjeto(solicitud)
        const sale = bd.unidadesInventario.find(u => u.id === (cuerpo.sale as { unidad_id?: number } | undefined)?.unidad_id)
        const entra = bd.unidadesInventario.find(u => u.id === (cuerpo.entra as { unidad_id?: number } | undefined)?.unidad_id)
        const motivo = cuerpo.motivo
        const destino = cuerpo.destino_sale
        if (!sale || sale.servicio_id !== servicioId || sale.estado !== 'en_comodato') {
            return problemaTipado(409, 'unidad_no_es_del_servicio', 'El equipo no es del servicio', 'El equipo que sale no está en comodato en este servicio')
        }
        if (!entra || entra.estado !== 'disponible' || entra.bodega_id === null) {
            return problemaTipado(422, 'unidad_no_disponible', 'Equipo no disponible', 'El equipo que entra no está disponible en una bodega', [{ field: 'entra.unidad_id', message: 'Elige un equipo disponible', rule: 'disponible' }])
        }
        if (typeof destino !== 'string' || typeof motivo !== 'string') {
            return datosInvalidos([{ field: 'destino_sale', message: 'Elige qué pasa con el que sale', rule: 'required' }])
        }
        if (destino === 'funciona' && (motivo === 'danado' || motivo === 'garantia')) {
            return problemaTipado(422, 'destino_no_permitido', 'Regla de negocio', 'Un equipo dañado o en garantía no vuelve como «funciona»', [{ field: 'destino_sale', message: 'Un equipo dañado o en garantía no vuelve como «funciona»', rule: 'destino' }])
        }
        const cambioId = eq().siguiente++
        cambiarUnidad(entra, { estado: 'en_comodato', bodega_id: null, bodega_nombre: null, servicio_id: sale.servicio_id, cliente_id: sale.cliente_id, activo_id: sale.activo_id })
        registrarCambio(entra, 'disponible', 'cambio_equipo', servicioId)
        const bodega = bd.bodegas.find(b => b.id === (bd.movimientosInventario.filter(m => m.unidad_id === entra.id).at(-1)?.bodega_id ?? 1))
        cambiarUnidad(sale, { estado: destino === 'funciona' ? 'disponible' : 'en_reparacion', condicion: 'usado', bodega_id: bodega?.id ?? 1, bodega_nombre: bodega?.nombre ?? 'Bodega central', servicio_id: null, cliente_id: null, activo_id: null })
        if (destino === 'garantia') {
            eq().garantias[sale.id] = [...(eq().garantias[sale.id] ?? []), { id: eq().siguiente++, proveedor_id: null, proveedor_nombre: null, rma: null, vence_en: null, enviada_en: null, origen: 'cambio_equipo', abierta_en: ahora(), resultado: null, resuelta_en: null, serie_anterior: null, mac_anterior: null, nota: null } as unknown as Garantia]
        }
        registrarCambio(sale, 'en_comodato', `cambio_equipo · ${String(motivo)}`, servicioId)
        let cobroId: number | null = null
        const propuesto = cuerpo.cobro_propuesto as { motivo?: string, nota?: string | null } | undefined
        if (propuesto?.motivo) {
            cobroId = Math.max(0, ...eq().cobros.map(c => c.id)) + 1
            eq().cobros.unshift({ id: cobroId, empresa_id: sale.empresa_id, unidad_id: sale.id, serie: sale.serie, mac: sale.mac, producto_nombre: sale.producto_nombre, servicio_id: servicioId ?? 0, cliente_id: entra.cliente_id ?? 0, cliente_nombre: nombreCliente(entra.cliente_id), origen: 'cambio_equipo', cambio_id: cambioId, motivo: propuesto.motivo, nota: propuesto.nota ?? null, estado: 'propuesto', monto: null, factura_id: null, decidido_por: null, decidido_en: null, motivo_decision: null, version: 1, created_at: ahora() })
        }
        registrarAccion(solicitud, 'servicios.cambiar_equipo', { tipo: 'servicio', id: servicioId ?? 0 }, cuerpo)
        return { status: 200, cuerpo: { cambio_id: cambioId, sale: { unidad_id: sale.id, estado: estadoEquipo(sale) }, entra: { unidad_id: entra.id, estado: estadoEquipo(entra) }, cobro_propuesto_id: cobroId } }
    })),
}
