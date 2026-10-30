import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { evaluarComprobaciones, type Comprobacion } from '#core/eliminacion'

/**
 * Qué impide eliminar un router (`contratos/eliminar.md`). Lo que depende solo de él (redes IPv4,
 * bloques y pools IPv6 sin asignaciones, `planes_routers`, contacto, migración AAA, conexión
 * WireGuard) no lo impide: se borra con él.
 *
 * Comandos a RouterOS: impiden eliminar los que cambiaron algo en el equipo (PUT/PATCH/DELETE/POST)
 * y los CoA/Disconnect. Las lecturas (sondeo cada 5 min, probar conexión) no son historial que
 * conservar: un router recién creado se sondea igual.
 */
function comprobacionesRouter(id: number, nasIp: string | null): Comprobacion[] {
    return [
        {
            codigo: 'servicios',
            nombre: ['servicio (también cuentan los retirados)', 'servicios (también cuentan los retirados)'],
            consulta: (c) => c.from('core.servicios').where('router_id', id),
        },
        {
            codigo: 'sesiones',
            nombre: ['sesión PPPoE', 'sesiones PPPoE'],
            consulta: (c) =>
                c.from('network.sesiones').where((w) =>
                    w
                        .where('router_id', id)
                        // un router sin RADIUS (sin nas_ip) solo cuenta las suyas
                        .orWhere((n) =>
                            nasIp === null
                                ? n.whereRaw('false')
                                : n.whereNull('router_id').where('nas_ip', nasIp),
                        ),
                ),
        },
        {
            codigo: 'historial_asignaciones',
            nombre: ['tramo de historial de servicios', 'tramos de historial de servicios'],
            consulta: (c) => c.from('network.asignaciones_historial').where('router_id', id),
        },
        {
            codigo: 'asignaciones_ipv4',
            nombre: ['asignación IPv4 en sus redes', 'asignaciones IPv4 en sus redes'],
            consulta: (c) =>
                c
                    .from('network.ipv4_asignaciones')
                    .whereIn('red_id', (q) =>
                        q.from('network.redes_ipv4').where('router_id', id).select('id'),
                    ),
        },
        {
            codigo: 'asignaciones_ipv6',
            nombre: ['prefijo IPv6 asignado en sus pools', 'prefijos IPv6 asignados en sus pools'],
            consulta: (c) =>
                c.from('network.ipv6_asignaciones').whereIn('pool_id', (q) =>
                    q
                        .from('network.ipv6_pools')
                        .whereIn('bloque_id', (b) =>
                            b.from('network.ipv6_bloques').where('router_id', id).select('id'),
                        )
                        .select('id'),
                ),
        },
        {
            codigo: 'routeros',
            nombre: ['comando enviado al equipo (audit.red)', 'comandos enviados al equipo (audit.red)'],
            consulta: (c) =>
                c
                    .from('audit.red')
                    .where('router_id', id)
                    .where((w) =>
                        w
                            .whereIn('tipo', ['coa', 'disconnect'])
                            .orWhereRaw(`comando->>'metodo' IN ('PUT', 'PATCH', 'DELETE', 'POST')`),
                    ),
        },
        {
            codigo: 'bodegas',
            nombre: ['bodega de inventario', 'bodegas de inventario'],
            consulta: (c) => c.from('inventario.bodegas').where('router_id', id),
        },
        {
            codigo: 'alcance_roles',
            nombre: ['rol de usuario con alcance en el router', 'roles de usuario con alcance en el router'],
            consulta: (c) => c.from('core.usuarios_roles').where({ alcance_tipo: 'router', alcance_id: id }),
        },
        {
            codigo: 'alcance_tokens',
            nombre: ['token de API con alcance en el router', 'tokens de API con alcance en el router'],
            consulta: (c) =>
                c
                    .from('core.tokens_api')
                    .whereNull('revocado_en')
                    .whereRaw(`alcances->'routers' @> to_jsonb(?::bigint)`, [id]),
        },
        {
            codigo: 'importacion',
            nombre: ['fila importada', 'filas importadas'],
            consulta: (c) =>
                c.from('importacion.filas_origen').where('entidad_tipo', 'router').where('entidad_id', id),
        },
    ]
}

/** ¿Se puede eliminar el router? Si no, qué lo impide. 404 lo resuelve quien llama. */
export async function routerEliminable(
    id: number,
    nasIp: string | null,
    cliente: QueryClientContract = db.connection(),
) {
    return evaluarComprobaciones(comprobacionesRouter(id, nasIp), cliente)
}
