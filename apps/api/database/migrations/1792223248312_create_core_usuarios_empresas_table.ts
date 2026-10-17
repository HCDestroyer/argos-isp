import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Multiempresa, paso 3 (`contratos/multiempresa.md`): alcance de los usuarios por empresa.
 *
 * - `core.usuarios.alcance_global`: ve y opera todas las empresas (y los consolidados). Los usuarios
 *   existentes (y los que se crean sin asignar empresas) quedan con alcance global, para que nada
 *   cambie con una sola empresa.
 * - `core.usuarios_empresas`: empresas que puede operar un usuario sin alcance global. El rol sigue
 *   siendo uno solo; la empresa acota dónde aplica.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.usuarios ADD COLUMN alcance_global boolean NOT NULL DEFAULT true;

            CREATE TABLE core.usuarios_empresas (
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id) ON DELETE CASCADE,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (usuario_id, empresa_id)
            );
            CREATE INDEX usuarios_empresas_empresa ON core.usuarios_empresas (empresa_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.usuarios_empresas;
            ALTER TABLE core.usuarios DROP COLUMN IF EXISTS alcance_global;
        `)
    }
}
