import type { Schema } from '@argosisp/contracts'
import { clientes } from '../clientes/datos'
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

/** Clientes sin servicio todavía (recién dados de alta). */
const sinServicio = new Set([14, 28])

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

function crearServicio(id: number, cliente: Schema<'Cliente'>, sucursal: boolean): Servicio {
    const router = cliente.zona_id === 3 ? 2 : 1
    const plan = cliente.tipo === 'empresa' ? (router === 1 ? 3 : 4) : ((cliente.id % 2) + 1)
    const estado = sucursal ? 'activo' : (estados[cliente.id] ?? 'activo')
    const instalado = new Date(Date.UTC(2026, 8, 2 + (cliente.id % 27), 18))
    const v6 = router === 1 && plan !== 4
    return {
        id,
        cliente_id: cliente.id,
        // Multiempresa (A1): las sucursales (segundo servicio de los clientes 3 y 11) son de
        // Fibra del Sur (empresa 2); lo demás, de la 1. Así un cliente tiene servicios de dos NIT.
        empresa_id: sucursal ? 2 : 1,
        router_id: router,
        plan_id: plan,
        plantilla_facturacion_id: cliente.tipo === 'empresa' ? 2 : 1,
        estado,
        promesa_activa: cliente.id === 12,
        // Como la API (A1, semana 2): siempre trae el tipo de conexión y el amarre.
        tipo_conexion: 'pppoe',
        amarre_ip_mac: false,
        user_ppp: sucursal ? `${usuarioPpp(cliente.nombre, cliente.id)}-b` : usuarioPpp(cliente.nombre, cliente.id),
        mac: `4C:5E:0C:${String(10 + id).padStart(2, '0')}:A${id % 10}:${String(id).padStart(2, '0')}`,
        direccion: sucursal ? 'Sucursal 2, local 4' : cliente.direccion,
        coordenadas: cliente.coordenadas,
        fecha_instalacion: instalado.toISOString().slice(0, 10),
        costo_override: cliente.id === 11 && sucursal ? '299.00' : null,
        excluir_firewall: false,
        ipv4: estado === 'retirado' ? null : (router === 1 ? `100.64.10.${10 + id}` : `100.64.20.${10 + id}`),
        prefijo_enlace_v6: v6 && estado !== 'retirado' ? `2803:d100:1000:${(id * 16).toString(16)}::/64` : null,
        prefijo_delegado_v6: v6 && estado !== 'retirado' ? `2803:d100:10${(40 + id).toString(16)}:${(id * 256).toString(16)}::/56` : null,
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
        version: 1,
        created_at: instalado.toISOString(),
        updated_at: instalado.toISOString(),
    }
}

export const servicios: Servicio[] = clientes
    .filter(cliente => !sinServicio.has(cliente.id))
    .flatMap(cliente => (conSegundo.has(cliente.id) ? [cliente, { ...cliente, sucursal: true }] : [cliente]))
    .map((cliente, indice) => crearServicio(indice + 1, cliente, 'sucursal' in cliente))
