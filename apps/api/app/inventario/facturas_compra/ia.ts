import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrar } from '#shared/cifrado'
import {
    extraccionValidator,
    type Confianza,
    type ExtraccionCompra,
} from '#inventario/facturas_compra/extraccion'
import { textoDePdf } from '#inventario/facturas_compra/pdf_texto'

/**
 * Lectura de una factura de compra en PDF o imagen con IA (fase D, `contratos/inventario.md` D.5;
 * decisión del PM: proveedor configurable). Una interfaz única (`ExtractorFactura`) con un adaptador
 * por proveedor, llamados con `fetch` directo (sin SDK ni dependencias):
 *
 * - `anthropic`: `POST <url_base o https://api.anthropic.com>/v1/messages` con `x-api-key` y
 *   `anthropic-version: 2023-06-01`; el PDF va como bloque `document` y la imagen como `image` (base64).
 * - `openai`, `deepseek` y `privada` (compatible con OpenAI: Ollama, vLLM…): `POST <url_base>/chat/completions`
 *   con `Authorization: Bearer`; la imagen va como `image_url` (data URL) y el PDF como su texto
 *   (`#inventario/facturas_compra/pdf_texto`). DeepSeek no lee imágenes.
 *
 * La respuesta debe ser solo JSON con el esquema de `ExtraccionCompra` más `confianza`; se valida con
 * el mismo validador que el borrador. Cualquier falla es un `ErrorIa` con un código visible
 * (`ia_no_configurada`, `ia_fallo`) y el usuario captura a mano. En pruebas (`NODE_ENV=test`) se puede
 * registrar un extractor falso: CI nunca llama a una API real.
 */

export const PROVEEDORES_IA = ['privada', 'anthropic', 'deepseek', 'openai'] as const
export type ProveedorIa = (typeof PROVEEDORES_IA)[number]

const TIEMPO_MAXIMO_MS = 60_000

export interface ArchivoParaIa {
    contenido: Buffer
    tipo: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface ResultadoIa {
    datos: ExtraccionCompra
    confianza: Confianza
}

export interface ExtractorFactura {
    readonly proveedor: string
    readonly modelo: string
    extraer(archivo: ArchivoParaIa): Promise<ResultadoIa>
}

/** Falla visible de la IA: el borrador queda vacío con este error y se captura a mano. */
export class ErrorIa extends Error {
    constructor(
        readonly codigo: 'ia_no_configurada' | 'ia_fallo',
        detalle: string,
    ) {
        super(detalle)
    }
}

export interface ConfiguracionIa {
    id: number
    empresa_id: number | null
    proveedor: ProveedorIa
    modelo: string
    url_base: string | null
    activo: boolean
    clave_configurada: boolean
    version: number
    created_at: Date
    updated_at: Date
}

/** La configuración de la empresa o, si no tiene, la global (sin la clave). */
export async function configuracionIa(
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<(ConfiguracionIa & { api_key_cifrada: string | null }) | null> {
    const fila = (await cliente
        .from('inventario.ia_configuracion')
        .where((q) => {
            if (empresaId !== null) q.where('empresa_id', empresaId).orWhereNull('empresa_id')
            else q.whereNull('empresa_id')
        })
        .orderByRaw('empresa_id IS NULL')
        .select('*')
        .first()) as (ConfiguracionIa & { api_key_cifrada: string | null }) | null
    if (!fila) return null
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
        version: Number(fila.version),
        clave_configurada: fila.api_key_cifrada !== null,
    }
}

/** Vista pública de la configuración (sin la clave). */
export function vistaConfiguracionIa(
    c: ConfiguracionIa & { api_key_cifrada?: string | null },
): ConfiguracionIa {
    const { api_key_cifrada: clave, ...resto } = c
    return { ...resto, clave_configurada: Boolean(clave) || c.clave_configurada }
}

const INSTRUCCIONES = `Eres un lector de facturas de compra de Guatemala. Devuelve SOLO un objeto JSON, sin texto alrededor ni bloques de código, con esta forma exacta:
{"emisor":{"nit":"","nombre":""},"receptor":{"nit":null,"nombre":null},"tipo_documento":"FACT","serie":null,"numero":"","autorizacion":null,"fecha":"AAAA-MM-DD","moneda":"GTQ","lineas":[{"codigo":null,"descripcion":"","cantidad":"1","unidad":null,"precio_unitario":"0.00","descuento":"0.00","total":"0.00","iva":"0.00","bien_o_servicio":"B"}],"totales":{"total":"0.00","iva":"0.00"},"confianza":{"emisor":0.0,"numero":0.0,"fecha":0.0,"totales":0.0,"lineas":[{"descripcion":0.0,"cantidad":0.0,"total":0.00}]}}
Reglas: montos como texto con 2 decimales y punto decimal; cantidad como texto; "total" de la línea con IVA incluido (precio_unitario × cantidad − descuento); NIT sin guiones; tipo_documento según la SAT (FACT, FCAM, FPEQ, FCAP, FESP, NCRE, NDEB) o RECIBO; bien_o_servicio "B" o "S"; codigo es el código del producto del proveedor si aparece; usa null cuando un dato no aparece; "confianza" entre 0 y 1 por campo y por línea. No inventes datos.`

/** Saca el JSON de la respuesta (con o sin bloque de código) y lo valida con el esquema común. */
export async function interpretarRespuesta(texto: string): Promise<ResultadoIa> {
    const limpio = texto
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    const inicio = limpio.indexOf('{')
    const fin = limpio.lastIndexOf('}')
    if (inicio === -1 || fin <= inicio) {
        throw new ErrorIa('ia_fallo', 'respuesta_invalida: la IA no devolvió JSON')
    }
    let bruto: Record<string, unknown>
    try {
        bruto = JSON.parse(limpio.slice(inicio, fin + 1)) as Record<string, unknown>
    } catch {
        throw new ErrorIa('ia_fallo', 'respuesta_invalida: JSON mal formado')
    }
    const { confianza, ...datos } = bruto
    try {
        const validado = (await extraccionValidator.validate(datos)) as ExtraccionCompra
        return { datos: validado, confianza: (confianza ?? {}) as Confianza }
    } catch (error) {
        const mensajes = (error as { messages?: Array<{ field: string; message: string }> }).messages ?? []
        throw new ErrorIa(
            'ia_fallo',
            `respuesta_invalida: ${mensajes
                .slice(0, 5)
                .map((m) => `${m.field} ${m.message}`)
                .join('; ')}`,
        )
    }
}

async function postJson(url: string, headers: Record<string, string>, cuerpo: unknown): Promise<unknown> {
    let respuesta: Response
    try {
        respuesta = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
    } catch (error) {
        throw new ErrorIa('ia_fallo', `sin respuesta del proveedor: ${(error as Error).name}`)
    }
    if (!respuesta.ok) {
        // sin el cuerpo: podría repetir partes de la factura o de la clave en los logs
        throw new ErrorIa('ia_fallo', `el proveedor respondió ${respuesta.status}`)
    }
    try {
        return await respuesta.json()
    } catch {
        throw new ErrorIa('ia_fallo', 'respuesta del proveedor que no es JSON')
    }
}

class ExtractorAnthropic implements ExtractorFactura {
    readonly proveedor = 'anthropic'

    constructor(
        readonly modelo: string,
        private readonly clave: string,
        private readonly urlBase: string,
    ) {}

    async extraer(archivo: ArchivoParaIa): Promise<ResultadoIa> {
        const datos = archivo.contenido.toString('base64')
        const bloque =
            archivo.tipo === 'application/pdf'
                ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: datos } }
                : { type: 'image', source: { type: 'base64', media_type: archivo.tipo, data: datos } }
        const respuesta = (await postJson(
            `${this.urlBase.replace(/\/$/, '')}/v1/messages`,
            { 'x-api-key': this.clave, 'anthropic-version': '2023-06-01' },
            {
                model: this.modelo,
                max_tokens: 16000,
                system: INSTRUCCIONES,
                messages: [{ role: 'user', content: [bloque, { type: 'text', text: 'Lee esta factura.' }] }],
            },
        )) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> }
        if (respuesta.stop_reason === 'refusal') {
            throw new ErrorIa('ia_fallo', 'el modelo se negó a leer el archivo')
        }
        const texto = (respuesta.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('')
        return interpretarRespuesta(texto)
    }
}

class ExtractorCompatibleOpenAi implements ExtractorFactura {
    constructor(
        readonly proveedor: string,
        readonly modelo: string,
        private readonly clave: string | null,
        private readonly urlBase: string,
        private readonly leeImagenes: boolean,
    ) {}

    async extraer(archivo: ArchivoParaIa): Promise<ResultadoIa> {
        let contenido: unknown
        if (archivo.tipo === 'application/pdf') {
            const texto = textoDePdf(archivo.contenido)
            if (texto.length < 20) {
                throw new ErrorIa(
                    'ia_fallo',
                    'pdf_sin_texto: el PDF no tiene texto (¿escaneado?); sube la imagen',
                )
            }
            contenido = `Lee esta factura (texto extraído del PDF):\n\n${texto}`
        } else {
            if (!this.leeImagenes) {
                throw new ErrorIa(
                    'ia_fallo',
                    `${this.proveedor} no lee imágenes: usa otro proveedor o sube el XML o el PDF`,
                )
            }
            contenido = [
                { type: 'text', text: 'Lee esta factura.' },
                {
                    type: 'image_url',
                    image_url: { url: `data:${archivo.tipo};base64,${archivo.contenido.toString('base64')}` },
                },
            ]
        }
        const respuesta = (await postJson(
            `${this.urlBase.replace(/\/$/, '')}/chat/completions`,
            this.clave ? { authorization: `Bearer ${this.clave}` } : {},
            {
                model: this.modelo,
                messages: [
                    { role: 'system', content: INSTRUCCIONES },
                    { role: 'user', content: contenido },
                ],
                response_format: { type: 'json_object' },
            },
        )) as { choices?: Array<{ message?: { content?: string } }> }
        return interpretarRespuesta(respuesta.choices?.[0]?.message?.content ?? '')
    }
}

let extractorDePrueba: ExtractorFactura | null = null

/** Solo en pruebas (`NODE_ENV=test`): reemplaza al proveedor real por uno falso (null lo quita). */
export function registrarExtractorDePrueba(extractor: ExtractorFactura | null): void {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error('El extractor de prueba solo existe en NODE_ENV=test')
    }
    extractorDePrueba = extractor
}

/** El extractor de la empresa (o el global); `ErrorIa` `ia_no_configurada` si no hay uno activo. */
export async function extractorDe(
    empresaId: number,
    cliente?: QueryClientContract,
): Promise<ExtractorFactura> {
    const config = await configuracionIa(empresaId, cliente)
    if (!config || !config.activo) {
        throw new ErrorIa('ia_no_configurada', 'No hay un proveedor de IA configurado para leer facturas')
    }
    if (extractorDePrueba && process.env.NODE_ENV === 'test') return extractorDePrueba
    let clave: string | null = null
    if (config.api_key_cifrada) {
        try {
            clave = descifrar(config.api_key_cifrada)
        } catch {
            throw new ErrorIa(
                'ia_no_configurada',
                'La clave de la IA no se pudo descifrar: vuelve a guardarla',
            )
        }
    }
    switch (config.proveedor) {
        case 'anthropic':
            if (!clave) throw new ErrorIa('ia_no_configurada', 'Falta la clave API de Anthropic')
            return new ExtractorAnthropic(
                config.modelo,
                clave,
                config.url_base ?? 'https://api.anthropic.com',
            )
        case 'openai':
            if (!clave) throw new ErrorIa('ia_no_configurada', 'Falta la clave API de OpenAI')
            return new ExtractorCompatibleOpenAi(
                'openai',
                config.modelo,
                clave,
                config.url_base ?? 'https://api.openai.com/v1',
                true,
            )
        case 'deepseek':
            if (!clave) throw new ErrorIa('ia_no_configurada', 'Falta la clave API de DeepSeek')
            return new ExtractorCompatibleOpenAi(
                'deepseek',
                config.modelo,
                clave,
                config.url_base ?? 'https://api.deepseek.com/v1',
                false,
            )
        case 'privada':
            return new ExtractorCompatibleOpenAi('privada', config.modelo, clave, config.url_base!, true)
    }
}
