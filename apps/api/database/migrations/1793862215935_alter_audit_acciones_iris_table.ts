import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.6.0 §7.1: las llamadas del usuario técnico Iris a las rutas de pagos y atención
 * llevan `X-Iris-Actor` (`asistente_ia` | `usuario:<id en Iris>`) y `X-Iris-Conversacion`. Argos
 * las guarda en la fila de `audit.acciones` para poder buscarlas (bitácora,
 * `GET /bitacora/acciones?iris_conversacion=`). Columnas nuevas y nulas: las filas existentes no
 * se tocan (la tabla es de solo inserción). El índice parcial cubre solo las filas de Iris.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE audit.acciones
                ADD COLUMN IF NOT EXISTS iris_actor varchar(80),
                ADD COLUMN IF NOT EXISTS iris_conversacion varchar(128);
            CREATE INDEX IF NOT EXISTS acciones_iris_conversacion
                ON audit.acciones (iris_conversacion, created_at)
                WHERE iris_conversacion IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS audit.acciones_iris_conversacion;
            ALTER TABLE audit.acciones
                DROP COLUMN IF EXISTS iris_conversacion,
                DROP COLUMN IF EXISTS iris_actor;
        `)
    }
}
