import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Promociones de velocidad (decisión del PM 18, 21 nov; «promoción para gamers»): subir la velocidad
 * de uno o varios servicios por días completos o en una franja horaria diaria, entre `inicio` y `fin`.
 *
 * - `core.promociones_velocidad`: la definición (multiplicador o plan destino; `dias` o `franja` con
 *   hora local de Guatemala y días de la semana opcionales). `precio` null = no cambia el precio.
 * - `core.promociones_velocidad_servicios`: a qué servicios se asigna (una asignación vigente por par).
 * - `core.promociones_velocidad_tramos`: cada vez que la velocidad sube (un tramo por día o por franja).
 *   Clave única `(promocion_id, servicio_id, inicio)`: el cron abre cada tramo una sola vez aunque
 *   corra dos veces. Un solo tramo abierto por servicio (índice parcial): la velocidad efectiva del
 *   servicio la da ese tramo (`app/core/promociones_velocidad.ts`).
 *   `cambia_plan` (decisión del PM 34): en un router con velocidad por plan (`pcq_plan`, `arbol_pcq`)
 *   el tramo pasa el servicio a `plan_destino_id` y al cerrar lo devuelve a `plan_original_id`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.promociones_velocidad (
                id bigserial PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (length(trim(nombre)) BETWEEN 3 AND 120),
                descripcion text,
                tipo_velocidad text NOT NULL CHECK (tipo_velocidad IN ('multiplicador', 'plan_destino')),
                multiplicador numeric(14,2) CHECK (multiplicador IS NULL OR (multiplicador > 1 AND multiplicador <= 10)),
                plan_destino_id bigint REFERENCES network.planes (id),
                modo text NOT NULL CHECK (modo IN ('dias', 'franja')),
                inicio timestamptz NOT NULL,
                fin timestamptz NOT NULL,
                franja_inicio time,
                franja_fin time,
                dias_semana smallint[],
                precio numeric(14,2) CHECK (precio IS NULL OR precio >= 0),
                estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'cancelada')),
                motivo_cancelacion text,
                cancelada_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT promociones_fin_despues CHECK (fin > inicio),
                CONSTRAINT promociones_velocidad_dato CHECK (
                    (tipo_velocidad = 'multiplicador' AND multiplicador IS NOT NULL AND plan_destino_id IS NULL)
                    OR (tipo_velocidad = 'plan_destino' AND plan_destino_id IS NOT NULL AND multiplicador IS NULL)
                ),
                CONSTRAINT promociones_franja CHECK (
                    (modo = 'dias' AND franja_inicio IS NULL AND franja_fin IS NULL AND dias_semana IS NULL)
                    OR (modo = 'franja' AND franja_inicio IS NOT NULL AND franja_fin IS NOT NULL
                        AND franja_inicio <> franja_fin)
                ),
                CONSTRAINT promociones_dias_semana CHECK (
                    dias_semana IS NULL OR (cardinality(dias_semana) BETWEEN 1 AND 7
                        AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
                )
            );
            CREATE INDEX promociones_velocidad_empresa ON core.promociones_velocidad (empresa_id, id DESC);

            CREATE TABLE core.promociones_velocidad_servicios (
                id bigserial PRIMARY KEY,
                promocion_id bigint NOT NULL REFERENCES core.promociones_velocidad (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'quitada')),
                agregada_por bigint REFERENCES core.usuarios (id),
                quitada_en timestamptz,
                motivo text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX promociones_servicios_vigente
                ON core.promociones_velocidad_servicios (promocion_id, servicio_id) WHERE estado = 'vigente';
            CREATE INDEX promociones_servicios_servicio
                ON core.promociones_velocidad_servicios (servicio_id) WHERE estado = 'vigente';

            CREATE TABLE core.promociones_velocidad_tramos (
                id bigserial PRIMARY KEY,
                promocion_id bigint NOT NULL REFERENCES core.promociones_velocidad (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                inicio timestamptz NOT NULL,
                fin timestamptz NOT NULL,
                estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
                abierto_en timestamptz NOT NULL DEFAULT now(),
                cerrado_en timestamptz,
                motivo_cierre text,
                cambia_plan boolean NOT NULL DEFAULT false,
                plan_original_id bigint REFERENCES network.planes (id),
                plan_destino_id bigint REFERENCES network.planes (id),
                CONSTRAINT promociones_tramos_rango CHECK (fin > inicio),
                CONSTRAINT promociones_tramos_plan CHECK (
                    (cambia_plan AND plan_original_id IS NOT NULL AND plan_destino_id IS NOT NULL)
                    OR (NOT cambia_plan AND plan_original_id IS NULL AND plan_destino_id IS NULL)
                ),
                CONSTRAINT promociones_tramos_unico UNIQUE (promocion_id, servicio_id, inicio)
            );
            CREATE UNIQUE INDEX promociones_tramos_uno_abierto
                ON core.promociones_velocidad_tramos (servicio_id) WHERE estado = 'abierto';
            CREATE INDEX promociones_tramos_por_cerrar
                ON core.promociones_velocidad_tramos (fin) WHERE estado = 'abierto';
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.promociones_velocidad_tramos;
            DROP TABLE IF EXISTS core.promociones_velocidad_servicios;
            DROP TABLE IF EXISTS core.promociones_velocidad;
        `)
    }
}
