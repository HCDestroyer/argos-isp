import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Control de velocidad por capas (`.claude/integration/contratos/control-velocidad.md`).
 *
 * - `network.routers.estrategia_velocidad`: una estrategia completa por tipo de conexión
 *   (`pppoe`, `ip_estatica`, `dhcp_fija`). Se llena con la equivalente al `control_velocidad` de hoy,
 *   así que nada cambia en el router: `simple` → `radius_rate_limit` (PPPoE) y `cola_simple` (WISP)
 *   con padre `por_plan`; `arbol_pcq` → `arbol_pcq` + `jerarquico` + `pcq`, sin ráfaga.
 * - `network.planes_routers.estrategia_velocidad`: excepción parcial del plan en ese router (null =
 *   hereda).
 * - `network.sesiones.estrategia_velocidad`: con qué estrategia entró la sesión (copia de la del
 *   router y la del plan al abrirla). Una sesión PPPoE conserva lo que tenía hasta reconectar, aunque
 *   la estrategia cambie después; null (sesiones anteriores) = la vigente.
 * - `network.routers.routeros_version`: versión leída de `/system/resource` (CAKE y fq_codel
 *   necesitan RouterOS 7).
 *
 * `control_velocidad` queda como campo derivado (`arbol_pcq` si PPPoE va por árbol).
 */
const EXTRAS = `'rafaga', true, 'prioridad', true, 'garantizado', true, 'excluir_fasttrack', true`
const SIMPLE = `jsonb_build_object(
    'pppoe', jsonb_build_object('aplicacion', 'radius_rate_limit', 'padre', 'por_plan', 'tipo_cola', 'default',
        'extras', jsonb_build_object(${EXTRAS})),
    'ip_estatica', jsonb_build_object('aplicacion', 'cola_simple', 'padre', 'por_plan', 'tipo_cola', 'default',
        'extras', jsonb_build_object(${EXTRAS})),
    'dhcp_fija', jsonb_build_object('aplicacion', 'cola_simple', 'padre', 'por_plan', 'tipo_cola', 'default',
        'extras', jsonb_build_object(${EXTRAS})))`
const ARBOL_UNO = `jsonb_build_object('aplicacion', 'arbol_pcq', 'padre', 'jerarquico', 'tipo_cola', 'pcq',
        'extras', jsonb_build_object('rafaga', false, 'prioridad', true, 'garantizado', true, 'excluir_fasttrack', true))`
const ARBOL = `jsonb_build_object('pppoe', ${ARBOL_UNO}, 'ip_estatica', ${ARBOL_UNO}, 'dhcp_fija', ${ARBOL_UNO})`

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN estrategia_velocidad jsonb NOT NULL DEFAULT ${SIMPLE}
                    CONSTRAINT routers_estrategia_velocidad CHECK (
                        jsonb_typeof(estrategia_velocidad) = 'object'
                        AND jsonb_typeof(estrategia_velocidad -> 'pppoe') = 'object'
                        AND jsonb_typeof(estrategia_velocidad -> 'ip_estatica') = 'object'
                        AND jsonb_typeof(estrategia_velocidad -> 'dhcp_fija') = 'object'),
                ADD COLUMN routeros_version text
                    CONSTRAINT routers_routeros_version CHECK (char_length(routeros_version) BETWEEN 1 AND 100);
            UPDATE network.routers SET estrategia_velocidad = ${ARBOL} WHERE control_velocidad = 'arbol_pcq';

            ALTER TABLE network.planes_routers
                ADD COLUMN estrategia_velocidad jsonb
                    CONSTRAINT planes_routers_estrategia_velocidad CHECK (
                        estrategia_velocidad IS NULL OR jsonb_typeof(estrategia_velocidad) = 'object');

            ALTER TABLE network.sesiones ADD COLUMN estrategia_velocidad jsonb;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.sesiones DROP COLUMN estrategia_velocidad;
            ALTER TABLE network.planes_routers DROP COLUMN estrategia_velocidad;
            ALTER TABLE network.routers
                DROP COLUMN estrategia_velocidad,
                DROP COLUMN routeros_version;
        `)
    }
}
