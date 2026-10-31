import type { Schema } from '@argosisp/contracts'
import type { EstrategiasRouter, MatrizControlVelocidad } from '../../app/types/controlVelocidad'
import { APLICACIONES, EXTRAS, PADRES, TIPOS_COLA } from '../../app/types/controlVelocidad'

/**
 * Datos del control de velocidad por capas (`contratos/control-velocidad.md`), copiados de la API:
 * los atajos de la migración (`estrategiasDeControl`, §6) y la matriz (`matrizControlVelocidad`,
 * §3). Sin `bd`: lo importan `routers/datos.ts` y `bd.ts`.
 */

/** `EXTRAS_TODOS` de A2: todo encendido salvo `qos`, que se prende a propósito (`contratos/qos.md`). */
const TODOS: Schema<'EstrategiaVelocidad'>['extras'] = { rafaga: true, prioridad: true, garantizado: true, excluir_fasttrack: true, qos: false }

/** `estrategiasDeControl('simple')`: PPPoE por RADIUS y WISP con cola simple, padre por plan. */
export function estrategiaSimple(): EstrategiasRouter {
    return {
        pppoe: { aplicacion: 'radius_rate_limit', padre: 'por_plan', tipo_cola: 'default', extras: { ...TODOS } },
        ip_estatica: { aplicacion: 'cola_simple', padre: 'por_plan', tipo_cola: 'default', extras: { ...TODOS } },
        dhcp_fija: { aplicacion: 'cola_simple', padre: 'por_plan', tipo_cola: 'default', extras: { ...TODOS } },
    }
}

/** `estrategiasDeControl('arbol_pcq')`: árbol global → plan → PCQ, sin ráfaga. */
export function estrategiaArbol(): EstrategiasRouter {
    const arbol = (): Schema<'EstrategiaVelocidad'> => ({ aplicacion: 'arbol_pcq', padre: 'jerarquico', tipo_cola: 'pcq', extras: { ...TODOS, rafaga: false } })
    return { pppoe: arbol(), ip_estatica: arbol(), dhcp_fija: arbol() }
}

/** Atajo de un `control_velocidad` (alta de router, `cambiar-control-velocidad`). */
export function estrategiaDeControl(control: 'simple' | 'arbol_pcq'): EstrategiasRouter {
    return control === 'arbol_pcq' ? estrategiaArbol() : estrategiaSimple()
}

/** `QOS_MAX_HOJAS` de A2 (`contratos/qos.md` §3.4). */
export const QOS_MAX_HOJAS = 1024

const TIPOS_POR_APLICACION: MatrizControlVelocidad['aplicaciones'][number]['tipos_conexion'][] = [
    ['pppoe'],
    ['pppoe'],
    ['ip_estatica', 'dhcp_fija'],
    ['pppoe', 'ip_estatica', 'dhcp_fija'],
    ['pppoe', 'ip_estatica', 'dhcp_fija'],
]

/** `GET /red/control-velocidad/matriz`, igual que `matrizControlVelocidad()` de A2. */
export const MATRIZ: MatrizControlVelocidad = {
    aplicaciones: APLICACIONES.map((valor, indice) => ({
        valor,
        familia: valor === 'arbol_pcq' ? 'arbol' : 'simple',
        tipos_conexion: [...(TIPOS_POR_APLICACION[indice] ?? [])],
        tipos_cola: valor === 'pcq_plan' || valor === 'arbol_pcq' ? ['pcq'] : TIPOS_COLA.filter(t => t !== 'pcq'),
        coa_en_vivo: valor === 'radius_rate_limit' || valor === 'perfil_ppp',
    })),
    tipos_cola: TIPOS_COLA.map(valor => ({ valor, routeros_minimo: valor === 'fq_codel' || valor === 'cake' ? '7' : null })),
    padres: PADRES.map(valor => ({ valor })),
    extras: EXTRAS.map(valor => ({ valor, por_defecto: TODOS[valor] })),
    reglas: [
        { rule: 'aplicacion_tipo', mensaje: 'radius_rate_limit y perfil_ppp solo en PPPoE; cola_simple solo en IP estática y DHCP fija' },
        { rule: 'tipo_cola', mensaje: 'pcq_plan y arbol_pcq exigen pcq; las demás no aceptan pcq' },
        { rule: 'version', mensaje: 'fq_codel y cake solo con RouterOS 7' },
        { rule: 'familia_router', mensaje: 'por_router y jerarquico en una sola familia (colas simples o queue tree) en todo el router' },
        { rule: 'plan_consistente', mensaje: 'en un plan, los tipos que comparten la cola del plan usan el mismo padre y los mismos extras' },
        { rule: 'familia_plan', mensaje: 'un plan con por_plan o jerarquico no mezcla familias' },
        { rule: 'qos_familia', mensaje: 'qos (prioridad por clases) solo con arbol_pcq' },
        { rule: 'qos_fasttrack', mensaje: 'qos exige excluir_fasttrack' },
        { rule: 'qos_costo', mensaje: `como máximo ${QOS_MAX_HOJAS} hojas de QoS por router (planes con qos × 4 × clases)` },
        { rule: 'pppoe_sin_radius', mensaje: 'en un router sin RADIUS (modo_seguridad api), PPPoE solo con perfil_ppp (cualquier padre) o arbol_pcq' },
    ],
    advertencias: ['sin_techo', 'reuso_dedicado', 'sin_padre_prioridad', 'fasttrack', 'version_desconocida', 'fuera_del_techo', 'qos_sin_cuello'],
    atajos: { simple: estrategiaSimple(), arbol_pcq: estrategiaArbol() },
}
