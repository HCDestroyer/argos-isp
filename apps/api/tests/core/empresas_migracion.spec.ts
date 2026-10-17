import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import MigracionEmpresas from '#database/migrations/1792220280061_create_core_empresas_multiempresas_table'
import MigracionServicios from '#database/migrations/1792221554003_create_core_servicios_empresas_table'
import MigracionUsuarios from '#database/migrations/1792223248312_create_core_usuarios_empresas_table'
import { verEmpresa } from '#portal/empresa'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Multiempresa, paso 5: la migración de los datos existentes. Cada prueba recrea el estado anterior
 * dentro de una transacción, corre el `up()` de la migración y revierte todo al terminar.
 */

async function enTransaccion(cuerpo: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await cuerpo(trx)
    } finally {
        await trx.rollback()
    }
}

/** Aparta `core.empresas` (y sus nombres de índice y secuencia) y recrea la antigua `core.empresa`. */
async function estadoAnteriorEmpresas(trx: TransactionClientContract) {
    await trx.rawQuery(`
        ALTER TABLE core.empresas RENAME TO empresas_apartada;
        ALTER INDEX core.empresas_pkey RENAME TO empresas_apartada_pkey;
        ALTER INDEX core.empresas_nit_activa_unico RENAME TO empresas_apartada_nit;
        ALTER SEQUENCE core.empresas_id_seq RENAME TO empresas_apartada_id_seq;
        CREATE TABLE core.empresa (
            id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            nombre text NOT NULL,
            nit text,
            direccion text,
            telefono text,
            telefono_alterno text,
            whatsapp text,
            correo text,
            horario text,
            instrucciones_pago text,
            version integer NOT NULL DEFAULT 1,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
    `)
}

test.group('Multiempresa: migración de los datos existentes', () => {
    test('la fila de core.empresa pasa a ser la empresa 1 con los mismos datos', async ({ assert }) => {
        await enTransaccion(async (trx) => {
            await estadoAnteriorEmpresas(trx)
            await trx.rawQuery(`
                INSERT INTO core.empresa (id, nombre, nit, direccion, telefono, whatsapp, horario,
                                          instrucciones_pago, version)
                VALUES (1, 'Cable Norte', '12345679', '4a calle 5-10, Huehuetenango', '7764-0000',
                        '5555-0000', 'L-V 8 a 17', 'Escribe tu NIT en la boleta', 4)
            `)
            await new MigracionEmpresas(trx, 'empresas', false).execUp()

            const empresa = await trx.from('core.empresas').where('id', 1).firstOrFail()
            assert.include(empresa, {
                nombre_comercial: 'Cable Norte',
                razon_social: 'Cable Norte',
                nit: '12345679',
                direccion_fiscal: '4a calle 5-10, Huehuetenango',
                telefono: '7764-0000',
                whatsapp: '5555-0000',
                activa: true,
                version: 4,
            })
            const vieja = await trx.rawQuery(`SELECT to_regclass('core.empresa') AS tabla`)
            assert.isNull(vieja.rows[0].tabla)

            // la vista de siempre (portal, documentos, notificaciones) no cambia
            assert.deepEqual(await verEmpresa(trx), {
                nombre: 'Cable Norte',
                nit: '12345679',
                direccion: '4a calle 5-10, Huehuetenango',
                telefono: '7764-0000',
                telefono_alterno: null,
                whatsapp: '5555-0000',
                correo: null,
                horario: 'L-V 8 a 17',
                instrucciones_pago: 'Escribe tu NIT en la boleta',
                version: 4,
            })

            // la identidad sigue después de la 1
            const [nueva] = await trx
                .insertQuery()
                .table('core.empresas')
                .insert({ nombre_comercial: 'Sucursal' })
                .returning('id')
            assert.equal(nueva.id, 2)
        })
    })

    test('sin fila en core.empresa la 1 queda con versión 0 y valores por defecto', async ({ assert }) => {
        await enTransaccion(async (trx) => {
            await estadoAnteriorEmpresas(trx)
            await new MigracionEmpresas(trx, 'empresas', false).execUp()
            const empresa = await trx.from('core.empresas').where('id', 1).firstOrFail()
            assert.include(empresa, { version: 0, activa: true })
            const vista = await verEmpresa(trx)
            assert.equal(vista.version, 0)
            assert.equal(vista.nombre, process.env.NOTIFY_EMPRESA_NOMBRE || 'ArgosIsp')
        })
    })

    test('los servicios existentes quedan en la empresa 1; zonas y routers sin sugerida', async ({
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const servicios = [
            await crearServicioFila({ cliente_id: clienteId }),
            await crearServicioFila({ cliente_id: clienteId }),
        ]
        await enTransaccion(async (trx) => {
            await trx.rawQuery(`
                DROP TRIGGER servicios_empresa_por_defecto ON core.servicios;
                DROP FUNCTION core.servicios_empresa_por_defecto();
                ALTER TABLE core.servicios DROP COLUMN empresa_id;
                ALTER TABLE core.zonas DROP COLUMN empresa_sugerida_id;
                ALTER TABLE network.routers DROP COLUMN empresa_sugerida_id;
            `)
            await new MigracionServicios(trx, 'servicios', false).execUp()

            const filas = await trx.from('core.servicios').whereIn('id', servicios).select('empresa_id')
            assert.deepEqual(
                filas.map((f) => f.empresa_id),
                [1, 1],
            )
            const sinEmpresa = await trx.from('core.servicios').whereNull('empresa_id').count('* as n')
            assert.equal(Number(sinEmpresa[0].n), 0)
            const columna = await trx.rawQuery(`
                SELECT is_nullable, column_default FROM information_schema.columns
                 WHERE table_schema = 'core' AND table_name = 'servicios' AND column_name = 'empresa_id'
            `)
            assert.deepEqual(columna.rows[0], { is_nullable: 'NO', column_default: null })
            const sugeridas = await trx
                .from('network.routers')
                .whereNotNull('empresa_sugerida_id')
                .count('* as n')
            assert.equal(Number(sugeridas[0].n), 0)
        })
    })

    test('los usuarios existentes quedan con alcance global', async ({ assert }) => {
        await enTransaccion(async (trx) => {
            await trx.rawQuery(`
                DROP TABLE core.usuarios_empresas;
                ALTER TABLE core.usuarios DROP COLUMN alcance_global;
            `)
            await new MigracionUsuarios(trx, 'usuarios', false).execUp()
            const sinGlobal = await trx.from('core.usuarios').where('alcance_global', false).count('* as n')
            assert.equal(Number(sinGlobal[0].n), 0)
            const total = await trx.from('core.usuarios').count('* as n')
            assert.isAbove(Number(total[0].n), 0)
        })
    })
})
