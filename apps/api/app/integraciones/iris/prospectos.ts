import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { configIris, conectorAdmite } from '#integraciones/iris/configuracion'
import { REINTENTOS_S } from '#integraciones/webhooks_salientes'
import { esIdempotenciaEnCursoIris } from '#notify/idempotencia_iris'

/**
 * Prospectos registrados desde Argos en Iris (contrato Iris 0.10.0 §3.6, A44). La acción
 * `prospectos.registrar` deja el pedido en la cola `integraciones.iris_prospectos`; aquí se entrega
 * (al momento, desde la ruta, y en `iris:worker`) y se lee.
 *
 * - `POST <iris>/api/v1/integraciones/argosisp/prospectos` con el token del conector,
 *   `X-Iris-Empresa`, `X-Iris-Actor: usuario:<id>` e `Idempotency-Key = argos:prospecto:<uuid>`. Cada
 *   reintento manda la misma clave y los mismos bytes.
 * - `201 { prospecto_id, numero, estado, asignado, url_iris }` → `enviado`. `409 prospecto_duplicado
 *   { url_iris }` → `duplicado` (Iris sumó el pedido como actividad del prospecto abierto). `422`
 *   (`plan_no_permitido`, `telefonos_invalidos`, `cliente_no_valido`) → `rechazado` con el código.
 * - Red, timeout, `5xx`, `429`, `409 idempotencia_en_proceso` y `409 argos_apagado` se reintentan a
 *   1 min, 5 min, 30 min, 2 h y 12 h; después `fallido`. Otro `4xx` → `fallido`.
 * - Con el conector apagado, sin URL o token, o con contrato < 0.10.0, sigue `pendiente` sin gastar
 *   intentos.
 * - Al terminar se borra `cuerpo` (datos personales): Argos guarda solo el vínculo.
 */

export const CONTRATO_PROSPECTOS = '0.10.0'

export type EntregaProspecto = 'pendiente' | 'enviado' | 'duplicado' | 'rechazado' | 'fallido'

export interface VistaProspectoIris {
    id: number
    empresa_id: number
    cliente_id: number | null
    registrado_por: number | null
    origen: string
    telefonos: number
    entrega: EntregaProspecto
    intentos: number
    ultimo_error: string | null
    /** código del error de Iris (`plan_no_permitido`, `telefonos_invalidos`…) */
    codigo_error: string | null
    prospecto_id: string | null
    numero: string | null
    estado_iris: string | null
    motivo_iris: string | null
    asignado: boolean | null
    /** enlace plano al prospecto en Iris (el autologin se pide al abrirlo) */
    url_iris: string | null
    enviado_en: string | null
    estado_cambiado_en: string | null
    created_at: string
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'cliente_id',
    'registrado_por',
    'origen',
    'telefonos',
    'entrega',
    'intentos',
    'ultimo_error',
    'codigo_error',
    'prospecto_id',
    'numero',
    'estado_iris',
    'motivo_iris',
    'asignado',
    'url_iris',
    'enviado_en',
    'estado_cambiado_en',
    'created_at',
]

function iso(v: unknown): string | null {
    return v ? new Date(v as string).toISOString() : null
}

function vista(f: Record<string, any>): VistaProspectoIris {
    return {
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        cliente_id: f.cliente_id === null ? null : Number(f.cliente_id),
        registrado_por: f.registrado_por === null ? null : Number(f.registrado_por),
        origen: f.origen,
        telefonos: Number(f.telefonos),
        entrega: f.entrega,
        intentos: Number(f.intentos),
        ultimo_error: f.ultimo_error,
        codigo_error: f.codigo_error,
        prospecto_id: f.prospecto_id,
        numero: f.numero,
        estado_iris: f.estado_iris,
        motivo_iris: f.motivo_iris,
        asignado: f.asignado,
        url_iris: f.url_iris,
        enviado_en: iso(f.enviado_en),
        estado_cambiado_en: iso(f.estado_cambiado_en),
        created_at: iso(f.created_at)!,
    }
}

export async function verProspectoIris(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaProspectoIris | null> {
    const fila = await cliente.from('integraciones.iris_prospectos').where('id', id).select(COLUMNAS).first()
    return fila ? vista(fila) : null
}

export async function listarProspectosIris(filtros: {
    empresas: number[] | null
    cliente_id?: number | null
    entrega?: EntregaProspecto | null
    cursor?: number | null
    limit?: number | null
}): Promise<{ data: VistaProspectoIris[]; nextCursor: string | null }> {
    const limite = Math.min(Math.max(filtros.limit ?? 50, 1), 200)
    const filas = await db
        .from('integraciones.iris_prospectos')
        .if(filtros.empresas !== null, (q) => q.whereIn('empresa_id', filtros.empresas!))
        .if(filtros.cliente_id, (q) => q.where('cliente_id', filtros.cliente_id!))
        .if(filtros.entrega, (q) => q.where('entrega', filtros.entrega!))
        .if(filtros.cursor, (q) => q.where('id', '<', filtros.cursor!))
        .orderBy('id', 'desc')
        .limit(limite + 1)
        .select(COLUMNAS)
    const data = filas.slice(0, limite).map(vista)
    return { data, nextCursor: filas.length > limite ? String(data[data.length - 1]!.id) : null }
}

/** ¿Se puede ofrecer «Registrar en Iris»? Conector activo, con URL y token, y contrato ≥ 0.10.0. */
export async function disponibilidadProspectos(): Promise<{ disponible: boolean; motivo: string | null }> {
    const config = await configIris()
    if (!config.activo || !config.urlBase || !config.token) {
        return { disponible: false, motivo: 'El conector con Iris está apagado o sin configurar' }
    }
    if (!(await conectorAdmite(CONTRATO_PROSPECTOS))) {
        return {
            disponible: false,
            motivo: 'El Iris conectado no admite prospectos desde Argos (contrato < 0.10.0)',
        }
    }
    return { disponible: true, motivo: null }
}

// ── Entrega ──────────────────────────────────────────────────────────────────────────────────

let fetchProspectos: typeof fetch = (...args) => fetch(...args)

/** `fetch` de la entrega (las pruebas lo reemplazan). */
export function fijarFetchProspectosIris(fn?: typeof fetch) {
    fetchProspectos = fn ?? ((...args) => fetch(...args))
}

export interface ResultadoEntregaProspectos {
    enviados: number
    duplicados: number
    rechazados: number
    reintentar: number
    fallidos: number
    en_espera: number
}

interface FilaPendiente {
    id: number
    idempotency_key: string
    empresa_id: number
    registrado_por: number | null
    cuerpo: string
    intentos: number
}

function codigoDe(crudo: string): string | null {
    try {
        const json = JSON.parse(crudo) as Record<string, unknown>
        const tipo = typeof json.type === 'string' ? json.type.split(':').pop() : null
        const codigo = typeof json.code === 'string' ? json.code : null
        return (codigo ?? tipo ?? null)?.slice(0, 80) ?? null
    } catch {
        return null
    }
}

function textoCorto(v: unknown, max = 500): string | null {
    return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : null
}

/** URL plana de Iris: solo `http(s)://`, sin credenciales ni fragmentos con tickets. */
function urlPlana(v: unknown): string | null {
    const t = textoCorto(v, 1000)
    if (!t) return null
    try {
        const u = new URL(t)
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null
        u.hash = ''
        return u.toString()
    } catch {
        return null
    }
}

/**
 * Entrega los prospectos pendientes que tocan ahora (o solo `soloId`, desde la ruta, en el momento).
 * Bucle de `node ace iris:worker`.
 */
export async function entregarProspectosIris(
    opciones: { limite?: number; ahora?: Date; soloId?: number } = {},
): Promise<ResultadoEntregaProspectos> {
    const r: ResultadoEntregaProspectos = {
        enviados: 0,
        duplicados: 0,
        rechazados: 0,
        reintentar: 0,
        fallidos: 0,
        en_espera: 0,
    }
    const ahora = opciones.ahora ?? new Date()
    const pendientes = (await db
        .from('integraciones.iris_prospectos')
        .where('entrega', 'pendiente')
        .if(opciones.soloId, (q) => q.where('id', opciones.soloId!))
        .if(!opciones.soloId, (q) => q.where('proximo_intento_en', '<=', ahora))
        .orderBy('id')
        .limit(opciones.limite ?? 50)
        .select(
            'id',
            'idempotency_key',
            'empresa_id',
            'registrado_por',
            'cuerpo',
            'intentos',
        )) as FilaPendiente[]
    if (pendientes.length === 0) return r

    const disponible = await disponibilidadProspectos()
    const config = await configIris()
    if (!disponible.disponible || !config.urlBase || !config.token) {
        r.en_espera = pendientes.length
        return r
    }
    const url = `${config.urlBase.replace(/\/+$/, '')}/api/v1/integraciones/argosisp/prospectos`

    for (const fila of pendientes) {
        const intentos = Number(fila.intentos)
        // Toma la fila: otra réplica (o la ruta y el worker a la vez) no la manda dos veces
        const tomada = await db
            .from('integraciones.iris_prospectos')
            .where('id', fila.id)
            .where('entrega', 'pendiente')
            .where('intentos', intentos)
            .update({ intentos: intentos + 1, updated_at: db.knexRawQuery('now()') })
        if (Number(tomada) === 0) continue
        const intento = intentos + 1
        let status: number | null = null
        let crudo = ''
        let error: string | null = null
        try {
            const respuesta = await fetchProspectos(url, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${config.token}`,
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'idempotency-key': fila.idempotency_key,
                    'x-iris-empresa': String(fila.empresa_id),
                    'x-iris-actor': `usuario:${fila.registrado_por ?? 0}`,
                },
                body: fila.cuerpo,
                signal: AbortSignal.timeout(10_000),
            })
            status = respuesta.status
            crudo = await respuesta.text()
        } catch (e) {
            error = `Iris no respondió: ${e instanceof Error ? e.message : String(e)}`
        }

        const codigo = status !== null ? codigoDe(crudo) : null
        let json: Record<string, unknown> = {}
        try {
            json = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {}
        } catch {
            json = {}
        }

        if (status !== null && status >= 200 && status < 300) {
            await cerrar(fila.id, 'enviado', status, null, null, {
                prospecto_id: textoCorto(json.prospecto_id, 200),
                numero: textoCorto(json.numero, 60),
                estado_iris: textoCorto(json.estado, 60),
                asignado: typeof json.asignado === 'boolean' ? json.asignado : null,
                url_iris: urlPlana(json.url_iris),
            })
            r.enviados++
            continue
        }
        if (status === 409 && codigo === 'prospecto_duplicado') {
            await cerrar(
                fila.id,
                'duplicado',
                status,
                'Ya hay un prospecto abierto con uno de esos números',
                codigo,
                {
                    url_iris: urlPlana(json.url_iris),
                },
            )
            r.duplicados++
            continue
        }
        const reintentable =
            status === null ||
            status >= 500 ||
            status === 429 ||
            esIdempotenciaEnCursoIris(status, crudo) ||
            (status === 409 && codigo === 'argos_apagado')
        if (status === 422) {
            await cerrar(fila.id, 'rechazado', status, `Iris ${status} ${crudo.slice(0, 300)}`, codigo, {})
            r.rechazados++
            continue
        }
        const espera = REINTENTOS_S[intento - 1]
        const mensaje = error ?? `Iris ${status} ${crudo.slice(0, 300)}`
        if (!reintentable || espera === undefined) {
            await cerrar(fila.id, 'fallido', status, mensaje, codigo, {})
            logger.warn({ prospecto: fila.id, status }, 'iris: prospecto no entregado')
            r.fallidos++
            continue
        }
        await db
            .from('integraciones.iris_prospectos')
            .where('id', fila.id)
            .update({
                ultimo_status: status,
                ultimo_error: mensaje.slice(0, 2000),
                codigo_error: codigo,
                proximo_intento_en: new Date(ahora.getTime() + espera * 1000),
                updated_at: db.knexRawQuery('now()'),
            })
        r.reintentar++
    }
    return r
}

/** Estado final: borra el cuerpo (datos personales) y deja solo el vínculo. */
async function cerrar(
    id: number,
    entrega: Exclude<EntregaProspecto, 'pendiente'>,
    status: number | null,
    error: string | null,
    codigo: string | null,
    vinculo: Partial<{
        prospecto_id: string | null
        numero: string | null
        estado_iris: string | null
        asignado: boolean | null
        url_iris: string | null
    }>,
) {
    await db
        .from('integraciones.iris_prospectos')
        .where('id', id)
        .update({
            entrega,
            cuerpo: null,
            ultimo_status: status,
            ultimo_error: error?.slice(0, 2000) ?? null,
            codigo_error: codigo,
            ...vinculo,
            enviado_en: entrega === 'enviado' || entrega === 'duplicado' ? db.knexRawQuery('now()') : null,
            updated_at: db.knexRawQuery('now()'),
        })
}

// ── Webhook `prospecto.estado_cambiado` (§6.6, 0.10.0) ───────────────────────────────────────

export interface CambioEstadoProspecto {
    encontrado: boolean
    cambio: boolean
    id: number | null
    empresa_id: number | null
    cliente_id: number | null
    antes: string | null
}

/**
 * Aplica el estado que informa Iris a los vínculos de ese prospecto (de la empresa del webhook). Un
 * webhook atrasado (`ocurrido` anterior al último aplicado) no cambia nada.
 */
export async function aplicarEstadoProspecto(
    trx: QueryClientContract,
    datos: {
        prospecto_id: string
        empresa_id: number | null
        a: string
        motivo: string | null
        ocurrido: string
    },
): Promise<CambioEstadoProspecto> {
    const fila = (await trx
        .from('integraciones.iris_prospectos')
        .where('prospecto_id', datos.prospecto_id)
        .if(datos.empresa_id !== null, (q) => q.where('empresa_id', datos.empresa_id!))
        .orderBy('id', 'desc')
        .forUpdate()
        .select('id', 'empresa_id', 'cliente_id', 'estado_iris', 'estado_cambiado_en')
        .first()) as {
        id: number
        empresa_id: number
        cliente_id: number | null
        estado_iris: string | null
        estado_cambiado_en: Date | null
    } | null
    if (!fila) {
        return { encontrado: false, cambio: false, id: null, empresa_id: null, cliente_id: null, antes: null }
    }
    const base = {
        encontrado: true,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        cliente_id: fila.cliente_id === null ? null : Number(fila.cliente_id),
        antes: fila.estado_iris,
    }
    if (fila.estado_cambiado_en && new Date(fila.estado_cambiado_en).getTime() > Date.parse(datos.ocurrido)) {
        return { ...base, cambio: false }
    }
    await trx
        .from('integraciones.iris_prospectos')
        .where('id', fila.id)
        .update({
            estado_iris: datos.a.slice(0, 60),
            motivo_iris: datos.motivo?.slice(0, 80) ?? null,
            estado_cambiado_en: datos.ocurrido,
            updated_at: trx.knexRawQuery('now()'),
        })
    return { ...base, cambio: fila.estado_iris !== datos.a }
}
