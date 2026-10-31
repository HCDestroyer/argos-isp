import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * PPPoE sin RADIUS (`contratos/pppoe-local.md`, pedido del PM del 30 oct): en un router
 * `modo_seguridad = 'api'` las sesiones no llegan por accounting, las abre y cierra el sondeo de
 * `/ppp/active` (`sesiones.sondear_ppp`).
 *
 * - `origen`: `accounting` (RADIUS, como hasta hoy) o `sondeo`. `coa` solo mira `accounting`.
 * - `nas_ip` deja de ser NOT NULL: un router sin RADIUS puede no tener `nas_ip`. Solo una sesión de
 *   `sondeo` puede ir sin ella (`sesiones_nas_ip_accounting_check`).
 * - Una sesión de sondeo es única por router y `acct_session_id` (`sondeo:<session-id>`): el UNIQUE
 *   `(nas_ip, acct_session_id)` no la protege con `nas_ip` null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.sesiones
                ADD COLUMN origen text NOT NULL DEFAULT 'accounting'
                    CONSTRAINT sesiones_origen_check CHECK (origen IN ('accounting', 'sondeo')),
                ALTER COLUMN nas_ip DROP NOT NULL,
                ADD CONSTRAINT sesiones_nas_ip_accounting_check
                    CHECK (origen = 'sondeo' OR nas_ip IS NOT NULL);
            CREATE UNIQUE INDEX sesiones_sondeo_unica ON network.sesiones (router_id, acct_session_id)
                WHERE origen = 'sondeo';
        `)
    }

    async down() {
        // Las sesiones de sondeo no tienen sentido sin la columna: se quitan (historial de un router
        // sin RADIUS, sin contadores).
        this.schema.raw(`
            DROP INDEX IF EXISTS network.sesiones_sondeo_unica;
            DELETE FROM network.sesiones WHERE origen = 'sondeo';
            ALTER TABLE network.sesiones
                DROP CONSTRAINT IF EXISTS sesiones_nas_ip_accounting_check,
                DROP COLUMN origen,
                ALTER COLUMN nas_ip SET NOT NULL;
        `)
    }
}
