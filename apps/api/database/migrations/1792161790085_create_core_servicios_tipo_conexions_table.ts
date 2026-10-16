import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Servicios WISP sin PPPoE (decisión del PM, día 4; `.claude/integration/contratos/routeros.md`).
 *
 * - `tipo_conexion`: `pppoe` (por defecto, todos los existentes), `ip_estatica` o `dhcp_fija`.
 * - `amarre_ip_mac`: ARP estático IP-MAC en el router (opcional, solo lo aplica el dispatcher).
 * - CHECK `servicios_credenciales_por_tipo`: `pppoe` exige `user_ppp` y `pass_ppp`; los otros
 *   tipos los dejan en null (sin credenciales que puedan llegar a RADIUS).
 * - CHECK `servicios_dhcp_fija_mac`: `dhcp_fija` exige `mac` (el tipo `macaddr` ya valida el formato).
 * - Trigger de restricción diferido `servicios_sin_pppoe_ipv4`: un servicio no PPPoE que no está
 *   retirado debe tener una IPv4 vigente en `network.ipv4_asignaciones` al confirmar la
 *   transacción (la acción inserta el servicio antes que su asignación).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios
                ADD COLUMN tipo_conexion text NOT NULL DEFAULT 'pppoe'
                    CONSTRAINT servicios_tipo_conexion
                    CHECK (tipo_conexion IN ('pppoe', 'ip_estatica', 'dhcp_fija')),
                ADD COLUMN amarre_ip_mac boolean NOT NULL DEFAULT false,
                ALTER COLUMN user_ppp DROP NOT NULL,
                ALTER COLUMN pass_ppp DROP NOT NULL,
                ADD CONSTRAINT servicios_credenciales_por_tipo CHECK (
                    (tipo_conexion = 'pppoe' AND user_ppp IS NOT NULL AND pass_ppp IS NOT NULL)
                    OR (tipo_conexion <> 'pppoe' AND user_ppp IS NULL AND pass_ppp IS NULL)
                ),
                ADD CONSTRAINT servicios_dhcp_fija_mac CHECK (tipo_conexion <> 'dhcp_fija' OR mac IS NOT NULL);
            CREATE INDEX servicios_tipo_conexion ON core.servicios (tipo_conexion);

            CREATE FUNCTION core.servicios_sin_pppoe_exigir_ipv4(p_servicio_id bigint) RETURNS void
            LANGUAGE plpgsql AS $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM core.servicios s
                     WHERE s.id = p_servicio_id
                       AND s.tipo_conexion <> 'pppoe'
                       AND s.estado <> 'retirado'
                       AND NOT EXISTS (
                           SELECT 1 FROM network.ipv4_asignaciones a
                            WHERE a.servicio_id = s.id AND a.fin IS NULL
                       )
                ) THEN
                    RAISE EXCEPTION 'El servicio % no es PPPoE y no tiene IPv4 asignada', p_servicio_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'servicios_sin_pppoe_ipv4';
                END IF;
            END;
            $$;

            CREATE FUNCTION core.servicios_sin_pppoe_ipv4_servicio() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM core.servicios_sin_pppoe_exigir_ipv4(NEW.id);
                RETURN NULL;
            END;
            $$;

            CREATE FUNCTION core.servicios_sin_pppoe_ipv4_asignacion() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM core.servicios_sin_pppoe_exigir_ipv4(OLD.servicio_id);
                RETURN NULL;
            END;
            $$;

            CREATE CONSTRAINT TRIGGER servicios_sin_pppoe_ipv4
                AFTER INSERT OR UPDATE OF tipo_conexion, estado ON core.servicios
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION core.servicios_sin_pppoe_ipv4_servicio();

            CREATE CONSTRAINT TRIGGER ipv4_asignaciones_sin_pppoe
                AFTER UPDATE OF fin OR DELETE ON network.ipv4_asignaciones
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION core.servicios_sin_pppoe_ipv4_asignacion();
        `)
    }

    /** Vuelve a exigir credenciales: los servicios sin PPPoE reciben un `user_ppp` de marcador. */
    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS ipv4_asignaciones_sin_pppoe ON network.ipv4_asignaciones;
            DROP TRIGGER IF EXISTS servicios_sin_pppoe_ipv4 ON core.servicios;
            DROP FUNCTION IF EXISTS core.servicios_sin_pppoe_ipv4_asignacion();
            DROP FUNCTION IF EXISTS core.servicios_sin_pppoe_ipv4_servicio();
            DROP FUNCTION IF EXISTS core.servicios_sin_pppoe_exigir_ipv4(bigint);
            DROP INDEX IF EXISTS core.servicios_tipo_conexion;
            ALTER TABLE core.servicios
                DROP CONSTRAINT IF EXISTS servicios_dhcp_fija_mac,
                DROP CONSTRAINT IF EXISTS servicios_credenciales_por_tipo,
                DROP COLUMN IF EXISTS amarre_ip_mac,
                DROP COLUMN IF EXISTS tipo_conexion;
            UPDATE core.servicios
               SET user_ppp = coalesce(user_ppp, 'sin-pppoe-' || id), pass_ppp = coalesce(pass_ppp, '')
             WHERE user_ppp IS NULL OR pass_ppp IS NULL;
            ALTER TABLE core.servicios
                ALTER COLUMN user_ppp SET NOT NULL,
                ALTER COLUMN pass_ppp SET NOT NULL;
        `)
    }
}
