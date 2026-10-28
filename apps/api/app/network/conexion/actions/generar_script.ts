import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar, descifrar } from '#shared/cifrado'
import { ReglaNegocio } from '#shared/errores'
import { verRouter } from '#network/consultas/routers'
import { configWireguard, urlBaseApi } from '#network/conexion/config'
import { asignarIpTunel } from '#network/conexion/ipam_tunel'
import {
    VIGENCIA_TOKEN_H,
    auditableConexion,
    filaConexion,
    generarClaveApi,
    generarToken,
} from '#network/conexion/consultas'
import { PLANTILLAS, leerMikrotik, renderizar, variablesMikrotik } from '#network/conexion/render'
import { valoresServicio } from '#network/conexion/servicio'

export interface EntradaGenerarScript {
    router_id: number
    /** IPs o redes para `argosisp-admin` (winbox y ssh); vacía = gestión solo por el túnel */
    admin?: string[]
    /** suma PPPoE, perfiles y corte (`?incluir=servicio`, `conexion-servicio.rsc.tpl`) */
    incluir_servicio?: boolean
    /** origen de la petición (`https://host`), si no hay `API_PUBLIC_URL` */
    origen: string
}

export interface ScriptConexion {
    script: string
    nombre_archivo: string
}

/** El patrón de `radius_secret` en `variables.json` (16 a 128 ASCII imprimibles, sin espacio). */
const SECRETO_RADIUS = /^[\x21-\x7e]{16,128}$/

/**
 * `routers.generar_script` (`contratos/conexion-routers.md` §3 y §6.2): arma el `.rsc` con las
 * plantillas de A6 (`infra/mikrotik/plantillas`) y el render de `render.ts`.
 *
 * - La primera vez crea la fila de `network.routers_conexion` con su IP del túnel (estable).
 * - Rota el token de registro (un uso, 24 h; el anterior deja de valer) y crea una clave nueva para
 *   el usuario `argosisp-api`, que se guarda cifrada como pendiente: pasa a `api_password` cuando el
 *   router se registra con este script (un script generado y no ejecutado no deja a la API sin
 *   acceso al router).
 * - El secreto RADIUS es el `radius_secret` del router, el mismo con que se arma su cliente de
 *   FreeRADIUS. Nunca se inventa otro: sin él (o si no cumple 16 a 128 caracteres imprimibles sin
 *   espacios), 422 `radius_secret_requerido`.
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
        const wg = await configWireguard(t.trx)
        const argosUrl = urlBaseApi(input.origen)

        const { radius_secret: secretoCifrado } = (await t.trx
            .from('network.routers')
            .where('id', routerId)
            .select('radius_secret')
            .firstOrFail()) as { radius_secret: string | null }
        const secreto = secretoCifrado ? descifrar(secretoCifrado) : null
        if (!secreto || !SECRETO_RADIUS.test(secreto)) {
            throw new ReglaNegocio(
                secreto
                    ? 'El secreto RADIUS del router debe tener de 16 a 128 caracteres imprimibles y sin espacios ' +
                          '(va en el script y en FreeRADIUS). Cámbialo en la ficha del router y vuelve a generar'
                    : 'El router no tiene secreto RADIUS. Defínelo en la ficha del router (es el mismo que usa ' +
                          'FreeRADIUS) y vuelve a generar el script',
                'radius_secret_requerido',
            )
        }
        const servicio = input.incluir_servicio ? valoresServicio(router) : {}

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

        const plantilla = leerMikrotik(input.incluir_servicio ? PLANTILLAS.servicio : PLANTILLAS.conexion)
        const texto = renderizar(
            plantilla,
            {
                router_id: String(routerId),
                generado_en: new Date().toISOString(),
                argos_url: argosUrl,
                token: token.valor,
                wg_ip: despues.ip_tunel,
                wg_servidor_ip: wg.red.servidor,
                wg_red: wg.red.cidr,
                wg_servidor_public_key: wg.clavePublica,
                wg_servidor_endpoint: wg.endpoint,
                wg_servidor_puerto: String(wg.puerto),
                radius_secret: secreto,
                api_password: claveApi,
                api_nombre: `router-${routerId}.argosisp`,
                admin_ips: (input.admin ?? []).join(','),
                ...servicio,
            },
            variablesMikrotik(),
        )

        await t.emit('router.conexion_generada', {
            router_id: routerId,
            empresa_id: router.empresa_sugerida_id,
            actor: t.ctx.actor,
        })
        return { script: texto, nombre_archivo: `argosisp-router-${routerId}.rsc` }
    }
}
