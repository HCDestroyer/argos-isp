import type { Schema, paths } from '@argosisp/contracts'

/**
 * Tipos del control de velocidad por capas (`contratos/control-velocidad.md`, A2), todos desde
 * `packages/contracts`. Solo se nombran aquí para no repetir `Schema<…>` y los cuerpos de `paths`.
 * Las listas de valores siguen el orden de la API (`apps/api/app/network/estrategia_velocidad.ts`) y
 * `satisfies` las ata al enum del contrato.
 */

export type Estrategia = Schema<'EstrategiaVelocidad'>
export type EstrategiasRouter = Schema<'EstrategiasRouter'>
/** Excepción de un plan en un router: parcial por tipo de conexión (ausente o null = hereda). */
export type EstrategiasPlan = Schema<'ExcepcionEstrategia'>
export type EstrategiaParcial = NonNullable<EstrategiasPlan['pppoe']>

export type Aplicacion = Estrategia['aplicacion']
export type Padre = Estrategia['padre']
export type TipoCola = Estrategia['tipo_cola']
export type Extra = keyof Estrategia['extras']
export type ExtrasEstrategia = Estrategia['extras']
export type TipoConexionVelocidad = keyof EstrategiasRouter

export type MatrizControlVelocidad = Schema<'MatrizControlVelocidad'>
export type VistaPreviaEstrategia = Schema<'VistaPreviaEstrategia'>
export type SincronizacionPlan = Schema<'SincronizacionPlan'>
export type VistaPreviaReconciliar = Schema<'VistaPreviaReconciliar'>
export type DiagnosticoCorte = Schema<'DiagnosticoCorte'>

export type DatosVistaPreviaEstrategia = paths['/api/v1/routers/{id}/vista-previa-estrategia']['post']['requestBody']['content']['application/json']
export type CambioEstrategiaRouter = paths['/api/v1/routers/{id}/cambiar-estrategia-velocidad']['post']['requestBody']['content']['application/json']
export type CambioEstrategiaPlan = paths['/api/v1/planes/{id}/routers/{routerId}/estrategia-velocidad']['post']['requestBody']['content']['application/json']

export const APLICACIONES = ['radius_rate_limit', 'perfil_ppp', 'cola_simple', 'pcq_plan', 'arbol_pcq'] as const satisfies readonly Aplicacion[]
export const PADRES = ['ninguno', 'por_plan', 'por_router', 'jerarquico'] as const satisfies readonly Padre[]
export const TIPOS_COLA = ['default', 'sfq', 'pcq', 'fq_codel', 'cake'] as const satisfies readonly TipoCola[]
export const EXTRAS = ['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack', 'qos'] as const satisfies readonly Extra[]
export const TIPOS_CONEXION_VELOCIDAD = ['pppoe', 'ip_estatica', 'dhcp_fija'] as const satisfies readonly TipoConexionVelocidad[]
