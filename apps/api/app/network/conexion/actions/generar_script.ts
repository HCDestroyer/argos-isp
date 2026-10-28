import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar, descifrar } from '#shared/cifrado'
import { ReglaNegocio } from '#shared/errores'
import { verRouter } from '#network/consultas/routers'
import { configWireguard, urlBaseApi } from '#network/conexion/config'
import { asignarIpTunel } from '#network/conexion/ipam_tunel'
import {
    GRUPO_API,
    USUARIO_API,
    VIGENCIA_TOKEN_H,
    auditableConexion,
    filaConexion,
    generarClaveApi,
    generarToken,
} from '#network/conexion/consultas'
import { plantillaConexion } from '#network/conexion/plantilla'
import { renderScript } from '#network/conexion/render'

export interface EntradaGenerarScript {
    router_id: number
    /** IPs o redes para `argosisp-admin` (winbox y ssh); vacía = gestión solo por el túnel */
    admin?: string[]
    /** suma PPPoE, perfiles y corte (`?incluir=servicio`) */
    incluir_servicio?: boolean
    /** origen de la petición (`https://host`), si no hay `API_PUBLIC_URL` */
    origen: string
}

export interface ScriptConexion {
    script: string
    nombre_archivo: string
}

/**
 * `routers.generar_script` (`contratos/conexion-routers.md` §3): arma el `.rsc` de conexión del
 * router.
 *
 * - La primera vez crea la fila de `network.routers_conexion` con su IP del túnel (estable).
 * - Rota el token de registro (un uso, 24 h; el anterior deja de valer) y crea una clave nueva para
 *   el usuario `argosisp-api`, que se guarda cifrada como pendiente: pasa a `api_password` cuando el
 *   router se registra con este script (así un script generado y no ejecutado no deja a la API sin
 *   acceso al router).
 * - El secreto RADIUS es el `radius_secret` del router, el mismo con que `pnpm aaa:clients` arma su
 *   cliente de FreeRADIUS. Nunca se inventa otro: sin él, 422 `radius_secret_requerido`.
 * - Ni la auditoría ni el evento llevan secretos; el script no se guarda.
 */
export default class GenerarScript extends DomainAction<EntradaGenerarScript, ScriptConexion> {
    readonly nombre = 'routers.generar_script'

    protected async handle(input: EntradaGenerarScript, t: Transaccion): Promise<ScriptConexion> {
        const routerId = input.router_id
        t.fijarEntidad('router', routerId)
        await t.trx.from('network.routers').where('id', routerId).forUpdate().select('id')
        const router = await verRouter(routerId, t.trx)
        t.fijarEmpresa(router.empresa_sugerida_id)
        const wg = configWireguard()

        const secretos = (await t.trx
            .from('network.routers')
            .where('id', routerId)
            .select('radius_secret')
            .firstOrFail()) as { radius_secret: string | null }
        const conRadius = router.modo_seguridad === 'radius'
        if (conRadius && !secretos.radius_secret) {
            throw new ReglaNegocio(
                'El router no tiene secreto RADIUS. Defínelo en la ficha del router (es el mismo que usa ' +
                    'FreeRADIUS) y vuelve a generar el script',
                'radius_secret_requerido',
            )
        }

        const antes = await filaConexion(routerId, t.trx, true)
        const token = generarToken()
        const claveApi = generarClaveApi()
        const vence = DateTime.utc().plus({ hours: VIGENCIA_TOKEN_H })
        const cambios = {
            token_hash: token.hash,
            token_vence: vence.toJSDate(),
            token_usado_en: null,
            api_password_pendiente: cifrar(claveApi),
        }
        if (antes) {
            await t.trx
                .from('network.routers_conexion')
                .where('router_id', routerId)
                .update({
                    ...cambios,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        } else {
            const ipTunel = await asignarIpTunel(t.trx, wg.red)
            await t.trx
                .insertQuery()
                .table('network.routers_conexion')
                .insert({ router_id: routerId, ip_tunel: ipTunel, ...cambios })
        }
        const despues = (await filaConexion(routerId, t.trx))!
        await t.registrarCambios(
            { tipo: 'router_conexion', id: routerId },
            auditableConexion(antes),
            auditableConexion(despues),
        )
        t.fijarEntidad('router', routerId)

        const admin = input.admin ?? []
        const texto = renderScript(plantillaConexion().texto, {
            textos: {
                router_id: String(routerId),
                router_nombre: router.nombre,
                generado_en: new Date().toISOString(),
                token_vence: vence.toISO()!,
                ip_tunel: despues.ip_tunel,
                ip_tunel_cidr: `${despues.ip_tunel}/${wg.red.prefijo}`,
                red_tunel: wg.red.cidr,
                servidor_ip: wg.red.servidor,
                servidor_public_key: wg.clavePublica,
                servidor_endpoint: wg.endpoint,
                servidor_puerto: String(wg.puerto),
                registro_url: `${urlBaseApi(input.origen)}/api/v1/routers/conexion/registrar`,
                registro_token: token.valor,
                api_usuario: USUARIO_API,
                api_grupo: GRUPO_API,
                api_password: claveApi,
                radius_secret: conRadius ? descifrar(secretos.radius_secret!) : '',
            },
            listas: { admin_ips: admin },
            secciones: {
                radius: conRadius,
                incluir_servicio: input.incluir_servicio === true,
                admin: admin.length > 0,
            },
        })

        await t.emit('router.conexion_generada', {
            router_id: routerId,
            empresa_id: router.empresa_sugerida_id,
            actor: t.ctx.actor,
        })
        return { script: texto, nombre_archivo: `argosisp-router-${routerId}.rsc` }
    }
}
