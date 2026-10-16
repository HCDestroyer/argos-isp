/**
 * `fetch` falso para el modo fixtures (`NUXT_PUBLIC_USE_FIXTURES=true`).
 *
 * Se pasa a `createApiClient({ fetch })`, así que el resto del panel usa el mismo cliente
 * tipado de `@argosisp/contracts` con o sin backend. Las rutas se declaran como
 * `'MÉTODO /api/v1/recurso/:id'` en `apps/web/fixtures/index.ts`.
 */

/** Origen ficticio: openapi-fetch necesita una URL absoluta para construir el `Request`. */
export const ORIGEN_FIXTURES = 'http://fixtures.argosisp.local'

export interface SolicitudFixture {
    metodo: string
    ruta: string
    params: Record<string, string>
    query: URLSearchParams
    headers: Headers
    /** Cuerpo JSON ya parseado, o `null` si no hay. */
    cuerpo: unknown
    /** Token Bearer recibido, o `null`. */
    token: string | null
}

export interface RespuestaFixture {
    status: number
    /** JSON, o `Uint8Array` para responder un archivo (p. ej. un PDF) tal cual. */
    cuerpo?: unknown
    /** Por defecto `application/json`, o `application/problem+json` si `status >= 400`. */
    contentType?: string
}

export type ManejadorFixture = (solicitud: SolicitudFixture) => RespuestaFixture | Promise<RespuestaFixture>

export type RutasFixture = Record<string, ManejadorFixture>

export interface OpcionesFetchFixtures {
    /** Latencia simulada en milisegundos (0 en pruebas). */
    demoraMs?: number
}

interface RutaCompilada {
    metodo: string
    segmentos: string[]
    manejador: ManejadorFixture
}

function compilarRutas(rutas: RutasFixture): RutaCompilada[] {
    return Object.entries(rutas).map(([clave, manejador]) => {
        const [metodo = '', patron = ''] = clave.trim().split(/\s+/)
        return { metodo: metodo.toUpperCase(), segmentos: patron.split('/').filter(Boolean), manejador }
    })
}

function coincidir(ruta: RutaCompilada, segmentos: string[]): Record<string, string> | null {
    if (ruta.segmentos.length !== segmentos.length) {
        return null
    }
    const params: Record<string, string> = {}
    for (const [indice, patron] of ruta.segmentos.entries()) {
        const valor = segmentos[indice] ?? ''
        if (patron.startsWith(':')) {
            params[patron.slice(1)] = decodeURIComponent(valor)
        }
        else if (patron !== valor) {
            return null
        }
    }
    return params
}

function responder({ status, cuerpo, contentType }: RespuestaFixture): Response {
    if (cuerpo === undefined || status === 204) {
        return new Response(null, { status })
    }
    // Archivos (PDF del aviso de cobro): el cuerpo va tal cual, con su `contentType`.
    if (cuerpo instanceof Uint8Array) {
        const bytes = new Uint8Array(cuerpo.byteLength)
        bytes.set(cuerpo)
        return new Response(bytes, { status, headers: { 'Content-Type': contentType ?? 'application/octet-stream' } })
    }
    const tipo = contentType ?? (status >= 400 ? 'application/problem+json' : 'application/json')
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': tipo } })
}

async function leerCuerpo(request: Request): Promise<unknown> {
    const texto = await request.text()
    if (!texto) {
        return null
    }
    try {
        return JSON.parse(texto) as unknown
    }
    catch {
        return texto
    }
}

export function crearFetchFixtures(rutas: RutasFixture, opciones: OpcionesFetchFixtures = {}): typeof fetch {
    const compiladas = compilarRutas(rutas)

    return async (entrada, init) => {
        const request = new Request(entrada, init)
        const url = new URL(request.url)
        const metodo = request.method.toUpperCase()
        const segmentos = url.pathname.split('/').filter(Boolean)

        if (opciones.demoraMs) {
            await new Promise(resolve => setTimeout(resolve, opciones.demoraMs))
        }

        for (const ruta of compiladas) {
            if (ruta.metodo !== metodo) {
                continue
            }
            const params = coincidir(ruta, segmentos)
            if (!params) {
                continue
            }
            const autorizacion = request.headers.get('Authorization')
            return responder(await ruta.manejador({
                metodo,
                ruta: url.pathname,
                params,
                query: url.searchParams,
                headers: request.headers,
                cuerpo: await leerCuerpo(request),
                token: autorizacion?.startsWith('Bearer ') ? autorizacion.slice(7) : null,
            }))
        }

        return responder({
            status: 501,
            cuerpo: {
                type: 'about:blank',
                title: 'Sin fixture',
                status: 501,
                detail: `No hay fixture para ${metodo} ${url.pathname}. Agrégalo en apps/web/fixtures/index.ts.`,
            },
        })
    }
}
