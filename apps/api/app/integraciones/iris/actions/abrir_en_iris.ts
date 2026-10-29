import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { configIris, errorUrlIris } from '#integraciones/iris/configuracion'
import { ConectorIrisNoDisponible, IrisRespondioError } from '#integraciones/iris/errores'

/** Ruta de tickets de autologin en Iris (contrato Iris §1.3: `<prefijo>` = `integraciones/argosisp`). */
export const RUTA_TICKETS_IRIS = '/api/v1/integraciones/argosisp/sso/tickets'
/** Destinos que abre Iris (§1.3). */
export const TIPOS_DESTINO_IRIS = ['ticket', 'orden', 'prospecto'] as const
export type TipoDestinoIris = (typeof TIPOS_DESTINO_IRIS)[number]
/** Timeout de la llamada a Iris. */
export const TIMEOUT_IRIS_MS = 4000

export interface EntradaAbrirEnIris {
    destino: { tipo: TipoDestinoIris; id_externo: string }
}

export interface SalidaAbrirEnIris {
    /** `https://<iris>/sso/entrar#<ticket>`: el panel la abre; un solo uso, 60 s */
    url: string
    expira_en: string | null
}

/**
 * `iris.abrir`: "Ver en Iris" (Argos es el origen del autologin, contrato Iris §1.3 → Horus §1.5).
 * El **servidor** de Argos pide el ticket a Iris con el `iris_pat_` guardado, con el usuario de la
 * sesión (`id_externo` = `u-<id>`, correo y nombre) y el destino (`ticket`, `orden` o `prospecto`,
 * ids de Iris), y devuelve al panel solo la URL. El navegador nunca pide el ticket; Iris aplica su
 * propio ACL al entrar. Auditada (quién y a qué recurso).
 *
 * 422 `iris_apagado` con el conector apagado o sin URL/token; 502 `iris_error` si Iris falla o
 * devuelve una URL que no es `https://<panel de Iris>/sso/entrar#<ticket>`.
 */
export default class AbrirEnIris extends DomainAction<EntradaAbrirEnIris, SalidaAbrirEnIris> {
    readonly nombre = 'iris.abrir'

    protected async handle(input: EntradaAbrirEnIris, t: Transaccion): Promise<SalidaAbrirEnIris> {
        t.fijarEmpresa(null)
        const config = await configIris(t.trx)
        if (!config.activo || !config.urlBase || !config.token) throw new ConectorIrisNoDisponible()
        const usuarioId = usuarioDelActor(t.ctx.actor)
        if (!usuarioId) throw new ConectorIrisNoDisponible('"Ver en Iris" necesita un usuario con sesión')
        const usuario = (await t.trx
            .from('core.usuarios')
            .where('id', usuarioId)
            .select('nombre', 'email')
            .first()) as {
            nombre: string
            email: string
        } | null

        let respuesta: Response
        try {
            respuesta = await fetch(`${config.urlBase}${RUTA_TICKETS_IRIS}`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${config.token}`,
                    'content-type': 'application/json',
                    accept: 'application/json',
                },
                body: JSON.stringify({
                    usuario: {
                        id_externo: `u-${usuarioId}`,
                        correo: usuario?.email ?? null,
                        nombre: usuario?.nombre ?? null,
                    },
                    destino: { tipo: input.destino.tipo, id_externo: String(input.destino.id_externo) },
                }),
                signal: AbortSignal.timeout(TIMEOUT_IRIS_MS),
            })
        } catch (error) {
            const causa =
                error instanceof Error && error.name === 'TimeoutError'
                    ? `sin respuesta en ${TIMEOUT_IRIS_MS} ms`
                    : describirError(error)
            throw new IrisRespondioError(`No se pudo llamar a Iris: ${causa}`)
        }
        const texto = await respuesta.text().catch(() => '')
        if (!respuesta.ok) {
            throw new IrisRespondioError(`Iris respondió ${respuesta.status}: ${detalleDe(texto)}`)
        }
        let datos: { url?: unknown; expira_en?: unknown } = {}
        try {
            datos = JSON.parse(texto) as typeof datos
        } catch {
            throw new IrisRespondioError('Iris respondió algo que no es JSON')
        }
        if (typeof datos.url !== 'string' || !urlEntradaIrisValida(datos.url)) {
            throw new IrisRespondioError(
                'Iris devolvió una URL de autologin que no es https://<panel>/sso/entrar#<ticket>',
            )
        }
        return { url: datos.url, expira_en: typeof datos.expira_en === 'string' ? datos.expira_en : null }
    }
}

function describirError(error: unknown): string {
    if (error instanceof Error) {
        const causa = (error as Error & { cause?: { code?: string; message?: string } }).cause
        return causa?.code ?? causa?.message ?? error.message
    }
    return String(error)
}

/** `detail` o `title` del problem+json de Iris, o el texto recortado. */
function detalleDe(texto: string): string {
    try {
        const json = JSON.parse(texto) as { detail?: string; title?: string }
        return json.detail ?? json.title ?? texto.slice(0, 200)
    } catch {
        return texto.slice(0, 200) || 'sin cuerpo'
    }
}

/**
 * La URL que devuelve Iris la abre el navegador del usuario: https (http solo en laboratorio), sin
 * credenciales ni consulta, ruta `/sso/entrar` y el ticket en el fragmento. Su origen es el del
 * panel de Iris, que puede no ser el de su API.
 */
export function urlEntradaIrisValida(valor: string): boolean {
    if (valor.length > 4096 || errorUrlIris(valor)) return false
    const url = new URL(valor)
    const ticket = url.hash.replace(/^#/, '')
    return (
        !url.username &&
        !url.password &&
        !url.search &&
        url.pathname.replace(/\/+$/, '') === '/sso/entrar' &&
        ticket.length >= 16 &&
        ticket.length <= 512
    )
}
