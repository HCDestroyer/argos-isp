import { xmlAnulacion, xmlDte } from '#fiscal/fel/xml_gt'
import type {
    AmbienteFel,
    ContextoPrueba,
    CredencialesFel,
    DteCertificado,
    DteParaEnviar,
    ProveedorFel,
    ResultadoAnulacion,
    ResultadoCertificacion,
    ResultadoConsulta,
    ResultadoPrueba,
} from '#fiscal/fel/proveedor'

/**
 * Adaptador de INFILE (primer certificador; contrato §8.1), según la «Documentación INFILE
 * (docs.infile.com, sección Guatemala)» que compartió el PM (actualizada el 11-nov-2026;
 * `contratos/fel-establecimientos.md` B6). Nunca se llama en pruebas: allí se usa el proveedor
 * `falso` o un `fetch` sustituido.
 *
 * Credenciales (por empresa, proveedor y ambiente, cifradas en `fiscal.fel_credenciales`):
 * `usuario_firma`, `llave_firma`, `usuario_api`, `llave_api` y, opcional, `correo_copia`.
 *
 * - **Certificar y anular**: el mismo servicio, «proceso unificado»
 *   `POST {CERTIFICADOR}/fel/procesounificado/transaccion/v2/xml` (`application/xml`) con las
 *   cabeceras `UsuarioAPI`, `LlaveAPI`, `UsuarioFirma`, `LlaveFirma` e `Identificador`. El cuerpo es
 *   el `GTDocumento` o el `GTAnulacionDocumento`.
 * - **Pruebas frente a producción** no es otra URL: es el estado del emisor en INFILE. Con el emisor
 *   en «Implementación» (sandbox) todo documento vuelve con la alerta de INFILE «Este documento fue
 *   procesado en nuestro SandBox…». En `pruebas` se marca `sandbox` en el intento; en `produccion`
 *   el DTE no se da por certificado (`certificado_en_sandbox`).
 * - **Identificador repetido**: INFILE devuelve `resultado: true` con el resultado de la transacción
 *   anterior («Documento enviado previamente»). Por eso el reintento reenvía con el mismo
 *   identificador (`reenvioIdempotente`) en vez de consultar antes; `consultar` queda de respaldo.
 * - **Errores**: `descripcion_alertas_sat[]` y `descripcion_alertas_infile[]` (`fuente`,
 *   `categoria`, `numeral`, `validacion`, `mensaje_error`).
 * - **Consulta de NIT**: `POST {RECEPTORES}/rest/action` con `emisor_codigo`, `emisor_clave` y
 *   `nit_consulta`; responde `resultado` y `razon_social`.
 */

const CERTIFICADOR = 'https://certificador.feel.com.gt'
const RECEPTORES = 'https://consultareceptores.feel.com.gt'
const TIEMPO_MAXIMO_MS = 30_000

/** Texto de la alerta de INFILE con el emisor en «Implementación» (sandbox). */
export const ALERTA_SANDBOX = /sandbox/i
/** Error local de un DTE de producción que INFILE certificó en su sandbox. */
export const ERROR_SANDBOX = 'certificado_en_sandbox'

export interface AlertaInfile {
    fuente?: string
    categoria?: string
    numeral?: string
    validacion?: string
    mensaje_error?: string
}

export interface RespuestaInfile {
    resultado?: boolean
    fecha?: string
    descripcion?: string
    uuid?: string | null
    serie?: string | null
    numero?: string | number | null
    xml_certificado?: string | null
    saldo?: string | number
    creditos?: string | number
    alertas_infile?: boolean
    alertas_sat?: boolean
    descripcion_alertas_infile?: Array<AlertaInfile | string>
    descripcion_alertas_sat?: Array<AlertaInfile | string>
    control_emision?: unknown
    informacion_adicional?: unknown
    /** consulta de NIT */
    razon_social?: string | null
    /** forma anterior de los errores (compatibilidad) */
    descripcion_errores?: Array<AlertaInfile | string>
    [clave: string]: unknown
}

const OBLIGATORIAS = ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api']

function requeridas(cred: CredencialesFel, campos: string[]): string | null {
    const faltan = campos.filter((c) => !cred[c])
    return faltan.length ? `Faltan credenciales: ${faltan.join(', ')}` : null
}

/** Copia de la respuesta sin el XML (va aparte) para la bitácora `fiscal.dte_intentos`. */
export function paraBitacora(
    r: RespuestaInfile,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    const resto: Record<string, unknown> = { ...r, ...extra }
    delete resto.xml_certificado
    delete resto.archivo
    return resto
}

/** `fuente · validacion · mensaje_error` de una alerta (o el texto, si INFILE manda solo texto). */
export function textoAlerta(a: AlertaInfile | string): string {
    if (typeof a === 'string') return a.trim()
    return [a.fuente, a.validacion ?? a.numeral, a.mensaje_error]
        .filter((x) => x !== undefined && x !== null && String(x).trim() !== '')
        .map((x) => String(x).trim())
        .join(' · ')
}

/** Errores de un rechazo: alertas de la SAT, de INFILE y, por compatibilidad, `descripcion_errores`. */
export function errores(r: RespuestaInfile): string[] {
    const lista = [
        ...(r.descripcion_alertas_sat ?? []),
        ...(r.descripcion_alertas_infile ?? []),
        ...(r.descripcion_errores ?? []),
    ]
        .map(textoAlerta)
        .filter((t) => t !== '')
    return lista.length ? lista : [r.descripcion ?? 'Rechazado por el certificador']
}

/** La alerta de sandbox de INFILE (emisor en «Implementación»). */
export function esSandbox(r: RespuestaInfile): boolean {
    return (r.descripcion_alertas_infile ?? []).some((a) => ALERTA_SANDBOX.test(textoAlerta(a)))
}

/** Fecha entre corchetes con que INFILE rechaza anular un documento ya anulado; null si no es eso. */
export function fechaYaAnulado(r: RespuestaInfile): string | null {
    const textos = [r.descripcion ?? '', ...errores(r)]
    for (const t of textos) {
        if (!/anulad/i.test(t)) continue
        const fecha = /\[([^\]]+)\]/.exec(t)?.[1]
        if (fecha) return fecha.trim()
    }
    return null
}

type Envio =
    | { ok: true; status: number; datos: RespuestaInfile }
    | { ok: false; temporal: boolean; status: number | null; error: string; datos: RespuestaInfile }

async function enviar(
    url: string,
    init: { cabeceras: Record<string, string>; cuerpo: string },
): Promise<Envio> {
    try {
        const respuesta = await fetch(url, {
            method: 'POST',
            headers: init.cabeceras,
            body: init.cuerpo,
            signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
        const texto = await respuesta.text()
        let datos: RespuestaInfile = {}
        try {
            datos = JSON.parse(texto) as RespuestaInfile
        } catch {
            datos = { descripcion: texto.slice(0, 500) }
        }
        if (respuesta.status >= 500 || respuesta.status === 429) {
            return {
                ok: false,
                temporal: true,
                status: respuesta.status,
                error: `HTTP ${respuesta.status}`,
                datos,
            }
        }
        if (!respuesta.ok) {
            return {
                ok: false,
                temporal: false,
                status: respuesta.status,
                error: `HTTP ${respuesta.status}`,
                datos,
            }
        }
        return { ok: true, status: respuesta.status, datos }
    } catch (error) {
        // red, DNS o tiempo agotado: se reintenta con el mismo identificador
        return {
            ok: false,
            temporal: true,
            status: null,
            error: (error as Error).name || 'error de red',
            datos: {},
        }
    }
}

export class ProveedorFelInfile implements ProveedorFel {
    readonly codigo = 'infile'
    readonly capacidades = { contingencia: false, consultaNit: true, pdf: false }
    /** Reenviar con el mismo `Identificador` devuelve el resultado anterior (documentado). */
    readonly reenvioIdempotente = true

    private cabeceras(cred: CredencialesFel, identificador: string): Record<string, string> {
        return {
            'Content-Type': 'application/xml',
            UsuarioAPI: cred.usuario_api!,
            LlaveAPI: cred.llave_api!,
            UsuarioFirma: cred.usuario_firma!,
            LlaveFirma: cred.llave_firma!,
            Identificador: identificador,
        }
    }

    private async consultaNit(nit: string, cred: CredencialesFel): Promise<Envio> {
        return enviar(`${RECEPTORES}/rest/action`, {
            cabeceras: { 'Content-Type': 'application/json' },
            cuerpo: JSON.stringify({
                emisor_codigo: cred.usuario_api,
                emisor_clave: cred.llave_api,
                nit_consulta: nit,
            }),
        })
    }

    /**
     * Consulta el NIT de la empresa con usuario y llave del API (no certifica nada). `ok` solo con
     * HTTP 200 y una respuesta con forma de consulta (`resultado` presente); el detalle trae la razón
     * social que devolvió INFILE para que se vea que es la empresa.
     */
    async probarCredenciales(
        cred: CredencialesFel,
        _ambiente: AmbienteFel,
        contexto: ContextoPrueba = {},
    ): Promise<ResultadoPrueba> {
        const falta = requeridas(cred, OBLIGATORIAS)
        if (falta) return { ok: false, detalle: falta }
        const nit = contexto.nit_emisor
        if (!nit) {
            return {
                ok: false,
                detalle: 'La empresa no tiene NIT: agrégalo antes de probar las credenciales',
            }
        }
        const r = await this.consultaNit(nit, cred)
        if (!r.ok) return { ok: false, detalle: `INFILE no aceptó las credenciales (${r.error})` }
        if (typeof r.datos.resultado !== 'boolean') {
            return {
                ok: false,
                detalle: `INFILE respondió algo que no es una consulta de NIT: ${r.datos.descripcion ?? 'sin descripción'}`,
            }
        }
        if (r.datos.resultado && r.datos.razon_social) {
            return { ok: true, detalle: `INFILE respondió con el NIT ${nit}: ${r.datos.razon_social}` }
        }
        return {
            ok: true,
            detalle: `INFILE aceptó las credenciales, pero no encontró el NIT ${nit}${r.datos.descripcion ? ` (${r.datos.descripcion})` : ''}`,
        }
    }

    async certificar(
        dte: DteParaEnviar,
        cred: CredencialesFel,
        ambiente: AmbienteFel,
    ): Promise<ResultadoCertificacion> {
        const falta = requeridas(cred, OBLIGATORIAS)
        if (falta) return { resultado: 'rechazado', errores: [falta], respuesta: {} }
        const r = await enviar(`${CERTIFICADOR}/fel/procesounificado/transaccion/v2/xml`, {
            cabeceras: this.cabeceras(cred, dte.identificador),
            cuerpo: xmlDte(dte),
        })
        if (!r.ok) {
            return r.temporal
                ? { resultado: 'error_temporal', error: r.error, respuesta: paraBitacora(r.datos) }
                : { resultado: 'rechazado', errores: errores(r.datos), respuesta: paraBitacora(r.datos) }
        }
        const d = r.datos
        if (!d.resultado || !d.uuid) {
            return { resultado: 'rechazado', errores: errores(d), respuesta: paraBitacora(d) }
        }
        const sandbox = esSandbox(d)
        if (sandbox && ambiente === 'produccion') {
            // un emisor en «Implementación»: el documento no tiene validez fiscal
            return {
                resultado: 'rechazado',
                errores: [ERROR_SANDBOX],
                respuesta: paraBitacora(d, { sandbox: true }),
            }
        }
        return {
            resultado: 'certificado',
            autorizacion: String(d.uuid),
            serie: d.serie ? String(d.serie) : null,
            numero: d.numero !== undefined && d.numero !== null ? String(d.numero) : null,
            fecha: d.fecha ? new Date(d.fecha) : new Date(),
            xml: d.xml_certificado ? Buffer.from(d.xml_certificado, 'base64').toString('utf8') : xmlDte(dte),
            pdf: null,
            respuesta: paraBitacora(d, sandbox ? { sandbox: true } : {}),
        }
    }

    async anular(dte: DteCertificado, motivo: string, cred: CredencialesFel): Promise<ResultadoAnulacion> {
        const falta = requeridas(cred, OBLIGATORIAS)
        if (falta) return { resultado: 'rechazado', errores: [falta], respuesta: {} }
        const fecha = new Date()
        const r = await enviar(`${CERTIFICADOR}/fel/procesounificado/transaccion/v2/xml`, {
            cabeceras: this.cabeceras(cred, `${dte.identificador}-anulacion`),
            cuerpo: xmlAnulacion(dte, motivo, fecha),
        })
        if (!r.ok) {
            const yaAnulado = fechaYaAnulado(r.datos)
            if (yaAnulado) return this.yaAnulado(yaAnulado, r.datos)
            return r.temporal
                ? { resultado: 'error_temporal', error: r.error, respuesta: paraBitacora(r.datos) }
                : { resultado: 'rechazado', errores: errores(r.datos), respuesta: paraBitacora(r.datos) }
        }
        if (!r.datos.resultado) {
            const yaAnulado = fechaYaAnulado(r.datos)
            if (yaAnulado) return this.yaAnulado(yaAnulado, r.datos)
            return { resultado: 'rechazado', errores: errores(r.datos), respuesta: paraBitacora(r.datos) }
        }
        return {
            resultado: 'anulado',
            fecha: r.datos.fecha ? new Date(r.datos.fecha) : fecha,
            xml: r.datos.xml_certificado
                ? Buffer.from(r.datos.xml_certificado, 'base64').toString('utf8')
                : null,
            respuesta: paraBitacora(r.datos),
        }
    }

    /** Ya estaba anulado (INFILE dice la fecha entre corchetes): no es un error, es el estado. */
    private yaAnulado(fecha: string, datos: RespuestaInfile): ResultadoAnulacion {
        const instante = new Date(fecha)
        return {
            resultado: 'anulado',
            fecha: Number.isNaN(instante.getTime()) ? new Date() : instante,
            xml: null,
            respuesta: paraBitacora(datos, { ya_anulado: fecha }),
        }
    }

    /**
     * Respaldo: el reintento normal reenvía con el mismo identificador (`reenvioIdempotente`). La
     * ruta de esta consulta no está en la documentación de INFILE: solo se usa si se llama a mano.
     */
    async consultar(identificador: string, cred: CredencialesFel): Promise<ResultadoConsulta> {
        const r = await enviar(`${CERTIFICADOR}/fel/consulta/dte/v2/identificador_unico`, {
            cabeceras: { 'Content-Type': 'application/json' },
            cuerpo: JSON.stringify({
                emisor_codigo: cred.usuario_api,
                emisor_clave: cred.llave_api,
                identificador_unico: identificador,
            }),
        })
        if (!r.ok) {
            return r.temporal
                ? { encontrado: null, error: r.error, respuesta: paraBitacora(r.datos) }
                : { encontrado: false, respuesta: paraBitacora(r.datos) }
        }
        const d = r.datos
        if (!d.resultado || !d.uuid) return { encontrado: false, respuesta: paraBitacora(d) }
        return {
            encontrado: true,
            autorizacion: String(d.uuid),
            serie: d.serie ? String(d.serie) : null,
            numero: d.numero !== undefined && d.numero !== null ? String(d.numero) : null,
            fecha: d.fecha ? new Date(d.fecha) : new Date(),
            xml: d.xml_certificado ? Buffer.from(d.xml_certificado, 'base64').toString('utf8') : null,
            anulado: d.estado === 'Anulado' || d.anulado === true,
            respuesta: paraBitacora(d),
        }
    }

    /**
     * Consulta de NIT: `{ nombre }` si la SAT lo reconoce, null si INFILE responde «no encontrado».
     * Un error de red o HTTP **lanza**: no se confunde «no existe» con «no respondió».
     */
    async consultarNit(nit: string, cred: CredencialesFel): Promise<{ nombre: string } | null> {
        const r = await this.consultaNit(nit, cred)
        if (!r.ok) throw new Error(`INFILE no respondió la consulta de NIT (${r.error})`)
        if (typeof r.datos.resultado !== 'boolean') {
            throw new Error(
                `Respuesta inesperada de la consulta de NIT: ${r.datos.descripcion ?? 'sin descripción'}`,
            )
        }
        if (!r.datos.resultado || !r.datos.razon_social) return null
        return { nombre: String(r.datos.razon_social) }
    }
}
