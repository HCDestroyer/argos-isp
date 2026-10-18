import { createHash } from 'node:crypto'
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
 * Certificador falso (laboratorio y pruebas), como la pasarela falsa: certifica en memoria con una
 * autorización determinista por `identificador` y es idempotente como uno real (el mismo
 * identificador devuelve la misma autorización). Las pruebas guían su respuesta con `controlFelFalso`:
 *
 *  - `siguiente`: cola de respuestas para las próximas certificaciones o anulaciones
 *    (`rechazado`, `error_temporal`, o `caida`: certifica y responde error, como un tiempo agotado
 *    después de que el certificador sí registró el DTE).
 *  - `llamadas`: cuántas veces se llamó cada operación (para comprobar que no se duplica).
 *
 * Credenciales: `usuario` y `llave`; `llave = 'invalida'` falla la prueba de credenciales.
 */

type Respuesta = 'certificado' | 'rechazado' | 'error_temporal' | 'caida'

interface Registro {
    autorizacion: string
    serie: string
    numero: string
    fecha: Date
    xml: string
    anulado: boolean
}

export const controlFelFalso = {
    siguiente: [] as Respuesta[],
    errores: ['Error de validación de la SAT (simulado)'],
    llamadas: { certificar: 0, anular: 0, consultar: 0, probar: 0 },
    registros: new Map<string, Registro>(),
    nits: new Map<string, string>(),
    reiniciar() {
        this.siguiente = []
        this.llamadas = { certificar: 0, anular: 0, consultar: 0, probar: 0 }
        this.registros.clear()
        this.nits.clear()
    },
}

function autorizacionDe(identificador: string) {
    const h = createHash('sha256').update(`falso:${identificador}`).digest('hex').toUpperCase()
    return {
        autorizacion: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`,
        serie: h.slice(0, 8),
        numero: String(Number.parseInt(h.slice(8, 16), 16)),
    }
}

export class ProveedorFelFalso implements ProveedorFel {
    readonly codigo = 'falso'
    readonly capacidades = { contingencia: true, consultaNit: true, pdf: false }

    async probarCredenciales(cred: CredencialesFel, _ambiente: AmbienteFel): Promise<ResultadoPrueba> {
        controlFelFalso.llamadas.probar += 1
        if (!cred.usuario || !cred.llave) return { ok: false, detalle: 'Faltan usuario o llave' }
        if (cred.llave === 'invalida') return { ok: false, detalle: 'Credenciales rechazadas (simulado)' }
        return { ok: true, detalle: 'Credenciales válidas (proveedor falso)' }
    }

    async certificar(dte: DteParaEnviar): Promise<ResultadoCertificacion> {
        controlFelFalso.llamadas.certificar += 1
        const respuesta = controlFelFalso.siguiente.shift() ?? 'certificado'
        if (respuesta === 'rechazado') {
            return {
                resultado: 'rechazado',
                errores: [...controlFelFalso.errores],
                respuesta: { resultado: false, descripcion_errores: controlFelFalso.errores },
            }
        }
        if (respuesta === 'error_temporal') {
            return {
                resultado: 'error_temporal',
                error: 'Tiempo agotado (simulado)',
                respuesta: { simulado: true },
            }
        }
        const existente = controlFelFalso.registros.get(dte.identificador)
        const registro =
            existente ??
            ({
                ...autorizacionDe(dte.identificador),
                fecha: new Date(),
                xml: xmlDte(dte).replace(
                    '</dte:GTDocumento>',
                    '<ds:Signature>falsa</ds:Signature></dte:GTDocumento>',
                ),
                anulado: false,
            } satisfies Registro)
        controlFelFalso.registros.set(dte.identificador, registro)
        if (respuesta === 'caida') {
            return {
                resultado: 'error_temporal',
                error: 'Conexión cortada tras enviar (simulado)',
                respuesta: {},
            }
        }
        return {
            resultado: 'certificado',
            autorizacion: registro.autorizacion,
            serie: registro.serie,
            numero: registro.numero,
            fecha: registro.fecha,
            xml: registro.xml,
            pdf: null,
            respuesta: { resultado: true, uuid: registro.autorizacion, repetido: Boolean(existente) },
        }
    }

    async anular(dte: DteCertificado, motivo: string): Promise<ResultadoAnulacion> {
        controlFelFalso.llamadas.anular += 1
        const respuesta = controlFelFalso.siguiente.shift() ?? 'certificado'
        if (respuesta === 'rechazado') {
            return { resultado: 'rechazado', errores: [...controlFelFalso.errores], respuesta: {} }
        }
        if (respuesta === 'error_temporal') {
            return { resultado: 'error_temporal', error: 'Tiempo agotado (simulado)', respuesta: {} }
        }
        const registro = controlFelFalso.registros.get(dte.identificador)
        if (registro) registro.anulado = true
        const fecha = new Date()
        return {
            resultado: 'anulado',
            fecha,
            xml: xmlAnulacion(dte, motivo, fecha.toISOString()),
            respuesta: { resultado: true },
        }
    }

    async consultar(identificador: string): Promise<ResultadoConsulta> {
        controlFelFalso.llamadas.consultar += 1
        const registro = controlFelFalso.registros.get(identificador)
        if (!registro) return { encontrado: false, respuesta: {} }
        return {
            encontrado: true,
            autorizacion: registro.autorizacion,
            serie: registro.serie,
            numero: registro.numero,
            fecha: registro.fecha,
            xml: registro.xml,
            anulado: registro.anulado,
            respuesta: { resultado: true },
        }
    }

    async consultarNit(nit: string): Promise<{ nombre: string } | null> {
        const nombre = controlFelFalso.nits.get(nit)
        return nombre ? { nombre } : null
    }
}
