import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Modelo de velocidad (decisión del PM, día 4; `.claude/integration/contratos/velocidad.md`).
 *
 * - `network.planes`: CIR (`garantizado_pct`, null = `100 / reuso`), ráfaga (`rafaga_*`) y
 *   `prioridad`, con los valores por defecto del contrato; `reuso` queda entre 1 y 64.
 * - `network.planes_routers`: los mismos campos (y `reuso`) como excepción por router; null hereda
 *   el valor del plan.
 * - `network.routers`: `control_velocidad` (`simple` | `arbol_pcq`) reemplaza a `modo_velocidad`
 *   (`pcq` → `arbol_pcq`), más la capacidad del enlace (techo del padre global; null = sin techo).
 *   La vista sigue exponiendo `modo_velocidad` derivado, marcado obsoleto.
 *
 * Las reglas que cruzan campos (CIR ≤ MIR / reuso, umbral < MIR < ráfaga) las valida
 * `validarVelocidad` (`app/network/velocidad.ts`) con 422 por campo; aquí quedan los rangos y la
 * ráfaga mayor que la velocidad del plan.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.planes
                ADD COLUMN garantizado_pct numeric(5, 2)
                    CONSTRAINT planes_garantizado_pct CHECK (garantizado_pct > 0 AND garantizado_pct <= 100),
                ADD COLUMN rafaga_bajada_kbps integer
                    CONSTRAINT planes_rafaga_bajada CHECK (rafaga_bajada_kbps > bajada_kbps),
                ADD COLUMN rafaga_subida_kbps integer
                    CONSTRAINT planes_rafaga_subida CHECK (rafaga_subida_kbps > subida_kbps),
                ADD COLUMN rafaga_umbral_pct smallint NOT NULL DEFAULT 75
                    CONSTRAINT planes_rafaga_umbral CHECK (rafaga_umbral_pct BETWEEN 1 AND 99),
                ADD COLUMN rafaga_segundos smallint NOT NULL DEFAULT 16
                    CONSTRAINT planes_rafaga_segundos CHECK (rafaga_segundos BETWEEN 1 AND 3600),
                ADD COLUMN prioridad smallint NOT NULL DEFAULT 8
                    CONSTRAINT planes_prioridad CHECK (prioridad BETWEEN 1 AND 8),
                ADD CONSTRAINT planes_reuso_maximo CHECK (reuso <= 64);

            ALTER TABLE network.planes_routers
                ADD COLUMN reuso integer
                    CONSTRAINT planes_routers_reuso CHECK (reuso BETWEEN 1 AND 64),
                ADD COLUMN garantizado_pct numeric(5, 2)
                    CONSTRAINT planes_routers_garantizado_pct CHECK (garantizado_pct > 0 AND garantizado_pct <= 100),
                ADD COLUMN rafaga_bajada_kbps integer
                    CONSTRAINT planes_routers_rafaga_bajada CHECK (rafaga_bajada_kbps > 0),
                ADD COLUMN rafaga_subida_kbps integer
                    CONSTRAINT planes_routers_rafaga_subida CHECK (rafaga_subida_kbps > 0),
                ADD COLUMN rafaga_umbral_pct smallint
                    CONSTRAINT planes_routers_rafaga_umbral CHECK (rafaga_umbral_pct BETWEEN 1 AND 99),
                ADD COLUMN rafaga_segundos smallint
                    CONSTRAINT planes_routers_rafaga_segundos CHECK (rafaga_segundos BETWEEN 1 AND 3600),
                ADD COLUMN prioridad smallint
                    CONSTRAINT planes_routers_prioridad CHECK (prioridad BETWEEN 1 AND 8);

            ALTER TABLE network.routers
                ADD COLUMN control_velocidad text NOT NULL DEFAULT 'simple'
                    CONSTRAINT routers_control_velocidad CHECK (control_velocidad IN ('simple', 'arbol_pcq')),
                ADD COLUMN capacidad_bajada_kbps integer
                    CONSTRAINT routers_capacidad_bajada CHECK (capacidad_bajada_kbps > 0),
                ADD COLUMN capacidad_subida_kbps integer
                    CONSTRAINT routers_capacidad_subida CHECK (capacidad_subida_kbps > 0);
            UPDATE network.routers
               SET control_velocidad = CASE modo_velocidad WHEN 'pcq' THEN 'arbol_pcq' ELSE 'simple' END;
            ALTER TABLE network.routers DROP COLUMN modo_velocidad;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN modo_velocidad text NOT NULL DEFAULT 'simple'
                    CHECK (modo_velocidad IN ('simple', 'pcq'));
            UPDATE network.routers
               SET modo_velocidad = CASE control_velocidad WHEN 'arbol_pcq' THEN 'pcq' ELSE 'simple' END;
            ALTER TABLE network.routers
                DROP COLUMN control_velocidad,
                DROP COLUMN capacidad_bajada_kbps,
                DROP COLUMN capacidad_subida_kbps;

            ALTER TABLE network.planes_routers
                DROP COLUMN reuso,
                DROP COLUMN garantizado_pct,
                DROP COLUMN rafaga_bajada_kbps,
                DROP COLUMN rafaga_subida_kbps,
                DROP COLUMN rafaga_umbral_pct,
                DROP COLUMN rafaga_segundos,
                DROP COLUMN prioridad;

            ALTER TABLE network.planes
                DROP CONSTRAINT planes_reuso_maximo,
                DROP COLUMN garantizado_pct,
                DROP COLUMN rafaga_bajada_kbps,
                DROP COLUMN rafaga_subida_kbps,
                DROP COLUMN rafaga_umbral_pct,
                DROP COLUMN rafaga_segundos,
                DROP COLUMN prioridad;
        `)
    }
}
