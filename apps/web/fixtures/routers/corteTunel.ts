import type { Schema } from '@argosisp/contracts'
import { bd } from '../bd'

type Router = Schema<'Router'>
type MotivoSinCorteTunel = NonNullable<Router['corte_por_tunel_motivo']>

/** Los dos campos de solo lectura que la API agrega a cada router (A1, `consultas/routers.ts`). */
export interface CorteTunelRouter {
    corte_por_tunel: boolean
    corte_por_tunel_motivo: MotivoSinCorteTunel | null
}

/**
 * `motivoSinCorteTunel` (A1, `app/network/conexion/tunel_corte.ts`; `contratos/corte-identificacion.md`
 * §5 ter.3) para los fixtures, en el mismo orden: en los fixtures WireGuard está encendido y
 * `PORTAL_CORTE_TUNEL` vale 1 (los valores por defecto del servidor), así que `wireguard_apagado` y
 * `tunel_corte_apagado` no salen; luego router inactivo, modo código (solo con la API completa: sin ella
 * el router cae en la regla del túnel) y registrado en el túnel (fila de conexión con clave pública).
 */
export function corteTunelFixture(router: Router): CorteTunelRouter {
    const motivo: MotivoSinCorteTunel | null = !router.activo
        ? 'router_inactivo'
        : router.corte_identificacion === 'codigo' && router.api_usuario !== null && router.tiene_api_password
            ? 'modo_codigo'
            : !bd.conexionesRouter.some(c => c.router_id === router.id && c.public_key !== null)
                    ? 'sin_tunel'
                    : null
    return { corte_por_tunel: motivo === null, corte_por_tunel_motivo: motivo }
}

/** El router como lo devuelve la API: `GET /routers`, `GET /routers/:id` y toda respuesta con un router. */
export function conCorteTunel(router: Router): Router {
    return { ...router, ...corteTunelFixture(router) }
}

/** Para que el diagnóstico de corte use la misma regla que la ficha. */
export function corteVaPorTunel(router: Router): boolean {
    return corteTunelFixture(router).corte_por_tunel
}
