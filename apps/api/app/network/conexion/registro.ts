import type { Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { auditableRouter } from '#network/actions/crear_router'
import { verRouter } from '#network/consultas/routers'
import { configWireguard } from '#network/conexion/config'
import { USUARIO_API, auditableConexion, filaConexion, type FilaConexion } from '#network/conexion/consultas'

export interface RespuestaRegistro {
    router_id: number
    ip_tunel: string
    ip_tunel_cidr: string
    servidor_ip: string
    servidor_public_key: string
    servidor_endpoint: string
    servidor_puerto: number
}

/**
 * Registra la clave pública WireGuard del router (por token o pegada a mano) dentro de la acción:
 *
 * - Guarda la clave, consume el token y marca `registrado_en`. Una clave distinta de la anterior
 *   vuelve el estado a `pendiente` hasta el primer handshake.
 * - Pasa la clave pendiente del último script a `routers.api_password` y deja `host`, `nas_ip`,
 *   `api_usuario` y `api_url` del router apuntando al túnel (la API REST por la IP del túnel; RADIUS
 *   y CoA por la misma IP, que el script pone como `src-address`).
 * - Emite `router.conexion_registrada` (A6 aplica el peer).
 */
export async function aplicarRegistro(
    t: Transaccion,
    conexion: FilaConexion,
    publicKey: string,
): Promise<RespuestaRegistro> {
    const routerId = conexion.router_id
    const wg = configWireguard()
    const otra = await t.trx
        .from('network.routers_conexion')
        .where('public_key', publicKey)
        .whereNot('router_id', routerId)
        .select('router_id')
        .first()
    if (otra) throw new Conflicto('Esa clave pública ya está registrada en otro router', 'clave_en_uso')
    const nasOcupada = await t.trx
        .from('network.routers')
        .where('nas_ip', conexion.ip_tunel)
        .whereNot('id', routerId)
        .select('id')
        .first()
    if (nasOcupada) {
        throw new Conflicto(
            `La IP del túnel ${conexion.ip_tunel} es la nas_ip del router ${nasOcupada.id}; cámbiala allí`,
            'ip_tunel_en_uso',
        )
    }

    const claveCambio = conexion.public_key !== publicKey
    await t.trx
        .from('network.routers_conexion')
        .where('router_id', routerId)
        .update({
            public_key: publicKey,
            registrado_en: t.trx.knexRawQuery('now()'),
            token_usado_en: conexion.token_hash ? t.trx.knexRawQuery('now()') : null,
            api_password_pendiente: null,
            ...(claveCambio ? { estado: 'pendiente', ultimo_handshake: null } : {}),
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        })
    const despues = (await filaConexion(routerId, t.trx))!
    await t.registrarCambios(
        { tipo: 'router_conexion', id: routerId },
        auditableConexion(conexion),
        auditableConexion(despues),
    )

    const routerAntes = await verRouter(routerId, t.trx)
    await t.trx
        .from('network.routers')
        .where('id', routerId)
        .update({
            host: conexion.ip_tunel,
            nas_ip: conexion.ip_tunel,
            api_usuario: USUARIO_API,
            api_url: null,
            ...(conexion.api_password_pendiente ? { api_password: conexion.api_password_pendiente } : {}),
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        })
    const routerDespues = await verRouter(routerId, t.trx)
    const a = auditableRouter(routerAntes)
    if (conexion.api_password_pendiente && a.api_password) a.api_password = 'anterior'
    await t.registrarCambios({ tipo: 'router', id: routerId }, a, auditableRouter(routerDespues))

    await t.emit('router.conexion_registrada', {
        router_id: routerId,
        empresa_id: routerDespues.empresa_sugerida_id,
        ip_tunel: conexion.ip_tunel,
    })
    t.fijarEmpresa(routerDespues.empresa_sugerida_id)
    return {
        router_id: routerId,
        ip_tunel: conexion.ip_tunel,
        ip_tunel_cidr: `${conexion.ip_tunel}/${wg.red.prefijo}`,
        servidor_ip: wg.red.servidor,
        servidor_public_key: wg.clavePublica,
        servidor_endpoint: wg.endpoint,
        servidor_puerto: wg.puerto,
    }
}
