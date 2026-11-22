import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { contextoSistema, type ContextoAccion } from '#shared/contexto'
import { configIris } from '#integraciones/iris/configuracion'
import VerificarOperacionIris, {
    type ResultadoConsultaIris,
} from '#inventario/actions/verificar_operacion_iris'
import SincronizarVinculoTecnico from '#inventario/actions/sincronizar_vinculo_tecnico'
import type { MotivoVerificacion } from '#inventario/recuperacion'

/**
 * Lo que Argos le pregunta a Iris del inventario (contrato Iris 0.14.0 §3.10 y §6.6), siempre con el
 * `iris_pat_` del panel (nunca el `token_portal`):
 *
 * - `GET <iris>/api/v1/integraciones/argosisp/intentos-recuperacion/verificacion?empresa_id=&idempotency_key=`
 *   → `200 { verificado, motivo }` o `404` (`desconocido_en_iris`, sin reintento). `5xx`, timeouts,
 *   `401`/`403` y `429` (según `Retry-After`) se reintentan (`pendiente`).
 * - `GET <iris>/api/v1/integraciones/argosisp/tecnicos/:usuario_id?empresa_id=` → `{ tecnico_id, usuario_id,
 *   empresa_id, id_externo, version, activo }` para conciliar un vínculo; `404` si no salió de este conector.
 *
 * El worker (`iris:worker`, `verificarPendientes` y `reevaluarVinculos`) toma cada fila con una
 * actualización condicional sobre `proxima_en` / `reevaluar_en`: varias instancias a la vez nunca consultan
 * la misma (§14). Sin conector activo con URL y token, nada sale y la fila espera (`sin_conector`).
 */

export const RUTA_VERIFICACION_IRIS = '/api/v1/integraciones/argosisp/intentos-recuperacion/verificacion'
export const RUTA_TECNICO_IRIS = '/api/v1/integraciones/argosisp/tecnicos'

let fetchIris: typeof fetch = (...a) => fetch(...a)

/** Pruebas: un servidor falso de Iris (sin argumento, el `fetch` real). */
export function fijarFetchInventarioIris(fn?: typeof fetch): void {
    fetchIris = fn ?? ((...a) => fetch(...a))
}

const MOTIVOS_PENDIENTE_IRIS = ['envio_en_curso', 'foto_pendiente']
const MOTIVOS_NO_VERIFICADO_IRIS = ['no_enviado_por_iris', 'no_coincide', 'foto_invalida']

function retryAfter(valor: string | null): number | null {
    if (!valor) return null
    const n = Number(valor)
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
    const fecha = Date.parse(valor)
    return Number.isNaN(fecha) ? null : Math.max(1, Math.ceil((fecha - Date.now()) / 1000))
}

async function pedirIris(
    ruta: string,
): Promise<
    | { ok: true; status: number; json: Record<string, unknown> | null; retry: number | null }
    | { ok: false; motivo: 'sin_conector' | 'timeout' }
> {
    const config = await configIris()
    if (!config.activo || !config.urlBase || !config.token) return { ok: false, motivo: 'sin_conector' }
    try {
        const r = await fetchIris(`${config.urlBase.replace(/\/+$/, '')}${ruta}`, {
            method: 'GET',
            headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        })
        const texto = await r.text()
        let json: Record<string, unknown> | null = null
        try {
            json = texto ? (JSON.parse(texto) as Record<string, unknown>) : null
        } catch {
            json = null
        }
        return { ok: true, status: r.status, json, retry: retryAfter(r.headers.get('retry-after')) }
    } catch (error) {
        logger.warn(
            { err: error, ruta: ruta.split('?')[0] },
            'iris: no respondió a la consulta de inventario',
        )
        return { ok: false, motivo: 'timeout' }
    }
}

/** Consulta a Iris la verificación de una clave (sin tocar la base). */
export async function consultarVerificacion(
    empresaId: number,
    clave: string,
): Promise<ResultadoConsultaIris> {
    const q = new URLSearchParams({ empresa_id: String(empresaId), idempotency_key: clave })
    const r = await pedirIris(`${RUTA_VERIFICACION_IRIS}?${q.toString()}`)
    if (!r.ok) return { tipo: 'pendiente', motivo: r.motivo, status: null }
    if (r.status === 200 && r.json) {
        if (r.json.verificado === true) return { tipo: 'verificado', status: 200 }
        const motivo = typeof r.json.motivo === 'string' ? r.json.motivo : ''
        if (MOTIVOS_NO_VERIFICADO_IRIS.includes(motivo)) {
            return { tipo: 'no_verificado', motivo: motivo as MotivoVerificacion, status: 200 }
        }
        if (MOTIVOS_PENDIENTE_IRIS.includes(motivo)) {
            return { tipo: 'pendiente', motivo: motivo as MotivoVerificacion, status: 200 }
        }
        return { tipo: 'pendiente', motivo: 'respuesta_invalida', status: 200 }
    }
    if (r.status === 404) return { tipo: 'no_verificado', motivo: 'desconocido_en_iris', status: 404 }
    if (r.status === 401 || r.status === 403) {
        return { tipo: 'pendiente', motivo: 'sin_acceso', status: r.status }
    }
    if (r.status === 429) {
        return { tipo: 'pendiente', motivo: 'limitado', status: 429, reintentar_en_s: r.retry ?? 60 }
    }
    if (r.status >= 500) return { tipo: 'pendiente', motivo: 'error_iris', status: r.status }
    return { tipo: 'pendiente', motivo: 'respuesta_invalida', status: r.status }
}

/**
 * Verifica ahora una verificación `pendiente` (la consulta y la acción). Devuelve el resultado aplicado, o
 * null si ya no estaba pendiente.
 */
export async function verificarAhora(
    verificacionId: number,
    origen: 'worker' | 'pantalla' | 'cupo',
    ctx: ContextoAccion = contextoSistema('worker', `iris-verificar-${verificacionId}-${Date.now()}`),
): Promise<{ estado: string; motivo: string | null; reintentar_en_s: number | null } | null> {
    const fila = (await db
        .from('inventario.verificaciones_iris')
        .where({ id: verificacionId, estado: 'pendiente' })
        .select('id', 'empresa_id', 'idempotency_key')
        .first()) as { id: number; empresa_id: number; idempotency_key: string } | null
    if (!fila) return null
    const resultado = await consultarVerificacion(Number(fila.empresa_id), fila.idempotency_key)
    const salida = await new VerificarOperacionIris().execute(
        { verificacion_id: Number(fila.id), resultado, origen },
        ctx,
    )
    return {
        estado: salida.estado,
        motivo: salida.motivo,
        reintentar_en_s: resultado.tipo === 'pendiente' ? (resultado.reintentar_en_s ?? null) : null,
    }
}

/** Verificaciones pendientes cuyo reintento ya toca (worker con varias instancias). */
export async function verificarPendientes(
    opciones: { limite?: number } = {},
): Promise<{ consultadas: number; verificadas: number; no_verificadas: number; pendientes: number }> {
    const r = { consultadas: 0, verificadas: 0, no_verificadas: 0, pendientes: 0 }
    const filas = (await db
        .from('inventario.verificaciones_iris')
        .where('estado', 'pendiente')
        .whereNotNull('proxima_en')
        .whereRaw('proxima_en <= now()')
        .orderBy('proxima_en')
        .limit(opciones.limite ?? 50)
        .select('id', 'proxima_en')) as Array<{ id: number; proxima_en: Date }>
    for (const fila of filas) {
        // toma la fila: otra instancia (o la pantalla) no la consulta a la vez
        const tomada = await db
            .from('inventario.verificaciones_iris')
            .where({ id: fila.id, estado: 'pendiente' })
            // solo si todavía toca: la primera instancia la corre hacia adelante y las demás no la ven
            .whereRaw('proxima_en <= now()')
            .update({ proxima_en: db.knexRawQuery(`now() + interval '2 minutes'`) })
        if (Number(tomada) === 0) continue
        try {
            const salida = await verificarAhora(Number(fila.id), 'worker')
            r.consultadas++
            if (salida?.estado === 'verificado') r.verificadas++
            else if (salida?.estado === 'no_verificado') r.no_verificadas++
            else r.pendientes++
        } catch (error) {
            logger.error({ err: error, verificacion: fila.id }, 'inventario: falló la verificación con Iris')
        }
    }
    return r
}

/** Verifica otra vez los intentos pendientes de una unidad (al abrir la pantalla de declaración). */
export async function verificarIntentosDeUnidad(unidadId: number, ctx: ContextoAccion): Promise<number> {
    const filas = (await db
        .from('inventario.verificaciones_iris as v')
        .join('inventario.intentos_recuperacion as i', 'i.id', 'v.intento_id')
        .where('i.unidad_id', unidadId)
        .where('v.estado', 'pendiente')
        .select('v.id')) as Array<{ id: number }>
    for (const f of filas) await verificarAhora(Number(f.id), 'pantalla', ctx)
    return filas.length
}

// ── Vínculos de técnicos (§6.6) ──────────────────────────────────────────────────────────────

export type ResultadoConciliacion =
    | { tipo: 'aplicado'; estado: string | null; ignorado: string | null }
    | { tipo: 'no_encontrado' }
    | { tipo: 'error'; motivo: string }

/** Lee el técnico de Iris y lo aplica con las reglas del webhook (`activo: false` = desvinculado). */
export async function conciliarVinculo(
    empresaId: number,
    irisUsuarioId: string,
    ctx: ContextoAccion = contextoSistema('worker', `iris-vinculo-${irisUsuarioId}-${Date.now()}`),
): Promise<ResultadoConciliacion> {
    const q = new URLSearchParams({ empresa_id: String(empresaId) })
    const r = await pedirIris(`${RUTA_TECNICO_IRIS}/${encodeURIComponent(irisUsuarioId)}?${q.toString()}`)
    if (!r.ok) return { tipo: 'error', motivo: r.motivo }
    if (r.status === 404) return { tipo: 'no_encontrado' }
    if (r.status !== 200 || !r.json) return { tipo: 'error', motivo: `status_${r.status}` }
    const j = r.json
    const version = Number(j.version)
    if (
        String(j.usuario_id ?? '') !== irisUsuarioId ||
        Number(j.empresa_id) !== empresaId ||
        !Number.isSafeInteger(version)
    ) {
        return { tipo: 'error', motivo: 'respuesta_invalida' }
    }
    const salida = await new SincronizarVinculoTecnico().execute(
        {
            empresa_id: empresaId,
            usuario_id: irisUsuarioId,
            tecnico_id: (j.tecnico_id as string | number | null) ?? null,
            id_externo: (j.id_externo as string | number | null) ?? null,
            version,
            activo: j.activo === true && j.id_externo !== null && j.id_externo !== undefined,
            motivo: j.activo === true ? null : 'inactivo_en_iris',
            origen: 'conciliacion',
        },
        ctx,
    )
    return { tipo: 'aplicado', estado: salida.estado, ignorado: salida.ignorado }
}

/** Rechazados por unicidad cuyo `id_externo` se liberó (N-2): se concilian con Iris. */
export async function reevaluarVinculos(opciones: { limite?: number } = {}): Promise<number> {
    const filas = (await db
        .from('inventario.tecnicos_iris')
        .whereNotNull('reevaluar_en')
        .whereRaw('reevaluar_en <= now()')
        .orderBy('reevaluar_en')
        .limit(opciones.limite ?? 50)
        .select('id', 'empresa_id', 'iris_usuario_id', 'reevaluar_en')) as Array<{
        id: number
        empresa_id: number
        iris_usuario_id: string
        reevaluar_en: Date
    }>
    let n = 0
    for (const fila of filas) {
        const tomada = await db
            .from('inventario.tecnicos_iris')
            .where('id', fila.id)
            .whereRaw('reevaluar_en <= now()')
            .update({ reevaluar_en: db.knexRawQuery(`now() + interval '5 minutes'`) })
        if (Number(tomada) === 0) continue
        try {
            const r = await conciliarVinculo(Number(fila.empresa_id), fila.iris_usuario_id)
            if (r.tipo !== 'error') {
                // aplicado (la acción ya limpió la marca) o Iris ya no lo tiene: no se reevalúa más
                await db
                    .from('inventario.tecnicos_iris')
                    .where('id', fila.id)
                    .whereRaw(`reevaluar_en > now()`)
                    .update({ reevaluar_en: null })
            } else {
                await db
                    .from('inventario.tecnicos_iris')
                    .where('id', fila.id)
                    .update({ reevaluar_en: db.knexRawQuery(`now() + interval '30 minutes'`) })
            }
            n++
        } catch (error) {
            logger.error(
                { err: error, vinculo: fila.id },
                'inventario: falló la conciliación de un vínculo con Iris',
            )
        }
    }
    return n
}
