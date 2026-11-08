import type { Schema } from '@argosisp/contracts'
import { bd } from '../bd'

/**
 * `corteTunelDeRouter` (A6, `app/network/conexion/tunel_corte.ts`; `contratos/corte-identificacion.md`
 * §5 ter.3) para los fixtures: el corte va por el túnel WireGuard si el router está activo, en modo `ip`
 * y registrado en el túnel (fila de conexión con clave pública). En los fixtures WireGuard está encendido
 * y `PORTAL_CORTE_TUNEL` vale 1, los valores por defecto del servidor.
 *
 * TEMPORAL: A1 agrega `corte_por_tunel` y `corte_por_tunel_motivo` a `Router` en `a1/corte-fase2`, que aún
 * no está en contracts. Los motivos de aquí son provisionales: al mezclar A1 se copian sus textos y los
 * campos pasan a los routers de `datos.ts` (anotado en `.claude/integration/a4.md`).
 */
export function corteTunelFixture(router: Schema<'Router'>): { corte_por_tunel: boolean, corte_por_tunel_motivo: string | null } {
    if (router.corte_identificacion === 'codigo') {
        return { corte_por_tunel: false, corte_por_tunel_motivo: 'El router identifica por código: el corte va al proxy del propio router y no necesita el túnel.' }
    }
    if (!router.activo) {
        return { corte_por_tunel: false, corte_por_tunel_motivo: 'El router está inactivo.' }
    }
    if (!bd.conexionesRouter.some(c => c.router_id === router.id && c.public_key !== null)) {
        return { corte_por_tunel: false, corte_por_tunel_motivo: 'El router no está registrado en el túnel WireGuard: genera el script de conexión y pega su clave pública.' }
    }
    return { corte_por_tunel: true, corte_por_tunel_motivo: null }
}

/** El router con los dos campos, como lo devolverá `GET /routers/:id` con A1. */
export function conCorteTunel(router: Schema<'Router'>) {
    return { ...router, ...corteTunelFixture(router) }
}

/** Para que el diagnóstico de corte use la misma regla que la ficha. */
export function corteVaPorTunel(router: Schema<'Router'>): boolean {
    return corteTunelFixture(router).corte_por_tunel
}
