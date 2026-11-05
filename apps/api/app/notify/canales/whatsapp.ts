import { configIris } from '#integraciones/iris/configuracion'
import {
    ErrorCanal,
    type Canal,
    type EstadoEntrega,
    type OpcionesEnvio,
    type ResultadoEnvio,
} from '#notify/canales/canal'
import { esTransitorioIris } from '#notify/idempotencia_iris'

/**
 * Canal `whatsapp` de notify por la mensajería de Iris (contrato Iris 0.6.0 §6, pedido A21). Argos
 * no habla con Meta: pide el aviso a `POST <iris>/api/v1/mensajeria/avisos` con el token del
 * conector (§1.2, `iris_pat_` con `mensajeria.enviar`) e Iris decide si y cómo sale (plantilla
 * aprobada, permiso de contacto, límites, horario de silencio).
 *
 * - `cuerpo` es el **código** de la plantilla de Iris (§6.3); nunca un texto. Sin número de teléfono:
 *   Iris lo toma de su instantánea del cliente (§6.2), así ningún aviso sale a otro contacto.
 * - `Idempotency-Key = argos:aviso:<plantilla>:<envio_id>`: un reintento manda los mismos bytes (las
 *   variables se fijan al programar el envío) e Iris devuelve el mismo aviso.
 * - `202 { aviso_id, estado: en_cola | bloqueado, motivo? }` → `ResultadoEnvio` con `estado`.
 * - Se reintentan: red, timeout, `429`, `5xx` y el `409` de idempotencia en curso, con cualquiera de
 *   sus dos nombres (`idempotencia_en_curso` o `idempotencia_en_proceso`, `#notify/idempotencia_iris`).
 *   Otro `4xx`, también otro `409`, es permanente (`422 variable_desconocida`, `401` token
 *   revocado…): el envío queda `fallido` con el detalle.
 * - Lee el conector en cada envío (sin caché, regla 5). Si está apagado o sin URL o token, lanza un
 *   error permanente; `EnviarNotificacion` ya lo marca `omitido` antes (`estadoWhatsappIris`).
 */

/** Plazo de cada llamada a Iris. */
const PLAZO_MS = 10_000

let fetchIris: typeof fetch = (...args) => fetch(...args)

/** `fetch` de las llamadas a la mensajería de Iris (las pruebas lo reemplazan). */
export function fijarFetchWhatsappIris(fn?: typeof fetch) {
    fetchIris = fn ?? ((...args) => fetch(...args))
}

/** `argos:aviso:<plantilla>:<envio_id>` (§6.2). */
export function claveAvisoIris(plantilla: string, envioId: number): string {
    return `argos:aviso:${plantilla}:${envioId}`
}

/** Envío de Argos a partir de la `idempotency_key` que devuelve Iris en sus webhooks (§6.6). */
export function envioDeClaveAviso(clave: unknown): { plantilla: string; envioId: number } | null {
    if (typeof clave !== 'string') return null
    const m = /^argos:aviso:([a-z0-9_]{1,64}):(\d{1,18})$/.exec(clave)
    if (!m) return null
    const envioId = Number(m[2])
    return Number.isSafeInteger(envioId) && envioId > 0 ? { plantilla: m[1]!, envioId } : null
}

/** Cuerpo exacto de `POST /mensajeria/avisos` (§6.2), en el orden del contrato. */
export function cuerpoAvisoIris(plantilla: string, aviso: NonNullable<OpcionesEnvio['aviso']>): string {
    return JSON.stringify({
        empresa_id: aviso.empresaId,
        cliente_id: aviso.clienteId,
        servicio_id: aviso.servicioId,
        plantilla,
        variables: aviso.variables,
        canal_preferido: 'whatsapp',
        prioridad: 'normal',
    })
}

/** `GET /mensajeria/avisos/:id` (Iris 0.6.1): `estado` en_cola | bloqueado | entregado | fallido. */
export interface ConsultaAvisoIris {
    estado: string | null
    motivo: string | null
    detalle: string | null
    entregado_en: string | null
    leido_en: string | null
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

/** `detail` (o `title`/`code`) de un problem+json, recortado; o el texto crudo. */
function detalle(cuerpo: string): string {
    try {
        const json = JSON.parse(cuerpo) as Record<string, unknown>
        const partes = [texto(json.code) ?? texto(json.type), texto(json.detail) ?? texto(json.title)]
        const unido = partes.filter(Boolean).join(': ')
        if (unido) return unido.slice(0, 500)
    } catch {
        // no es JSON
    }
    return cuerpo.slice(0, 500)
}

export class CanalWhatsappIris implements Canal {
    readonly nombre = 'whatsapp' as const

    private async conector(): Promise<{ urlBase: string; token: string }> {
        const config = await configIris()
        if (!config.activo || !config.urlBase || !config.token) {
            throw new ErrorCanal('whatsapp', 'conector Iris apagado o sin URL ni token', true)
        }
        return { urlBase: config.urlBase.replace(/\/+$/, ''), token: config.token }
    }

    async enviar(
        _destino: string,
        _asunto: string | null,
        cuerpo: string,
        opciones: OpcionesEnvio = {},
    ): Promise<ResultadoEnvio> {
        const aviso = opciones.aviso
        if (!aviso) throw new ErrorCanal('whatsapp', 'falta el aviso (envío, cliente y variables)', true)
        const plantilla = cuerpo.trim()
        const { urlBase, token } = await this.conector()
        let respuesta: Response
        let crudo: string
        try {
            respuesta = await fetchIris(`${urlBase}/api/v1/mensajeria/avisos`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'idempotency-key': claveAvisoIris(plantilla, aviso.envioId),
                },
                body: cuerpoAvisoIris(plantilla, aviso),
                signal: AbortSignal.timeout(PLAZO_MS),
            })
            crudo = await respuesta.text()
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error)
            throw new ErrorCanal('whatsapp', `Iris no respondió: ${mensaje}`, false, { cause: error })
        }
        if (!respuesta.ok) {
            const transitorio = esTransitorioIris(respuesta.status, crudo)
            throw new ErrorCanal('whatsapp', `Iris ${respuesta.status} ${detalle(crudo)}`, !transitorio)
        }
        let json: Record<string, unknown>
        try {
            json = JSON.parse(crudo) as Record<string, unknown>
        } catch {
            throw new ErrorCanal('whatsapp', `Iris ${respuesta.status}: respuesta que no es JSON`, false)
        }
        const avisoId = json.aviso_id
        const estado = json.estado
        if ((typeof avisoId !== 'string' && typeof avisoId !== 'number') || String(avisoId) === '') {
            throw new ErrorCanal('whatsapp', `Iris ${respuesta.status}: respuesta sin aviso_id`, false)
        }
        if (estado !== 'en_cola' && estado !== 'bloqueado') {
            throw new ErrorCanal(
                'whatsapp',
                `Iris ${respuesta.status}: estado desconocido ${String(estado)}`,
                false,
            )
        }
        return {
            id: String(avisoId),
            estado,
            motivo: estado === 'bloqueado' ? (texto(json.motivo) ?? 'sin_motivo') : null,
        }
    }

    /** `GET /mensajeria/avisos/:id` (§6.6): para los envíos que esperan acuse hace más de 24 h. */
    async consultar(id: string): Promise<ConsultaAvisoIris> {
        const { urlBase, token } = await this.conector()
        let respuesta: Response
        let crudo: string
        try {
            respuesta = await fetchIris(`${urlBase}/api/v1/mensajeria/avisos/${encodeURIComponent(id)}`, {
                method: 'GET',
                headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
                signal: AbortSignal.timeout(PLAZO_MS),
            })
            crudo = await respuesta.text()
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error)
            throw new ErrorCanal('whatsapp', `Iris no respondió: ${mensaje}`, false, { cause: error })
        }
        if (!respuesta.ok) {
            throw new ErrorCanal(
                'whatsapp',
                `Iris ${respuesta.status} ${detalle(crudo)}`,
                respuesta.status < 500 && respuesta.status !== 429,
            )
        }
        const json = JSON.parse(crudo) as Record<string, unknown>
        return {
            estado: texto(json.estado),
            motivo: texto(json.motivo),
            detalle: texto(json.detalle),
            entregado_en: texto(json.entregado_en),
            leido_en: texto(json.leido_en),
        }
    }

    async estado(id: string): Promise<EstadoEntrega> {
        const consulta = await this.consultar(id)
        if (consulta.estado === 'entregado') return 'entregado'
        if (consulta.estado === 'fallido') return 'fallido'
        if (consulta.estado === 'en_cola') return 'enviado'
        return 'desconocido'
    }
}

let unico: CanalWhatsappIris | null = null

/** El adaptador es uno por proceso (no guarda estado: lee el conector en cada llamada). */
export function canalWhatsappIris(): CanalWhatsappIris {
    unico ??= new CanalWhatsappIris()
    return unico
}
