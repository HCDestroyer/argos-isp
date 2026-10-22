import type { Problem, Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Lista de verificación de cierre (A3, fase 6 PR B, contrato fiscal §10.5). Cada check automático
 * compara un `esperado` con un `obtenido`; su vigente es la última fila. Pasa si está `revisado` (en
 * orden) o `supervisado` (anomalía aceptada con nota); un aviso nunca bloquea. Cerrar el mes y el
 * bloqueo duro los verifican y exigen (422 `checks_pendientes`, un `errors[]` por clave).
 */

export type CheckCierre = Schema<'CheckCierre'>
export type ChecksCierre = Schema<'ChecksCierre'>
export type VerificacionCierre = Schema<'VerificacionCierre'>
export type TipoCheck = CheckCierre['tipo']
type Color = NonNullable<BadgeProps['color']>

export const ESTADOS_CHECK: Record<CheckCierre['estado'], { etiqueta: string, color: Color, icono: string }> = {
    revisado: { etiqueta: 'En orden', color: 'success', icono: 'i-lucide-circle-check' },
    anomalia: { etiqueta: 'Anomalía', color: 'error', icono: 'i-lucide-circle-x' },
    supervisado: { etiqueta: 'Supervisado', color: 'warning', icono: 'i-lucide-eye' },
}

/** Pasa el cierre: en orden o supervisado (como `checkPasa` de la API). */
export function checkPasa(check: Pick<CheckCierre, 'estado'>): boolean {
    return check.estado === 'revisado' || check.estado === 'supervisado'
}

/** Solo una anomalía sin supervisar se supervisa; un aviso nunca bloquea. */
export function puedeSupervisarse(check: Pick<CheckCierre, 'estado' | 'resultado' | 'aviso'>): boolean {
    return !check.aviso && check.resultado === 'anomalia' && check.estado === 'anomalia'
}

/** Un supervisado vuelve a anomalía con «Retirar supervisión». */
export function puedeRetirarse(check: Pick<CheckCierre, 'estado'>): boolean {
    return check.estado === 'supervisado'
}

/** Los datos del cálculo en una línea (`turnos: 7 · depositos: 2`), o `null` si no trae nada mostrable. */
export function detalleCheck(detalle: CheckCierre['detalle']): string | null {
    if (!detalle) {
        return null
    }
    const partes = Object.entries(detalle).flatMap(([clave, valor]) => {
        const nombre = clave.replaceAll('_', ' ')
        if (typeof valor === 'number' || typeof valor === 'string' || typeof valor === 'boolean') {
            return [`${nombre}: ${String(valor)}`]
        }
        if (Array.isArray(valor) && valor.every(v => typeof v === 'number' || typeof v === 'string')) {
            return valor.length ? [`${nombre}: ${valor.slice(0, 10).join(', ')}${valor.length > 10 ? '…' : ''}`] : []
        }
        return []
    })
    return partes.length ? partes.join(' · ') : null
}

/** Cuántos faltan para que el mes pase: anomalías sin supervisar y checks sin verificar. */
export function porResolver(lista: Pick<ChecksCierre, 'checks' | 'sin_verificar'>): number {
    return lista.checks.filter(c => !checkPasa(c)).length + lista.sin_verificar.length
}

/** `AAAA-MM` del mes (de `AAAA-MM` o `AAAA-MM-01`). */
export function mesDeCheck(periodo: string): string {
    return periodo.slice(0, 7)
}

/** Nota de la supervisión: obligatoria, como `motivo()` del validador de la API. */
export const esquemaNotaCheck = z.string().trim().min(3, 'La nota es obligatoria (mínimo 3 caracteres)').max(500, 'Hasta 500 caracteres')

export interface CheckPendiente {
    clave: string
    mensaje: string
}

/** Las filas de un 422 `checks_pendientes`: `field` = clave, `message` = título con esperado y obtenido. */
export function checksPendientesDe(problema: Problem | null): CheckPendiente[] {
    if (!problema || codigoProblema(problema) !== 'checks_pendientes') {
        return []
    }
    return (problema.errors ?? []).map(e => ({ clave: e.field, mensaje: e.message }))
}

/** El error de la API con un título que se entiende; el detalle de `checks_pendientes` queda en la lista. */
export function problemaCheckLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema)
    const legibles: Record<string, { title: string, detail?: string }> = {
        checks_pendientes: { title: 'Faltan checks del cierre', detail: 'Corrige la causa y vuelve a verificar, o supervisa la anomalía con una nota.' },
        check_desactualizado: { title: 'El check se volvió a verificar', detail: 'Su cálculo cambió desde que lo abriste. Revisa la fila vigente y vuelve a intentarlo.' },
        check_en_orden: { title: 'El check está en orden', detail: 'Solo una anomalía se supervisa.' },
        check_sin_cambio: { title: 'El check ya estaba así' },
    }
    const legible = codigo ? legibles[codigo] : undefined
    return legible ? { ...problema, title: legible.title, detail: legible.detail ?? problema.detail } : problema
}

/*
 * Última corrida de facturar y vencer por empresa (`GET /facturas/corridas`): lo que quedó pendiente por
 * un bloqueo, sin correr nada.
 */
export type CorridasFacturacion = Schema<'CorridasFacturacion'>
export type CorridaProceso = CorridasFacturacion['procesos'][number]

/** El proceso de la API (`facturas.generar`, `facturas.vencer_pendientes`) en la pantalla de bloqueos. */
export const PROCESO_DE_CORRIDA: Record<CorridaProceso['proceso'], ProcesoConBloqueo> = {
    'facturas.generar': 'facturar',
    'facturas.vencer_pendientes': 'vencer',
}

function numero(resultado: Record<string, unknown> | null, clave: string): number | null {
    const valor = resultado?.[clave]
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

/**
 * Lo que hizo la corrida en esa empresa, desde su `resultado` (solo de la empresa desde la fase 6 PR C);
 * `null` si no trae los conteos: una corrida vieja de varias empresas no los separa.
 */
export function resumenCorrida(corrida: Pick<CorridaProceso, 'proceso' | 'resultado'>): string | null {
    const r = corrida.resultado
    const errores = numero(r, 'errores')
    const conErrores = errores ? ` · ${errores} con error` : ''
    if (corrida.proceso === 'facturas.generar') {
        const generadas = numero(r, 'generadas')
        const omitidas = numero(r, 'omitidas')
        const bonificadas = numero(r, 'bonificadas')
        return generadas === null ? null : `${generadas} generadas${omitidas === null ? '' : ` · ${omitidas} ya tenían factura`}${bonificadas ? ` · ${bonificadas} bonificadas` : ''}${conErrores}`
    }
    const vencidas = numero(r, 'vencidas')
    const moras = numero(r, 'moras')
    return vencidas === null ? null : `${vencidas} vencidas${moras === null ? '' : ` · ${moras} moras`}${conErrores}`
}

/** Quién la corrió: el cron, o una persona desde el panel o la API. */
export function origenCorrida(corrida: Pick<CorridaProceso, 'actor_tipo' | 'canal'>): string {
    if (corrida.actor_tipo === 'sistema' || corrida.canal === 'cron') {
        return 'Automática'
    }
    const canal = corrida.canal === 'panel' ? 'desde el panel' : corrida.canal ? `por ${corrida.canal}` : ''
    const quien: Record<string, string> = { usuario: 'A mano', token: 'Con un token', agente: 'Un agente' }
    return [quien[corrida.actor_tipo ?? ''] ?? 'A mano', canal].filter(Boolean).join(' ')
}
