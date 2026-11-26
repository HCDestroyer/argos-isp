import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * SmartOLT multi-instancia y ACS por separado (`contratos/equipos-olt-acs.md` §3.7, lote 1).
 *
 * Antes: `integraciones.equipos_config`, una fila por empresa con SmartOLT y GenieACS juntos, un solo
 * `activo` y una sola `version`; perfiles por `(empresa_id, smartolt_olt_id, plan_id)`.
 *
 * Después:
 * - `integraciones.acs_config`: un ACS (GenieACS) por empresa (decisión del PM, P7).
 * - `integraciones.smartolt_instancias`: 0..n cuentas (subdominios) de SmartOLT por empresa;
 *   `empresa_id` null = compartida entre las empresas de la instalación (decisión del PM, P1). La URL es
 *   única en la instalación: una cuenta, un token, un presupuesto de llamadas.
 * - `integraciones.smartolt_olts`: las OLT de cada instancia (las de `get_olts`, o `manual` si vienen
 *   de un perfil antes de la primera sincronización), con su vínculo opcional a `network.olts`.
 * - `integraciones.equipos_perfiles` cuelga de la OLT de SmartOLT (`smartolt_olt_ref_id`).
 * - `equipos_servicio` y `aprovisionamientos` guardan la instancia (`smartolt_instancia_id`).
 * - Permisos `equipos.*` → `smartolt.*` y `acs.*` (§5.2), en roles y en `alcances.permisos` de tokens.
 *
 * Los secretos se copian **cifrados tal cual** (nunca se descifran aquí). Idempotente: si
 * `equipos_config` ya no existe, solo asegura las tablas y los permisos. `audit.*` no se toca salvo
 * para dejar constancia (actor `sistema`, `request_id = migracion:1795636688259_separar_smartolt_acs`).
 *
 * `down()`: vuelve a juntar una instancia por empresa (la de id menor; una compartida va a las empresas
 * que la usan, o a la empresa de id menor si nadie la usa). **Con más de una instancia por empresa el
 * reverso pierde las demás**, y las OLT sincronizadas sin perfiles se pierden.
 */

const REQUEST_ID = 'migracion:1795636688259_separar_smartolt_acs'

/** Valores con null para `rawQuery` (sus tipos no admiten null, pero el driver sí). */
const valores = (lista: unknown[]) => lista as never[]

/** Permiso nuevo → permiso viejo del que se hereda (§5.2). */
export const PERMISOS_NUEVOS: Record<string, { viejo: string; descripcion: string }> = {
    'smartolt.ver': {
        viejo: 'equipos.ver',
        descripcion:
            'Ver las instancias de SmartOLT (sin token), sus OLT, a qué OLT de Argos están vinculadas y sus perfiles',
    },
    'smartolt.crear_instancia': {
        viejo: 'equipos.configurar',
        descripcion:
            'Registrar una instancia (subdominio y token) de SmartOLT; compartida solo con alcance global',
    },
    'smartolt.editar_instancia': {
        viejo: 'equipos.configurar',
        descripcion:
            'Editar una instancia de SmartOLT (nombre, URL, token, encendido y perfiles por OLT y plan)',
    },
    'smartolt.eliminar_instancia': {
        viejo: 'equipos.configurar',
        descripcion: 'Eliminar una instancia de SmartOLT que ningún equipo ni pedido en curso usa',
    },
    'smartolt.vincular_olt': {
        viejo: 'equipos.configurar',
        descripcion: 'Vincular una OLT de SmartOLT con una OLT de la red de acceso de Argos',
    },
    'smartolt.probar_instancia': {
        viejo: 'equipos.probar',
        descripcion: 'Probar la conexión con una instancia de SmartOLT y sincronizar sus OLT',
    },
    'acs.ver': {
        viejo: 'equipos.ver',
        descripcion: 'Ver la configuración del ACS (GenieACS) de la empresa (sin la clave)',
    },
    'acs.configurar': {
        viejo: 'equipos.configurar',
        descripcion:
            'Configurar el ACS (GenieACS) de la empresa (URL, usuario, clave, certificado, PPPoE por ACS)',
    },
    'acs.probar': {
        viejo: 'equipos.probar',
        descripcion: 'Probar la conexión con el ACS (GenieACS) de la empresa con la configuración guardada',
    },
}

export const PERMISOS_VIEJOS: Record<string, string> = {
    'equipos.ver':
        'Ver la configuración de SmartOLT y GenieACS de la empresa (sin token ni clave) y sus perfiles de autorización',
    'equipos.configurar':
        'Configurar SmartOLT y GenieACS de la empresa (URL, token, usuario y clave del ACS, perfiles por OLT y plan); solo admin',
    'equipos.probar': 'Probar la conexión con SmartOLT y GenieACS con la configuración guardada',
}

interface FilaVieja {
    empresa_id: number
    activo: boolean
    smartolt_url: string | null
    smartolt_token_cifrado: string | null
    smartolt_probado_en: Date | null
    smartolt_prueba_ok: boolean | null
    smartolt_prueba_error: string | null
    genieacs_url: string | null
    genieacs_usuario: string | null
    genieacs_clave_cifrada: string | null
    genieacs_ca: string | null
    genieacs_probado_en: Date | null
    genieacs_prueba_ok: boolean | null
    genieacs_prueba_error: string | null
    pppoe_por_acs: boolean
    version: number
}

export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            await db.rawQuery(`
                CREATE TABLE IF NOT EXISTS integraciones.smartolt_instancias (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    empresa_id bigint REFERENCES core.empresas (id),
                    nombre text NOT NULL CHECK (btrim(nombre) <> ''),
                    nota text,
                    url text NOT NULL,
                    token_cifrado text NOT NULL,
                    activo boolean NOT NULL DEFAULT false,
                    probado_en timestamptz,
                    prueba_ok boolean,
                    prueba_error text,
                    olts_sincronizadas_en timestamptz,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS smartolt_instancias_url
                    ON integraciones.smartolt_instancias (lower(url));
                CREATE UNIQUE INDEX IF NOT EXISTS smartolt_instancias_nombre
                    ON integraciones.smartolt_instancias (coalesce(empresa_id, 0), lower(nombre));

                CREATE TABLE IF NOT EXISTS integraciones.smartolt_olts (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    instancia_id bigint NOT NULL
                        REFERENCES integraciones.smartolt_instancias (id) ON DELETE CASCADE,
                    smartolt_olt_id text NOT NULL,
                    nombre text,
                    hardware text,
                    ip text,
                    olt_id bigint REFERENCES network.olts (id) ON DELETE SET NULL,
                    presente boolean NOT NULL DEFAULT true,
                    origen text NOT NULL CHECK (origen IN ('sincronizada', 'manual')),
                    sincronizada_en timestamptz,
                    UNIQUE (instancia_id, smartolt_olt_id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS smartolt_olts_olt_argos
                    ON integraciones.smartolt_olts (olt_id) WHERE olt_id IS NOT NULL;

                CREATE TABLE IF NOT EXISTS integraciones.acs_config (
                    empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                    activo boolean NOT NULL DEFAULT false,
                    url text,
                    usuario text,
                    clave_cifrada text,
                    ca text,
                    probado_en timestamptz,
                    prueba_ok boolean,
                    prueba_error text,
                    pppoe_por_acs boolean NOT NULL DEFAULT false,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                ALTER TABLE integraciones.equipos_servicio ADD COLUMN IF NOT EXISTS smartolt_instancia_id bigint
                    REFERENCES integraciones.smartolt_instancias (id) ON DELETE SET NULL;
                ALTER TABLE integraciones.aprovisionamientos ADD COLUMN IF NOT EXISTS smartolt_instancia_id bigint
                    REFERENCES integraciones.smartolt_instancias (id) ON DELETE SET NULL;
                ALTER TABLE integraciones.equipos_perfiles ADD COLUMN IF NOT EXISTS smartolt_olt_ref_id bigint
                    REFERENCES integraciones.smartolt_olts (id) ON DELETE CASCADE;
            `)

            if (await this.existeTabla(db, 'equipos_config')) await this.migrarDatos(db)

            await db.rawQuery(`
                DROP INDEX IF EXISTS integraciones.equipos_perfiles_unico;
                ALTER TABLE integraciones.equipos_perfiles DROP COLUMN IF EXISTS empresa_id;
                ALTER TABLE integraciones.equipos_perfiles DROP COLUMN IF EXISTS smartolt_olt_id;
                ALTER TABLE integraciones.equipos_perfiles ALTER COLUMN smartolt_olt_ref_id SET NOT NULL;
                CREATE UNIQUE INDEX IF NOT EXISTS equipos_perfiles_olt_plan
                    ON integraciones.equipos_perfiles (smartolt_olt_ref_id, coalesce(plan_id, 0));
                DROP TABLE IF EXISTS integraciones.equipos_config;

                DO $do$
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                        GRANT SELECT, INSERT, UPDATE ON integraciones.acs_config TO argosisp_app;
                        GRANT SELECT, INSERT, UPDATE, DELETE ON integraciones.smartolt_instancias,
                            integraciones.smartolt_olts TO argosisp_app;
                        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                    END IF;
                END
                $do$;
            `)

            await this.migrarPermisos(db)
        })
    }

    private async existeTabla(db: QueryClientContract, tabla: string): Promise<boolean> {
        const r = await db.rawQuery(`SELECT to_regclass(?) AS t`, [`integraciones.${tabla}`])
        return Boolean(r.rows[0]?.t)
    }

    private async migrarDatos(db: QueryClientContract) {
        const filas = (await db
            .from('integraciones.equipos_config')
            .orderBy('empresa_id')
            .select('*')) as FilaVieja[]
        /** url en minúsculas → instancia creada */
        const porUrl = new Map<string, { id: number; empresaId: number | null }>()
        /** empresa → su instancia (propia o la compartida a la que pasó) */
        const instanciaDeEmpresa = new Map<number, number>()

        for (const f of filas) {
            const empresaId = Number(f.empresa_id)
            // ACS
            if (f.genieacs_url !== null || f.pppoe_por_acs) {
                await db.rawQuery(
                    `INSERT INTO integraciones.acs_config (empresa_id, activo, url, usuario, clave_cifrada, ca,
                        probado_en, prueba_ok, prueba_error, pppoe_por_acs, version)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (empresa_id) DO NOTHING`,
                    valores([
                        empresaId,
                        Boolean(f.activo && f.genieacs_url !== null),
                        f.genieacs_url,
                        f.genieacs_usuario,
                        f.genieacs_clave_cifrada,
                        f.genieacs_ca,
                        f.genieacs_probado_en,
                        f.genieacs_prueba_ok,
                        f.genieacs_prueba_error,
                        f.pppoe_por_acs,
                        f.version,
                    ]),
                )
            }
            // SmartOLT
            if (f.smartolt_url && !f.smartolt_token_cifrado) {
                await this.accion(db, empresaId, 'smartolt_sin_token', {
                    detalle: 'SmartOLT a medio configurar (URL sin token): se descarta la URL',
                    url: f.smartolt_url,
                })
                continue
            }
            if (!f.smartolt_url || !f.smartolt_token_cifrado) continue
            const clave = f.smartolt_url.toLowerCase()
            const existente = porUrl.get(clave)
            if (existente) {
                // misma cuenta en dos empresas: la instancia pasa a compartida (decisión del PM, P1)
                if (existente.empresaId !== null) {
                    await db.rawQuery(
                        `UPDATE integraciones.smartolt_instancias SET empresa_id = NULL, updated_at = now()
                          WHERE id = ?`,
                        [existente.id],
                    )
                    await this.accion(db, existente.empresaId, 'smartolt_compartida', {
                        detalle:
                            'La misma cuenta de SmartOLT estaba en dos empresas: la instancia queda compartida',
                        instancia_id: existente.id,
                        empresas: [existente.empresaId, empresaId],
                    })
                    existente.empresaId = null
                } else {
                    await this.accion(db, empresaId, 'smartolt_compartida', {
                        detalle: 'La empresa usaba una cuenta de SmartOLT ya compartida',
                        instancia_id: existente.id,
                        empresas: [empresaId],
                    })
                }
                instanciaDeEmpresa.set(empresaId, existente.id)
                continue
            }
            const r = await db.rawQuery(
                `INSERT INTO integraciones.smartolt_instancias (empresa_id, nombre, url, token_cifrado, activo,
                    probado_en, prueba_ok, prueba_error, version)
                 VALUES (?, 'SmartOLT', ?, ?, ?, ?, ?, ?, 1)
                 RETURNING id`,
                valores([
                    empresaId,
                    f.smartolt_url,
                    f.smartolt_token_cifrado,
                    f.activo,
                    f.smartolt_probado_en,
                    f.smartolt_prueba_ok,
                    f.smartolt_prueba_error,
                ]),
            )
            const id = Number(r.rows[0].id)
            porUrl.set(clave, { id, empresaId })
            instanciaDeEmpresa.set(empresaId, id)
        }

        // Perfiles: una OLT `manual` por (instancia, smartolt_olt_id)
        const perfiles = (await db
            .from('integraciones.equipos_perfiles')
            .whereNull('smartolt_olt_ref_id')
            .orderBy('id')
            .select('*')) as Array<{
            id: number
            empresa_id: number
            smartolt_olt_id: string
            plan_id: number | null
            authorization_preset_id: number
            pon_type: string
        }>
        for (const p of perfiles) {
            const instanciaId = instanciaDeEmpresa.get(Number(p.empresa_id))
            if (instanciaId === undefined) {
                await db.rawQuery(
                    `INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
                     VALUES ('configuracion_equipos', ?, 'perfiles', ?::jsonb, NULL, 'sistema', ?)`,
                    [
                        Number(p.empresa_id),
                        JSON.stringify([
                            `${p.smartolt_olt_id}/${p.plan_id ?? '*'}→${p.authorization_preset_id} ${p.pon_type}`,
                        ]),
                        REQUEST_ID,
                    ],
                )
                await db.from('integraciones.equipos_perfiles').where('id', p.id).delete()
                continue
            }
            const r = await db.rawQuery(
                `INSERT INTO integraciones.smartolt_olts (instancia_id, smartolt_olt_id, origen)
                 VALUES (?, ?, 'manual')
                 ON CONFLICT (instancia_id, smartolt_olt_id) DO UPDATE SET smartolt_olt_id = EXCLUDED.smartolt_olt_id
                 RETURNING id`,
                [instanciaId, p.smartolt_olt_id],
            )
            const refId = Number(r.rows[0].id)
            // Dos empresas con la misma cuenta y el mismo perfil: se queda el primero
            const choca = await db
                .from('integraciones.equipos_perfiles')
                .where('smartolt_olt_ref_id', refId)
                .whereRaw('coalesce(plan_id, 0) = ?', [p.plan_id ?? 0])
                .first()
            if (choca) {
                await db.rawQuery(
                    `INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
                     VALUES ('configuracion_equipos', ?, 'perfiles', ?::jsonb, NULL, 'sistema', ?)`,
                    [
                        Number(p.empresa_id),
                        JSON.stringify([
                            `${p.smartolt_olt_id}/${p.plan_id ?? '*'}→${p.authorization_preset_id} ${p.pon_type} (repetido en la cuenta compartida)`,
                        ]),
                        REQUEST_ID,
                    ],
                )
                await db.from('integraciones.equipos_perfiles').where('id', p.id).delete()
                continue
            }
            await db
                .from('integraciones.equipos_perfiles')
                .where('id', p.id)
                .update({ smartolt_olt_ref_id: refId })
        }

        // Equipos y pedidos ya hechos en SmartOLT: la instancia de su empresa
        for (const [empresaId, instanciaId] of instanciaDeEmpresa) {
            for (const tabla of ['equipos_servicio', 'aprovisionamientos']) {
                await db.rawQuery(
                    `UPDATE integraciones.${tabla} SET smartolt_instancia_id = ?
                      WHERE empresa_id = ? AND smartolt_external_id IS NOT NULL AND smartolt_instancia_id IS NULL`,
                    [instanciaId, empresaId],
                )
            }
        }
    }

    private async migrarPermisos(db: QueryClientContract) {
        for (const [nombre, { descripcion }] of Object.entries(PERMISOS_NUEVOS)) {
            await db.rawQuery(
                `INSERT INTO core.permisos (nombre, descripcion) VALUES (?, ?) ON CONFLICT (nombre) DO NOTHING`,
                [nombre, descripcion],
            )
        }
        const heredar = (viejos: string[]) =>
            Object.entries(PERMISOS_NUEVOS)
                .filter(([, p]) => viejos.includes(p.viejo))
                .map(([n]) => n)

        const roles = (await db
            .from('core.roles_permisos as rp')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .whereIn('p.nombre', Object.keys(PERMISOS_VIEJOS))
            .distinct('rp.role_id')) as Array<{ role_id: number }>
        for (const { role_id: roleId } of roles) {
            const antes = (
                (await db
                    .from('core.roles_permisos as rp')
                    .join('core.permisos as p', 'p.id', 'rp.permiso_id')
                    .where('rp.role_id', roleId)
                    .select('p.nombre')) as Array<{ nombre: string }>
            ).map((f) => f.nombre)
            const nuevos = heredar(antes)
            for (const nombre of nuevos) {
                await db.rawQuery(
                    `INSERT INTO core.roles_permisos (role_id, permiso_id)
                     SELECT ?, id FROM core.permisos WHERE nombre = ? ON CONFLICT DO NOTHING`,
                    [roleId, nombre],
                )
            }
            const despues = [...new Set([...antes.filter((p) => !(p in PERMISOS_VIEJOS)), ...nuevos])]
            await this.cambio(db, 'rol', Number(roleId), 'permisos', antes.toSorted(), despues.toSorted())
        }

        const tokens = (await db
            .from('core.tokens_api')
            .whereNull('revocado_en')
            .whereRaw(`jsonb_typeof(alcances -> 'permisos') = 'array'`)
            .whereRaw(`jsonb_exists_any(alcances -> 'permisos', ?::text[])`, [Object.keys(PERMISOS_VIEJOS)])
            .orderBy('id')
            .select('id', 'alcances')) as Array<{
            id: number
            alcances: { permisos: string[] } & Record<string, unknown>
        }>
        for (const token of tokens) {
            const antes = token.alcances.permisos
            const despues = [...new Set([...antes.filter((p) => !(p in PERMISOS_VIEJOS)), ...heredar(antes)])]
            await db.rawQuery(
                `UPDATE core.tokens_api
                    SET alcances = jsonb_set(alcances, '{permisos}', ?::jsonb), updated_at = now()
                  WHERE id = ?`,
                [JSON.stringify(despues), token.id],
            )
            await this.cambio(db, 'token_api', Number(token.id), 'alcances', token.alcances, {
                ...token.alcances,
                permisos: despues,
            })
        }

        await db.rawQuery(
            `DELETE FROM core.roles_permisos
              WHERE permiso_id IN (SELECT id FROM core.permisos WHERE nombre = ANY(?::text[]))`,
            [Object.keys(PERMISOS_VIEJOS)],
        )
        await db.rawQuery(`DELETE FROM core.permisos WHERE nombre = ANY(?::text[])`, [
            Object.keys(PERMISOS_VIEJOS),
        ])
    }

    private async cambio(
        db: QueryClientContract,
        entidadTipo: string,
        entidadId: number,
        campo: string,
        antes: unknown,
        despues: unknown,
    ) {
        await db.rawQuery(
            `INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
             VALUES (?, ?, ?, ?::jsonb, ?::jsonb, 'sistema', ?)`,
            [entidadTipo, entidadId, campo, JSON.stringify(antes), JSON.stringify(despues), REQUEST_ID],
        )
    }

    private async accion(
        db: QueryClientContract,
        empresaId: number | null,
        motivo: string,
        datos: Record<string, unknown>,
    ) {
        await db.rawQuery(
            `INSERT INTO audit.acciones (actor_tipo, canal, accion, entidad_tipo, entidad_id, entrada, resultado,
                request_id, empresa_id)
             VALUES ('sistema', 'migracion', 'equipos.separar_smartolt_acs', 'configuracion_equipos', ?, ?::jsonb,
                'ok', ?, ?)`,
            valores([empresaId, JSON.stringify({ motivo, ...datos }), REQUEST_ID, empresaId]),
        )
    }

    async down() {
        this.defer(async (db) => {
            await db.rawQuery(`
                CREATE TABLE IF NOT EXISTS integraciones.equipos_config (
                    empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                    activo boolean NOT NULL DEFAULT false,
                    smartolt_url text,
                    smartolt_token_cifrado text,
                    smartolt_probado_en timestamptz,
                    smartolt_prueba_ok boolean,
                    smartolt_prueba_error text,
                    genieacs_url text,
                    genieacs_usuario text,
                    genieacs_clave_cifrada text,
                    genieacs_probado_en timestamptz,
                    genieacs_prueba_ok boolean,
                    genieacs_prueba_error text,
                    pppoe_por_acs boolean NOT NULL DEFAULT false,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    genieacs_ca text
                );
                ALTER TABLE integraciones.equipos_perfiles ADD COLUMN IF NOT EXISTS empresa_id bigint
                    REFERENCES core.empresas (id);
                ALTER TABLE integraciones.equipos_perfiles ADD COLUMN IF NOT EXISTS smartolt_olt_id text;
            `)
            if (await this.existeTabla(db, 'smartolt_instancias')) {
                // instancia de cada empresa: la propia de id menor; una compartida va a las empresas que
                // la usan sin instancia propia (o a la empresa de id menor si nadie la usa)
                const instancias = (await db
                    .from('integraciones.smartolt_instancias')
                    .orderBy('id')
                    .select('*')) as Array<Record<string, any>>
                const deEmpresa = new Map<number, Record<string, any>>()
                for (const i of instancias.filter((x) => x.empresa_id !== null)) {
                    if (!deEmpresa.has(Number(i.empresa_id))) deEmpresa.set(Number(i.empresa_id), i)
                }
                for (const i of instancias.filter((x) => x.empresa_id === null)) {
                    const resultado = await db.rawQuery(
                        `SELECT empresa_id FROM integraciones.equipos_servicio WHERE smartolt_instancia_id = ?
                         UNION SELECT empresa_id FROM integraciones.aprovisionamientos WHERE smartolt_instancia_id = ?`,
                        [i.id, i.id],
                    )
                    const usan = resultado.rows.map((f: { empresa_id: number }) =>
                        Number(f.empresa_id),
                    ) as number[]
                    if (usan.length === 0) {
                        const primera = await db.from('core.empresas').orderBy('id').select('id').first()
                        if (primera) usan.push(Number(primera.id))
                    }
                    for (const e of usan) if (!deEmpresa.has(e)) deEmpresa.set(e, i)
                }
                const acs = (await db.from('integraciones.acs_config').select('*')) as Array<
                    Record<string, any>
                >
                const empresas = new Set([...deEmpresa.keys(), ...acs.map((a) => Number(a.empresa_id))])
                for (const empresaId of empresas) {
                    const i = deEmpresa.get(empresaId)
                    const a = acs.find((x) => Number(x.empresa_id) === empresaId)
                    await db.table('integraciones.equipos_config').insert({
                        empresa_id: empresaId,
                        activo: Boolean(i?.activo || a?.activo),
                        smartolt_url: i?.url ?? null,
                        smartolt_token_cifrado: i?.token_cifrado ?? null,
                        smartolt_probado_en: i?.probado_en ?? null,
                        smartolt_prueba_ok: i?.prueba_ok ?? null,
                        smartolt_prueba_error: i?.prueba_error ?? null,
                        genieacs_url: a?.url ?? null,
                        genieacs_usuario: a?.usuario ?? null,
                        genieacs_clave_cifrada: a?.clave_cifrada ?? null,
                        genieacs_ca: a?.ca ?? null,
                        genieacs_probado_en: a?.probado_en ?? null,
                        genieacs_prueba_ok: a?.prueba_ok ?? null,
                        genieacs_prueba_error: a?.prueba_error ?? null,
                        pppoe_por_acs: a?.pppoe_por_acs ?? false,
                        version: a?.version ?? 1,
                    })
                    if (i) {
                        await db.rawQuery(
                            `UPDATE integraciones.equipos_perfiles p
                                SET empresa_id = ?, smartolt_olt_id = o.smartolt_olt_id
                               FROM integraciones.smartolt_olts o
                              WHERE o.id = p.smartolt_olt_ref_id AND o.instancia_id = ? AND p.empresa_id IS NULL`,
                            [empresaId, i.id],
                        )
                    }
                }
            }
            await db.rawQuery(`
                DELETE FROM integraciones.equipos_perfiles WHERE empresa_id IS NULL;
                DROP INDEX IF EXISTS integraciones.equipos_perfiles_olt_plan;
                ALTER TABLE integraciones.equipos_perfiles DROP COLUMN IF EXISTS smartolt_olt_ref_id;
                ALTER TABLE integraciones.equipos_perfiles ALTER COLUMN empresa_id SET NOT NULL;
                ALTER TABLE integraciones.equipos_perfiles ALTER COLUMN smartolt_olt_id SET NOT NULL;
                CREATE UNIQUE INDEX IF NOT EXISTS equipos_perfiles_unico
                    ON integraciones.equipos_perfiles (empresa_id, smartolt_olt_id, coalesce(plan_id, 0));
                ALTER TABLE integraciones.equipos_servicio DROP COLUMN IF EXISTS smartolt_instancia_id;
                ALTER TABLE integraciones.aprovisionamientos DROP COLUMN IF EXISTS smartolt_instancia_id;
                DROP TABLE IF EXISTS integraciones.smartolt_olts;
                DROP TABLE IF EXISTS integraciones.smartolt_instancias;
                DROP TABLE IF EXISTS integraciones.acs_config;
                DO $do$
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                        GRANT SELECT, INSERT, UPDATE ON integraciones.equipos_config TO argosisp_app;
                    END IF;
                END
                $do$;
            `)
            // Permisos: vuelven los viejos a quien tenga algún nuevo equivalente; los nuevos se quedan
            // (el seed de ACL los sincroniza con `core/permisos.ts` del código que corra)
            for (const [nombre, descripcion] of Object.entries(PERMISOS_VIEJOS)) {
                await db.rawQuery(
                    `INSERT INTO core.permisos (nombre, descripcion) VALUES (?, ?) ON CONFLICT (nombre) DO NOTHING`,
                    [nombre, descripcion],
                )
                const nuevos = Object.entries(PERMISOS_NUEVOS)
                    .filter(([, p]) => p.viejo === nombre)
                    .map(([n]) => n)
                await db.rawQuery(
                    `INSERT INTO core.roles_permisos (role_id, permiso_id)
                     SELECT DISTINCT rp.role_id, (SELECT id FROM core.permisos WHERE nombre = ?)
                       FROM core.roles_permisos rp JOIN core.permisos p ON p.id = rp.permiso_id
                      WHERE p.nombre = ANY(?::text[])
                     ON CONFLICT DO NOTHING`,
                    [nombre, nuevos],
                )
            }
        })
    }
}
