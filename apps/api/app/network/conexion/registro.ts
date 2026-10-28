import type { Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { auditableRouter } from '#network/actions/crear_router'
import { verRouter } from '#network/consultas/routers'
import { configWireguard } from '#network/conexion/config'
import { USUARIO_API, auditableConexion, filaConexion, type FilaConexion } from '#network/conexion/consultas'

/** Respuesta del registro (contrato §6.1): el script compara `ip_tunel` con la suya. */
export interface RespuestaRegistro {
    router_id: number
    ip_tunel: string
    servidor: { public_key: string; endpoint: string; puerto: number; ip: string }
}

export interface DatosRegistro {
    public_key: string
    /** la que informó el router (`/system resource version`) */
    routeros_version?: string | null
    /** PEM de la CA propia del router (`argosisp-ca.crt`); null/vacío = no cambia */
    api_ca?: string | null
}

/**
 * Registra la clave pública WireGuard del router (por token o pegada a mano) dentro de la acción:
 *
 * - Guarda la clave, consume el token y marca `registrado_en`. Una clave distinta de la anterior
 *   vuelve el estado a `pendiente` hasta el primer handshake.
 * - Pasa la clave pendiente del último script a `routers.api_password` y deja el router apuntando al
 *   túnel: `host` y `nas_ip` = `ip_tunel` (RADIUS y CoA: es el `src-address` del script y la dirección
 *   del NAS en FreeRADIUS), `api_url = https://<ip_tunel>`, `api_usuario = argosisp-api` y
 *   `api_tls_verificar = true`; con `api_ca`, la guarda (el certificado de `www-ssl` lleva
 *   `IP:<ip_tunel>` en el SAN, contrato §6.1).
 * - Emite `router.conexion_registrada` (A6 aplica el peer).
 */
export async function aplicarRegistro(
    t: Transaccion,
    conexion: FilaConexion,
    datos: DatosRegistro,
): Promise<RespuestaRegistro> {
    const routerId = conexion.router_id
    const publicKey = datos.public_key
    const wg = await configWireguard(t.trx)
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
            ...(datos.routeros_version ? { routeros_version: datos.routeros_version } : {}),
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
            api_url: `https://${conexion.ip_tunel}`,
            api_tls_verificar: true,
            ...(datos.api_ca ? { api_ca: datos.api_ca } : {}),
            ...(conexion.api_password_pendiente ? { api_password: conexion.api_password_pendiente } : {}),
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        })
    const routerDespues = await verRouter(routerId, t.trx)
    const a = auditableRouter(routerAntes)
    if (conexion.api_password_pendiente && a.api_password) a.api_password = 'anterior'
    if (datos.api_ca && a.api_ca) a.api_ca = 'anterior'
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
        servidor: {
            public_key: wg.clavePublica,
            endpoint: wg.endpoint,
            puerto: wg.puerto,
            ip: wg.red.servidor,
        },
    }
}
