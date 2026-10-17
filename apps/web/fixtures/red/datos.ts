import type { Schema } from '@argosisp/contracts'

type EventoRed = Schema<'EventoRed'>

/**
 * `audit.red` de ejemplo (A2, `GET /red/eventos`): CoA y Disconnect con su respuesta del NAS y
 * comandos a RouterOS. Formato de `comando`/`respuesta` como `contratos/routeros.md` y el `coa`.
 */
export const eventosRed: EventoRed[] = [
    {
        id: 1,
        tipo: 'disconnect',
        router_id: 1,
        router_nombre: 'RB-Centro',
        servicio_id: 2,
        ok: false,
        comando: { evento: 'servicio.estado_cambiado', razon: 'suspendido', sesion_id: '81A00003', nas_ip: '10.10.0.1', puerto: 3799, intento: 3 },
        respuesta: { resultado: 'timeout', error: 'Sin respuesta del NAS en 3 s', final: true },
        created_at: '2026-10-15T14:02:00.000Z',
    },
    {
        id: 2,
        tipo: 'coa',
        router_id: 1,
        router_nombre: 'RB-Centro',
        servicio_id: 1,
        ok: true,
        comando: { evento: 'servicio.config_cambiada', sesion_id: '81A00001', nas_ip: '10.10.0.1', puerto: 3799, intento: 1 },
        respuesta: { resultado: 'ack', codigo: 44, rtt_ms: 12 },
        created_at: '2026-10-15T15:10:00.000Z',
    },
    {
        id: 3,
        tipo: 'routeros',
        router_id: 1,
        router_nombre: 'RB-Centro',
        servicio_id: 3,
        ok: false,
        comando: { metodo: 'PUT', ruta: '/ip/dhcp-server/lease', propiedades: { 'address': '100.64.10.9', 'mac-address': '***' }, host: '10.10.0.1', intento: 3 },
        respuesta: { status: 400, error: 'failure: already have static lease with this IP address', tipo_error: 'validacion' },
        created_at: '2026-10-16T09:30:00.000Z',
    },
    {
        id: 4,
        tipo: 'coa',
        router_id: 2,
        router_nombre: 'CCR-Mixco',
        servicio_id: null,
        ok: false,
        comando: { evento: 'plan.velocidad_cambiada', sesion_id: '82B00010', nas_ip: '10.20.0.1', puerto: 3799, intento: 1 },
        respuesta: { resultado: 'sin_secret', error: 'El router no tiene radius_secret' },
        created_at: '2026-10-16T11:00:00.000Z',
    },
]
