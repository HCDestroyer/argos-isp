import { xmlAnulacion, xmlDte } from '#fiscal/fel/xml_gt'
import type {
    AmbienteFel,
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
 * Adaptador de INFILE (primer certificador; contrato §8.1), escrito contra su documentación
 * pública. Nunca se llama en pruebas: allí se usa el proveedor `falso`.
 *
 * Credenciales (por empresa y ambiente, cifradas en `fiscal.fel_credenciales`): `usuario_firma`,
 * `llave_firma` (token del firmador), `usuario_api`, `llave_api` y, opcional, `correo_copia`.
 *
 * Operaciones:
 *  - Certificar: "proceso unificado" (firma y certificación en una llamada), `POST
 *    {CERTIFICADOR}/fel/procesounificado/transaccion/v2/xml` con el XML sin firmar y las cabeceras
 *    `UsuarioFirma`, `LlaveFirma`, `UsuarioApi`, `LlaveApi` e `identificador` (nuestro
 *    `fiscal.dte.identificador`: INFILE lo usa para no certificar dos veces el mismo documento).
 *  - Anular: firma con `es_anulacion = 'S'` en `{FIRMADOR}/sign_solicitud_firmas/firma_xml` y envío
 *    a `{CERTIFICADOR}/fel/anulacion/v2/dte/`.
 *  - Consultar por identificador y consultar NIT (`{RECEPTORES}/rest/action`).
 *
 * **Confirmar con INFILE** (anotado en el contrato §16): las URL de pruebas frente a producción (la
 * documentación pública usa las mismas y el ambiente lo da la credencial), la ruta exacta de la
 * consulta por identificador, el texto con que avisa de un identificador ya certificado y si el
 * proceso unificado aplica también a la anulación.
 */

const CERTIFICADOR = 'https://certificador.feel.com.gt'
const FIRMADOR = 'https://signer-emisores.feel.com.gt'
const RECEPTORES = 'https://consultareceptores.feel.com.gt'
const TIEMPO_MAXIMO_MS = 30_000

interface RespuestaInfile {
    resultado?: boolean
    fecha?: string
    descripcion?: string
    cantidad_errores?: number
    descripcion_errores?: Array<{ mensaje_error?: string; validacion?: string; fuente?: string }>
    uuid?: string
    serie?: string
    numero?: string | number
    xml_certificado?: string
    archivo?: string
    [clave: string]: unknown
}

function requeridas(cred: CredencialesFel, campos: string[]): string | null {
    const faltan = campos.filter((c) => !cred[c])
    return faltan.length ? `Faltan credenciales: ${faltan.join(', ')}` : null
}

/** Copia de la respuesta sin el XML (va aparte) para la bitácora `fiscal.dte_intentos`. */
function paraBitacora(r: RespuestaInfile): Record<string, unknown> {
    const resto = { ...r }
    delete resto.xml_certificado
    delete resto.archivo
    return resto
}

function errores(r: RespuestaInfile): string[] {
    const lista = (r.descripcion_errores ?? []).map((e) =>
        [e.fuente, e.validacion, e.mensaje_error].filter(Boolean).join(' · '),
    )
    return lista.length ? lista : [r.descripcion ?? 'Rechazado por el certificador']
}

async function enviar(
    url: string,
    init: { cabeceras: Record<string, string>; cuerpo: string },
): Promise<
    | { ok: true; datos: RespuestaInfile }
    | { ok: false; temporal: boolean; error: string; datos: RespuestaInfile }
> {
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
            return { ok: false, temporal: true, error: `HTTP ${respuesta.status}`, datos }
        }
        if (!respuesta.ok) return { ok: false, temporal: false, error: `HTTP ${respuesta.status}`, datos }
        return { ok: true, datos }
    } catch (error) {
        // red, DNS o tiempo agotado: se reintenta (y antes se consulta por identificador)
        return { ok: false, temporal: true, error: (error as Error).name || 'error de red', datos: {} }
    }
}

export class ProveedorFelInfile implements ProveedorFel {
    readonly codigo = 'infile'
    readonly capacidades = { contingencia: false, consultaNit: true, pdf: false }

    private cabeceras(cred: CredencialesFel, identificador: string): Record<string, string> {
        return {
            UsuarioFirma: cred.usuario_firma!,
            LlaveFirma: cred.llave_firma!,
            UsuarioApi: cred.usuario_api!,
            LlaveApi: cred.llave_api!,
            identificador: identificador,
            'Content-Type': 'application/xml',
        }
    }

    async probarCredenciales(cred: CredencialesFel, _ambiente: AmbienteFel): Promise<ResultadoPrueba> {
        const falta = requeridas(cred, ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'])
        if (falta) return { ok: false, detalle: falta }
        // la consulta de NIT del propio emisor valida usuario y llave del API sin certificar nada
        const r = await enviar(`${RECEPTORES}/rest/action`, {
            cabeceras: { 'Content-Type': 'application/json' },
            cuerpo: JSON.stringify({
                emisor_codigo: cred.usuario_api,
                emisor_clave: cred.llave_api,
                nit_consulta: cred.usuario_api,
            }),
        })
        if (!r.ok) return { ok: false, detalle: `INFILE no aceptó las credenciales (${r.error})` }
        return { ok: true, detalle: 'INFILE respondió con las credenciales del API' }
    }

    async certificar(dte: DteParaEnviar, cred: CredencialesFel): Promise<ResultadoCertificacion> {
        const falta = requeridas(cred, ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'])
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
        return {
            resultado: 'certificado',
            autorizacion: String(d.uuid),
            serie: d.serie ? String(d.serie) : null,
            numero: d.numero !== undefined ? String(d.numero) : null,
            fecha: d.fecha ? new Date(d.fecha) : new Date(),
            xml: d.xml_certificado ? Buffer.from(d.xml_certificado, 'base64').toString('utf8') : xmlDte(dte),
            pdf: null,
            respuesta: paraBitacora(d),
        }
    }

    async anular(dte: DteCertificado, motivo: string, cred: CredencialesFel): Promise<ResultadoAnulacion> {
        const falta = requeridas(cred, ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'])
        if (falta) return { resultado: 'rechazado', errores: [falta], respuesta: {} }
        const fecha = new Date()
        const xml = xmlAnulacion(dte, motivo, fecha.toISOString())
        const firma = await enviar(`${FIRMADOR}/sign_solicitud_firmas/firma_xml`, {
            cabeceras: { 'Content-Type': 'application/json' },
            cuerpo: JSON.stringify({
                llave: cred.llave_firma,
                archivo: Buffer.from(xml, 'utf8').toString('base64'),
                codigo: dte.identificador,
                alias: cred.usuario_firma,
                es_anulacion: 'S',
            }),
        })
        if (!firma.ok || !firma.datos.archivo) {
            if (!firma.ok && firma.temporal) {
                return {
                    resultado: 'error_temporal',
                    error: firma.error,
                    respuesta: paraBitacora(firma.datos),
                }
            }
            return {
                resultado: 'rechazado',
                errores: errores(firma.datos),
                respuesta: paraBitacora(firma.datos),
            }
        }
        const r = await enviar(`${CERTIFICADOR}/fel/anulacion/v2/dte/`, {
            cabeceras: {
                ...this.cabeceras(cred, `${dte.identificador}-anulacion`),
                'Content-Type': 'application/json',
            },
            cuerpo: JSON.stringify({
                nit_emisor: dte.emisor_nit,
                correo_copia: cred.correo_copia ?? '',
                xml_dte: firma.datos.archivo,
            }),
        })
        if (!r.ok) {
            return r.temporal
                ? { resultado: 'error_temporal', error: r.error, respuesta: paraBitacora(r.datos) }
                : { resultado: 'rechazado', errores: errores(r.datos), respuesta: paraBitacora(r.datos) }
        }
        if (!r.datos.resultado) {
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
            numero: d.numero !== undefined ? String(d.numero) : null,
            fecha: d.fecha ? new Date(d.fecha) : new Date(),
            xml: d.xml_certificado ? Buffer.from(d.xml_certificado, 'base64').toString('utf8') : null,
            anulado: d.estado === 'Anulado' || d.anulado === true,
            respuesta: paraBitacora(d),
        }
    }

    async consultarNit(nit: string, cred: CredencialesFel): Promise<{ nombre: string } | null> {
        const r = await enviar(`${RECEPTORES}/rest/action`, {
            cabeceras: { 'Content-Type': 'application/json' },
            cuerpo: JSON.stringify({
                emisor_codigo: cred.usuario_api,
                emisor_clave: cred.llave_api,
                nit_consulta: nit,
            }),
        })
        if (!r.ok) return null
        const nombre = typeof r.datos.nombre === 'string' ? r.datos.nombre : null
        return nombre ? { nombre } : null
    }
}
