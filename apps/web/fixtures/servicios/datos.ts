import type { Schema } from '@argosisp/contracts'
import { CLIENTE_IMPORTADO, clientes } from '../clientes/datos'
import { planes } from '../planes/datos'
import { routers } from '../routers/datos'
import { zonas } from '../zonas/datos'

type Servicio = Schema<'Servicio'>
type EstadoServicio = Servicio['estado']

/** Estado por cliente; los que no aparecen están activos. */
const estados: Record<number, EstadoServicio> = {
    2: 'suspendido',
    5: 'limitado',
    9: 'retirado',
    12: 'suspendido',
    17: 'limitado',
    22: 'suspendido',
}

/** Suspendidos a mano por un operador (decisión del PM): el corte y los pagos no los reactivan. */
const suspensionManual: Record<number, string> = {
    22: 'Solicitud del cliente: viaja dos meses',
}

/**
 * Servicios sin plantilla de facturación (anteriores a las plantillas de fábrica, decisión del PM del
 * 18 nov): los recoge «Asignar a servicios sin plantilla». Solo el servicio principal del cliente.
 */
export const CLIENTES_SIN_PLANTILLA = new Set([17, 22, 23, 26, 27])

/**
 * Clientes sin servicio todavía (recién dados de alta). El 28 tiene uno por instalar que se siembra
 * aparte (`titularesEmpresa/datos.ts`); el 29 es la segunda empresa con el NIT del 11 (Iris 0.14.1).
 */
const sinServicio = new Set([14, 28, 29])

/** Clientes con un segundo servicio (empresas con sucursal). */
const conSegundo = new Set([3, 11])

function usuarioPpp(nombre: string, id: number): string {
    const partes = nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z ]/g, '')
        .split(' ')
        .filter(Boolean)
    return `${partes[0] ?? 'cliente'}.${partes[1] ?? ''}${id}`.replace(/\.$/, '')
}

/**
 * `precio_mensual` como la API (A1 + A3, contrato Iris 0.8.0): `costo_override` o, sin él, el
 * precio del plan vigente (un plan temporal activo ya está en `plan_id`), IVA incluido, con dos
 * decimales. La moneda siempre es `GTQ`.
 */
export function precioMensualServicio(costoOverride: string | null, planId: number, catalogo: readonly Schema<'Plan'>[]): string {
    return costoOverride ?? catalogo.find(p => p.id === planId)?.precio ?? '0.00'
}

/** `S-000412`: el código del servicio que arma la API desde el id. */
export function codigoServicio(id: number): string {
    return `S-${String(id).padStart(6, '0')}`
}

function crearServicio(id: number, cliente: Schema<'Cliente'>, sucursal: boolean): Servicio {
    const router = cliente.zona_id === 3 ? 2 : 1
    const plan = cliente.tipo === 'empresa' ? (router === 1 ? 3 : 4) : ((cliente.id % 2) + 1)
    const estado = sucursal ? 'activo' : (estados[cliente.id] ?? 'activo')
    const instalado = new Date(Date.UTC(2026, 8, 2 + (cliente.id % 27), 18))
    const v6 = router === 1 && plan !== 4
    return {
        id,
        // Como la API (A1, contrato Iris 0.10.0 §3.7): código automático e inmutable; nombre opcional.
        codigo: codigoServicio(id),
        nombre: sucursal ? 'Sucursal' : null,
        cliente_id: cliente.id,
        // Multiempresa (A1): las sucursales (segundo servicio de los clientes 3 y 11) son de
        // Fibra del Sur (empresa 2); lo demás, de la 1. Así un cliente tiene servicios de dos NIT.
        empresa_id: sucursal ? 2 : 1,
        router_id: router,
        plan_id: plan,
        plantilla_facturacion_id: !sucursal && CLIENTES_SIN_PLANTILLA.has(cliente.id) ? null : (cliente.tipo === 'empresa' ? 2 : 1),
        estado,
        promesa_activa: cliente.id === 12 || cliente.id === 8,
        // Como la API (A1, semana 2): siempre trae el tipo de conexión y el amarre.
        tipo_conexion: 'pppoe',
        amarre_ip_mac: false,
        user_ppp: sucursal ? `${usuarioPpp(cliente.nombre, cliente.id)}-b` : usuarioPpp(cliente.nombre, cliente.id),
        mac: `4C:5E:0C:${String(10 + id).padStart(2, '0')}:A${id % 10}:${String(id).padStart(2, '0')}`,
        direccion: sucursal ? 'Sucursal 2, local 4' : cliente.direccion,
        // Pedidos A12 y A13 de Iris: la API siempre los envía; null hasta que alguien los escriba.
        referencia: null,
        contacto_nombre: null,
        contacto_telefono: null,
        coordenadas: cliente.coordenadas,
        fecha_instalacion: instalado.toISOString().slice(0, 10),
        // Como la API (A1, instalación): la migración rellenó `instalado_en` con `created_at`; la
        // planta (OZmap, desde Iris) solo llega al activar una instalación pendiente.
        instalado_en: instalado.toISOString(),
        planta: null,
        costo_override: cliente.id === 11 && sucursal ? '299.00' : null,
        precio_mensual: precioMensualServicio(cliente.id === 11 && sucursal ? '299.00' : null, plan, planes),
        moneda: 'GTQ',
        excluir_firewall: false,
        ipv4: estado === 'retirado' ? null : (router === 1 ? `100.64.10.${10 + id}` : `100.64.20.${10 + id}`),
        prefijo_enlace_v6: v6 && estado !== 'retirado' ? `2001:db8:1000:${(id * 16).toString(16)}::/64` : null,
        prefijo_delegado_v6: v6 && estado !== 'retirado' ? `2001:db8:10${(40 + id).toString(16)}:${(id * 256).toString(16)}::/56` : null,
        ipv6_modo: v6 ? 'radius_servicio' : 'ninguno',
        ipv6_duid: null,
        suspension_manual: !sucursal && cliente.id in suspensionManual,
        suspension_manual_motivo: sucursal ? null : (suspensionManual[cliente.id] ?? null),
        // Como la API (día 3): nombres para pantallas sin permiso de ver routers, planes o zonas.
        cliente_nombre: cliente.nombre,
        plan_nombre: planes.find(p => p.id === plan)?.nombre ?? '',
        // Tipo del plan (A1, solo lectura): la API siempre lo manda.
        plan_tipo: planes.find(p => p.id === plan)?.tipo ?? 'residencial',
        router_nombre: routers.find(r => r.id === router)?.nombre ?? '',
        zona_nombre: zonas.find(z => z.id === cliente.zona_id)?.nombre ?? null,
        // Como la API (A1, día 4): siempre trae las excepciones a la plantilla (vacío si no hay).
        excepciones: cliente.id === 11 && sucursal ? { dias_gracia: 10 } : {},
        // Como la API (lealtad): siempre viene; null sin plan temporal programado ni activo.
        plan_temporal: null,
        // Como la API (`core.ids_externos`): el servicio del cliente importado vino de Mikrowisp.
        externo: cliente.id === CLIENTE_IMPORTADO && !sucursal ? { sistema: 'mikrowisp', id: '2088' } : null,
        version: 1,
        created_at: instalado.toISOString(),
        updated_at: instalado.toISOString(),
    }
}

export const servicios: Servicio[] = clientes
    .filter(cliente => !sinServicio.has(cliente.id))
    .flatMap(cliente => (conSegundo.has(cliente.id) ? [cliente, { ...cliente, sucursal: true }] : [cliente]))
    .map((cliente, indice) => crearServicio(indice + 1, cliente, 'sucursal' in cliente))

/**
 * Códigos de corte abiertos al arrancar (`core.codigos_corte`). Fase 2 (`contratos/corte-identificacion.md`
 * §5 ter.1): Juan Carlos Ramírez (servicio 2) está suspendido en RB-Centro, que identifica por IP y manda el
 * corte por el túnel; ya abrió la página y el primer salto le emitió su código. Los routers por código lo
 * abren al consultar (`fixtures/servicios/codigoCorte.ts`).
 */
export const codigosCorte = servicios
    .filter(s => s.cliente_id === 2 && s.router_id === 1 && s.estado === 'suspendido')
    .map(s => ({ servicio_id: s.id, creado_en: '2026-11-08T14:00:00.000Z', cerrado_en: null }))
