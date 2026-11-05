import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.6.3: un `atk_` canjeado que Iris no usa no queda vivo.
 *
 * - `canje_confirmado_en`: cuándo se vio el primer uso autenticado del `atk_` del último canje
 *   (`core.tokens_api.ultimo_uso`). null mientras el canje está pendiente de confirmar: si pasan
 *   24 h sin uso, el cron `iris_canjes_sin_uso` revoca el token y desconecta el conector.
 * - `desconectado_en` y `motivo_desconexion`: el conector quedó sin credenciales porque Iris revocó
 *   su token (`revocado_por_iris`, `POST /integraciones/iris/conexion/revocar`) o porque el canje
 *   venció sin uso (`canje_sin_uso`). Un canje nuevo los vuelve a null.
 *
 * Las filas existentes se tratan como confirmadas (`canje_confirmado_en = now()`): el barrido solo
 * aplica a los canjes hechos desde esta versión.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                ADD COLUMN canje_confirmado_en timestamptz,
                ADD COLUMN desconectado_en timestamptz,
                ADD COLUMN motivo_desconexion text
                    CHECK (motivo_desconexion IN ('revocado_por_iris', 'canje_sin_uso')),
                ADD CONSTRAINT iris_conector_desconexion
                    CHECK ((desconectado_en IS NULL) = (motivo_desconexion IS NULL));
            UPDATE integraciones.iris_conector SET canje_confirmado_en = now();
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                DROP CONSTRAINT IF EXISTS iris_conector_desconexion,
                DROP COLUMN IF EXISTS motivo_desconexion,
                DROP COLUMN IF EXISTS desconectado_en,
                DROP COLUMN IF EXISTS canje_confirmado_en;
        `)
    }
}
