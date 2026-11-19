import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Privilegios de `argosisp_app` en las tablas de inventario de la fase D.
 *
 * En producción la API conecta con un usuario miembro de `argosisp_app`, no con el dueño de las
 * tablas (`1760900000011_crear_rol_app`). El esquema `inventario` no está en los `ALTER DEFAULT
 * PRIVILEGES` de ese rol y las migraciones de la fase D (`1793406924030`, `1793407866836`,
 * `1793408833997`) crearon sus tablas sin `GRANT`: `GET /inventario/configuracion` y
 * `GET /inventario/ia/configuracion` respondían 500 (`permission denied for table ...`), igual que
 * las órdenes de traslado, los tipos de producto y los borradores de compra.
 *
 *  - SELECT, INSERT y UPDATE (sin DELETE ni TRUNCATE, como el resto del inventario) en esas tablas.
 *  - Las secuencias del esquema y las tablas que agreguen las migraciones después heredan los mismos
 *    privilegios (`ALTER DEFAULT PRIVILEGES IN SCHEMA inventario`), para que no vuelva a pasar.
 *
 * Sin el rol (instalación sin privilegio para crearlo) no hace nada, como `1760900000011`.
 */
const TABLAS = [
    'inventario.configuracion',
    'inventario.ia_configuracion',
    'inventario.ordenes_traslado',
    'inventario.ordenes_traslado_lineas',
    'inventario.ordenes_traslado_unidades',
    'inventario.tipos_producto',
    'inventario.compras_borradores',
    'inventario.productos_codigos_proveedor',
].join(', ')

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT USAGE ON SCHEMA inventario TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON ${TABLAS} TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON ${TABLAS} FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO argosisp_app;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA inventario
                        GRANT SELECT, INSERT, UPDATE ON TABLES TO argosisp_app;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA inventario
                        GRANT USAGE, SELECT ON SEQUENCES TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    ALTER DEFAULT PRIVILEGES IN SCHEMA inventario
                        REVOKE SELECT, INSERT, UPDATE ON TABLES FROM argosisp_app;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA inventario
                        REVOKE USAGE, SELECT ON SEQUENCES FROM argosisp_app;
                    REVOKE ALL ON ${TABLAS} FROM argosisp_app;
                END IF;
            END $$;
        `)
    }
}
