import type { Schema } from '@argosisp/contracts'
import type { Estrategia, EstrategiasRouter, MatrizControlVelocidad } from '../../app/types/controlVelocidad'
import { PADRES } from '../../app/types/controlVelocidad'

/**
 * Datos del control de velocidad por capas (`contratos/control-velocidad.md`): las estrategias de la
 * migración (§6), la matriz (§3) y la siembra de los routers. Sin `bd`: lo importa `bd.ts`.
 */

const TODOS = { rafaga: true, prioridad: true, garantizado: true, excluir_fasttrack: true }

export const ESTRATEGIA_SIMPLE: EstrategiasRouter = {
    pppoe: { aplicacion: 'radius_rate_limit', padre: 'por_plan', tipo_cola: 'default', extras: { ...TODOS } },
    ip_estatica: { aplicacion: 'cola_simple', padre: 'por_plan', tipo_cola: 'default', extras: { ...TODOS } },
    dhcp_fija: { aplicacion: 'cola_simple', padre: 'por_plan', tipo_cola: 'default', extras: { ...TODOS } },
}

const ARBOL: Estrategia = { aplicacion: 'arbol_pcq', padre: 'jerarquico', tipo_cola: 'pcq', extras: { ...TODOS, rafaga: false } }
export const ESTRATEGIA_ARBOL: EstrategiasRouter = { pppoe: { ...ARBOL }, ip_estatica: { ...ARBOL }, dhcp_fija: { ...ARBOL } }

export const MATRIZ: MatrizControlVelocidad = {
    aplicaciones: [
        { valor: 'radius_rate_limit', familia: 'simples', tipos_conexion: ['pppoe'], tipos_cola: ['default', 'sfq', 'fq_codel', 'cake'] },
        { valor: 'perfil_ppp', familia: 'simples', tipos_conexion: ['pppoe'], tipos_cola: ['default', 'sfq', 'fq_codel', 'cake'] },
        { valor: 'cola_simple', familia: 'simples', tipos_conexion: ['ip_estatica', 'dhcp_fija'], tipos_cola: ['default', 'sfq', 'fq_codel', 'cake'] },
        { valor: 'pcq_plan', familia: 'simples', tipos_conexion: ['pppoe', 'ip_estatica', 'dhcp_fija'], tipos_cola: ['pcq'] },
        { valor: 'arbol_pcq', familia: 'arbol', tipos_conexion: ['pppoe', 'ip_estatica', 'dhcp_fija'], tipos_cola: ['pcq'] },
    ],
    tipos_cola: [
        { valor: 'default', routeros_minimo: null },
        { valor: 'sfq', routeros_minimo: null },
        { valor: 'fq_codel', routeros_minimo: 7 },
        { valor: 'cake', routeros_minimo: 7 },
        { valor: 'pcq', routeros_minimo: null },
    ],
    padres: PADRES.map(valor => ({ valor })),
    reglas: [
        { rule: 'aplicacion_tipo', mensaje: 'La aplicación no sirve para ese tipo de conexión' },
        { rule: 'tipo_cola', mensaje: 'El tipo de cola no combina con la aplicación' },
        { rule: 'version', mensaje: 'El tipo de cola necesita RouterOS 7' },
        { rule: 'familia_router', mensaje: 'El techo del router se partiría entre colas simples y queue tree' },
        { rule: 'enum', mensaje: 'Valor desconocido' },
    ],
}

/** Estrategia y versión de RouterOS de cada router de los fixtures (`Router.estrategia_velocidad`, `routeros_version`). */
export function sembrarEstrategias(routers: Schema<'Router'>[]): void {
    const versiones: Record<number, string | null> = { 1: '7.24.5 (stable)', 2: '6.49.10 (long-term)', 3: null }
    for (const router of routers) {
        const control = router.control_velocidad ?? 'simple'
        Object.assign(router, { estrategia_velocidad: structuredClone(control === 'arbol_pcq' ? ESTRATEGIA_ARBOL : ESTRATEGIA_SIMPLE), routeros_version: versiones[router.id] ?? null })
    }
}
