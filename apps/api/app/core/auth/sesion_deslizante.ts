/**
 * Expiración deslizante de la sesión del panel (cookie `argos_sesion`). Contrato:
 * `.claude/integration/contratos/sesion-panel.md` §4.
 *
 * - Cada petición con la cookie lleva el vencimiento a `ahora + inactividad`, sin pasar del tope
 *   absoluto `creada_en + máxima` (contado desde el login).
 * - Para no escribir en la base de datos en cada petición, solo se renueva cuando el vencimiento
 *   nuevo supera al guardado en al menos `umbral` = 10 % de la ventana de inactividad, entre 1 y
 *   15 min (con 12 h: 15 min). Así una sesión activa escribe como mucho 4 veces por hora, y lo
 *   más que pierde la ventana de inactividad es ese umbral (vence entre 11 h 45 min y 12 h después
 *   de la última petición).
 * - Funciones puras más un reloj sustituible (`relojSesion`) para probar sin esperar.
 *
 * Solo aplica a la cookie del panel. Los Bearer (login de API, agentes, aaa/coa, portal) no cambian.
 */

const HORA_MS = 3_600_000
const MINUTO_MS = 60_000

export const INACTIVIDAD_H_POR_DEFECTO = 12
export const MAXIMA_H_POR_DEFECTO = 72

/** Nombre con el que se guarda en `core.auth_access_tokens` un token de sesión del panel. */
export const NOMBRE_TOKEN_PANEL = 'sesion panel'

/** Reloj de la sesión: las pruebas lo sustituyen para avanzar el tiempo. */
export const relojSesion = {
    ahora: (): Date => new Date(),
}

export interface ConfigSesionPanel {
    inactividadMs: number
    maximaMs: number
    umbralMs: number
}

function horas(valor: string | undefined, porDefecto: number): number {
    const n = Number((valor ?? '').trim())
    return valor !== undefined && valor.trim() !== '' && Number.isFinite(n) && n > 0 ? n : porDefecto
}

/** `PANEL_SESION_INACTIVIDAD_H` (12) y `PANEL_SESION_MAXIMA_H` (72). La inactividad nunca supera el tope. */
export function configSesionPanel(entorno: NodeJS.ProcessEnv = process.env): ConfigSesionPanel {
    const maximaMs = horas(entorno.PANEL_SESION_MAXIMA_H, MAXIMA_H_POR_DEFECTO) * HORA_MS
    const inactividadMs = Math.min(
        horas(entorno.PANEL_SESION_INACTIVIDAD_H, INACTIVIDAD_H_POR_DEFECTO) * HORA_MS,
        maximaMs,
    )
    const umbralMs = Math.min(15 * MINUTO_MS, Math.max(MINUTO_MS, Math.floor(inactividadMs / 10)))
    return { inactividadMs, maximaMs, umbralMs }
}

export function topeDeSesion(creadaEn: Date, cfg: ConfigSesionPanel): Date {
    return new Date(creadaEn.getTime() + cfg.maximaMs)
}

export type Renovacion =
    | { estado: 'expirada' }
    | {
          estado: 'vigente'
          /** vencimiento efectivo tras esta petición */
          expiraEn: Date
          expiraMaxEn: Date
          /** true si hay que guardar `expiraEn` y volver a emitir la cookie */
          renovar: boolean
      }

/** Decide si la sesión sigue vigente y si toca renovarla en esta petición. */
export function decidirRenovacion(
    sesion: { creadaEn: Date; expiraEn: Date | null },
    ahora: Date,
    cfg: ConfigSesionPanel,
): Renovacion {
    const tope = topeDeSesion(sesion.creadaEn, cfg)
    const t = ahora.getTime()
    if (t >= tope.getTime()) return { estado: 'expirada' }
    if (sesion.expiraEn && t >= sesion.expiraEn.getTime()) return { estado: 'expirada' }

    const objetivo = new Date(Math.min(t + cfg.inactividadMs, tope.getTime()))
    const renovar =
        !sesion.expiraEn ||
        // el tope bajó por configuración: se acorta en vez de seguir con el vencimiento viejo
        sesion.expiraEn.getTime() > tope.getTime() ||
        objetivo.getTime() - sesion.expiraEn.getTime() >= cfg.umbralMs ||
        // última renovación: llega justo al tope aunque falten menos del umbral (una escritura más)
        (objetivo.getTime() === tope.getTime() && sesion.expiraEn.getTime() < tope.getTime())
    return {
        estado: 'vigente',
        expiraEn: renovar ? objetivo : sesion.expiraEn!,
        expiraMaxEn: tope,
        renovar,
    }
}
