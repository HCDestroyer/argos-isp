import { BaseSchema } from '@adonisjs/lucid/schema'
import { SEMILLAS_QOS } from '#network/qos'

/**
 * Prioridad por protocolo (QoS por clases) en el árbol (`.claude/integration/contratos/qos.md`).
 *
 * - `network.qos_perfiles`: juegos de clases, comunes (`empresa_id` null) o de una empresa. Uno solo es
 *   `predeterminado` (común): el de los routers sin perfil.
 * - `network.qos_clases`: cada clase con su orden de clasificación, prioridad, garantizado, tope,
 *   reglas de coincidencia (jsonb), y para descargas `bytes_minimo` + `reclasifica_de`. Una sola
 *   `es_resto` activa por perfil.
 * - `network.routers.qos_perfil_id`: perfil del router (null = el predeterminado).
 * - Semilla: perfil «Predeterminado» con Interactivo, Streaming, Web, Descargas y Resto (§5). Nada cambia
 *   en ningún router: el extra `qos` está apagado en todas las estrategias.
 */
const TIPOS = ['pppoe', 'ip_estatica', 'dhcp_fija']

/** `extras.qos = false` en los tres tipos de una estrategia (si no lo tiene). */
function conQosApagado(columna: string): string {
    return TIPOS.reduce(
        (expr, t) =>
            `jsonb_set(${expr}, '{${t},extras,qos}', COALESCE(${columna} #> '{${t},extras,qos}', 'false'::jsonb), true)`,
        columna,
    )
}

const EXTRAS = `'rafaga', true, 'prioridad', true, 'garantizado', true, 'excluir_fasttrack', true, 'qos', false`
const SIMPLE = `jsonb_build_object(
    'pppoe', jsonb_build_object('aplicacion', 'radius_rate_limit', 'padre', 'por_plan', 'tipo_cola', 'default',
        'extras', jsonb_build_object(${EXTRAS})),
    'ip_estatica', jsonb_build_object('aplicacion', 'cola_simple', 'padre', 'por_plan', 'tipo_cola', 'default',
        'extras', jsonb_build_object(${EXTRAS})),
    'dhcp_fija', jsonb_build_object('aplicacion', 'cola_simple', 'padre', 'por_plan', 'tipo_cola', 'default',
        'extras', jsonb_build_object(${EXTRAS})))`

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.qos_perfiles (
                id bigserial PRIMARY KEY,
                empresa_id bigint REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
                descripcion text CHECK (descripcion IS NULL OR char_length(descripcion) <= 500),
                predeterminado boolean NOT NULL DEFAULT false,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT qos_perfiles_predeterminado_comun CHECK (NOT predeterminado OR empresa_id IS NULL)
            );
            CREATE UNIQUE INDEX qos_perfiles_nombre ON network.qos_perfiles (COALESCE(empresa_id, 0), lower(nombre));
            CREATE UNIQUE INDEX qos_perfiles_un_predeterminado ON network.qos_perfiles (predeterminado)
                WHERE predeterminado;

            CREATE TABLE network.qos_clases (
                id bigserial PRIMARY KEY,
                perfil_id bigint NOT NULL REFERENCES network.qos_perfiles (id),
                nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
                orden integer NOT NULL CHECK (orden >= 1),
                prioridad smallint NOT NULL CHECK (prioridad BETWEEN 1 AND 8),
                garantizado_pct smallint NOT NULL DEFAULT 0 CHECK (garantizado_pct BETWEEN 0 AND 100),
                tope_pct smallint CHECK (tope_pct IS NULL OR tope_pct BETWEEN 1 AND 100),
                es_resto boolean NOT NULL DEFAULT false,
                reglas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reglas) = 'array'),
                bytes_minimo bigint CHECK (bytes_minimo IS NULL OR bytes_minimo > 0),
                reclasifica_de bigint[] NOT NULL DEFAULT '{}',
                activa boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT qos_clases_resto_simple CHECK (NOT es_resto OR bytes_minimo IS NULL)
            );
            CREATE UNIQUE INDEX qos_clases_nombre ON network.qos_clases (perfil_id, lower(nombre));
            CREATE UNIQUE INDEX qos_clases_un_resto ON network.qos_clases (perfil_id) WHERE es_resto AND activa;

            ALTER TABLE network.routers
                ADD COLUMN qos_perfil_id bigint REFERENCES network.qos_perfiles (id);

            -- El extra nuevo queda explícito y apagado en las estrategias de los routers y en el valor
            -- por defecto (los atajos de estrategia_velocidad.ts ya lo traen en false).
            UPDATE network.routers SET estrategia_velocidad = ${conQosApagado('estrategia_velocidad')};
            ALTER TABLE network.routers ALTER COLUMN estrategia_velocidad
                SET DEFAULT ${SIMPLE};
        `)
        this.defer(async (db) => {
            const [perfil] = (await db
                .insertQuery()
                .table('network.qos_perfiles')
                .insert({
                    nombre: 'Predeterminado',
                    descripcion:
                        'Clases sugeridas: interactivo (DNS, NTP, VoIP, juegos), streaming, web, descargas pesadas y resto',
                    predeterminado: true,
                })
                .returning('id')) as Array<{ id: number }>
            const ids = new Map<string, number>()
            for (const s of SEMILLAS_QOS) {
                const [fila] = (await db
                    .insertQuery()
                    .table('network.qos_clases')
                    .insert({
                        perfil_id: perfil!.id,
                        nombre: s.nombre,
                        orden: s.orden,
                        prioridad: s.prioridad,
                        garantizado_pct: s.garantizado_pct,
                        tope_pct: s.tope_pct,
                        es_resto: s.es_resto,
                        reglas: JSON.stringify(s.reglas),
                        bytes_minimo: s.bytes_minimo,
                    })
                    .returning('id')) as Array<{ id: number }>
                ids.set(s.clave, Number(fila!.id))
            }
            for (const s of SEMILLAS_QOS) {
                if (s.reclasifica_de.length === 0) continue
                await db
                    .from('network.qos_clases')
                    .where('id', ids.get(s.clave)!)
                    .update({ reclasifica_de: s.reclasifica_de.map((c) => ids.get(c)!) })
            }
        })
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.routers DROP COLUMN qos_perfil_id;
            DROP TABLE network.qos_clases;
            DROP TABLE network.qos_perfiles;
        `)
    }
}
