import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { cifrar, descifrar } from '#shared/cifrado'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { limpiarEquipos } from '#tests/integraciones/equipos_simulado'
import MigracionSeparar from '#database/migrations/1795636688259_separar_smartolt_acs'

/**
 * Migración `separar_smartolt_acs` (`contratos/equipos-olt-acs.md` §3.7, lote 1, casos 1 a 7): se
 * corre el `down` (vuelve `equipos_config`), se insertan filas con la forma vieja y se corre el `up`.
 * Todo en una transacción que se revierte al final: las demás pruebas no ven nada.
 */

const NOMBRE = '1795636688259_separar_smartolt_acs'
const TOKEN = 'token-smartolt-migracion-1'
const CLAVE = 'clave-acs-migracion-1'

async function enMigracionRevertida(
    preparar: (trx: TransactionClientContract) => Promise<void>,
    revisar: (trx: TransactionClientContract) => Promise<void>,
) {
    const trx = await db.transaction()
    try {
        await new MigracionSeparar(trx, NOMBRE, false).execDown()
        await preparar(trx)
        await new MigracionSeparar(trx, NOMBRE, false).execUp()
        await revisar(trx)
    } finally {
        await trx.rollback()
    }
}

const probadoEn = new Date('2026-11-20T15:30:00.000Z')

function filaVieja(empresaId: number, extra: Record<string, unknown> = {}) {
    return {
        empresa_id: empresaId,
        activo: true,
        smartolt_url: 'https://norte.smartolt.com',
        smartolt_token_cifrado: cifrar(TOKEN),
        smartolt_probado_en: probadoEn,
        smartolt_prueba_ok: true,
        smartolt_prueba_error: null,
        genieacs_url: 'https://acs.isp.gt/nbi',
        genieacs_usuario: 'argos',
        genieacs_clave_cifrada: cifrar(CLAVE),
        genieacs_probado_en: probadoEn,
        genieacs_prueba_ok: true,
        genieacs_prueba_error: null,
        pppoe_por_acs: true,
        version: 4,
        ...extra,
    }
}

test.group('Equipos · migración separar SmartOLT y ACS (§3.7)', (group) => {
    group.each.setup(async () => {
        await limpiarEquipos()
    })

    test('1 y 5: SmartOLT y ACS probados → instancia y ACS operativos; secretos y prueba iguales; equipo con su instancia', async ({
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const servicioId = await crearServicioFila({ cliente_id: clienteId, empresa_id: 1 })
        await enMigracionRevertida(
            async (trx) => {
                await trx.table('integraciones.equipos_config').insert(filaVieja(1))
                await trx.table('integraciones.equipos_servicio').insert({
                    servicio_id: servicioId,
                    empresa_id: 1,
                    tipo: 'ont',
                    serie: 'ZTEGMIGRA001',
                    smartolt_external_id: `argos${servicioId}`,
                })
            },
            async (trx) => {
                const instancias = await trx.from('integraciones.smartolt_instancias')
                assert.lengthOf(instancias, 1)
                const i = instancias[0]
                assert.equal(Number(i.empresa_id), 1)
                assert.equal(i.nombre, 'SmartOLT')
                assert.equal(i.url, 'https://norte.smartolt.com')
                assert.isTrue(i.activo)
                assert.isTrue(i.prueba_ok)
                assert.equal(new Date(i.probado_en).toISOString(), probadoEn.toISOString())
                assert.equal(descifrar(i.token_cifrado), TOKEN)
                assert.equal(i.version, 1)

                const acs = await trx.from('integraciones.acs_config').where('empresa_id', 1).firstOrFail()
                assert.isTrue(acs.activo)
                assert.isTrue(acs.prueba_ok)
                assert.isTrue(acs.pppoe_por_acs)
                assert.equal(acs.version, 4)
                assert.equal(new Date(acs.probado_en).toISOString(), probadoEn.toISOString())
                assert.equal(descifrar(acs.clave_cifrada), CLAVE)

                const equipo = await trx
                    .from('integraciones.equipos_servicio')
                    .where('servicio_id', servicioId)
                    .firstOrFail()
                assert.equal(Number(equipo.smartolt_instancia_id), Number(i.id))
                assert.isNull(
                    await trx
                        .from('pg_tables')
                        .where({ schemaname: 'integraciones', tablename: 'equipos_config' })
                        .first(),
                )
            },
        )
    })

    test('2: solo ACS → acs_config y ninguna instancia', async ({ assert }) => {
        await enMigracionRevertida(
            async (trx) => {
                await trx.table('integraciones.equipos_config').insert(
                    filaVieja(1, {
                        smartolt_url: null,
                        smartolt_token_cifrado: null,
                        smartolt_probado_en: null,
                        smartolt_prueba_ok: null,
                    }),
                )
            },
            async (trx) => {
                assert.lengthOf(await trx.from('integraciones.smartolt_instancias'), 0)
                const acs = await trx.from('integraciones.acs_config').where('empresa_id', 1).firstOrFail()
                assert.isTrue(acs.activo)
                assert.equal(acs.url, 'https://acs.isp.gt/nbi')
            },
        )
    })

    test('3: apagada con los dos probados → los dos apagados, pruebas conservadas', async ({ assert }) => {
        await enMigracionRevertida(
            async (trx) => {
                await trx.table('integraciones.equipos_config').insert(filaVieja(1, { activo: false }))
            },
            async (trx) => {
                const i = await trx.from('integraciones.smartolt_instancias').firstOrFail()
                assert.isFalse(i.activo)
                assert.isTrue(i.prueba_ok)
                const acs = await trx.from('integraciones.acs_config').where('empresa_id', 1).firstOrFail()
                assert.isFalse(acs.activo)
                assert.isTrue(acs.prueba_ok)
            },
        )
    })

    test('4: dos perfiles de la OLT 1 → una OLT manual y dos perfiles con su referencia', async ({
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const servicioId = await crearServicioFila({ cliente_id: clienteId, empresa_id: 1 })
        const { plan_id: planId } = await db.from('core.servicios').where('id', servicioId).firstOrFail()
        await enMigracionRevertida(
            async (trx) => {
                await trx.table('integraciones.equipos_config').insert(filaVieja(1))
                await trx.table('integraciones.equipos_perfiles').multiInsert([
                    { empresa_id: 1, smartolt_olt_id: '1', plan_id: planId, authorization_preset_id: 31 },
                    { empresa_id: 1, smartolt_olt_id: '1', plan_id: null, authorization_preset_id: 32 },
                ])
            },
            async (trx) => {
                const olts = await trx.from('integraciones.smartolt_olts')
                assert.lengthOf(olts, 1)
                assert.equal(olts[0].smartolt_olt_id, '1')
                assert.equal(olts[0].origen, 'manual')
                assert.isNull(olts[0].nombre)
                assert.isTrue(olts[0].presente)
                const perfiles = await trx
                    .from('integraciones.equipos_perfiles')
                    .orderBy('authorization_preset_id')
                assert.deepEqual(
                    perfiles.map((p) => [
                        Number(p.smartolt_olt_ref_id),
                        p.plan_id === null ? null : Number(p.plan_id),
                        p.authorization_preset_id,
                    ]),
                    [
                        [Number(olts[0].id), Number(planId), 31],
                        [Number(olts[0].id), null, 32],
                    ],
                )
                assert.notProperty(perfiles[0], 'empresa_id')
                assert.notProperty(perfiles[0], 'smartolt_olt_id')
            },
        )
    })

    test('6: un rol con equipos.configurar queda con los smartolt.* de escritura y acs.configurar; equipos.* ya no existe', async ({
        assert,
    }) => {
        const nombreRol = unico('rol-equipos')
        await enMigracionRevertida(
            async (trx) => {
                const [rol] = await trx
                    .table('core.roles')
                    .insert({ nombre: nombreRol, descripcion: 'prueba' })
                    .returning('id')
                await trx.rawQuery(
                    `INSERT INTO core.roles_permisos (role_id, permiso_id)
                     SELECT ?, id FROM core.permisos WHERE nombre = 'equipos.configurar'`,
                    [rol.id],
                )
            },
            async (trx) => {
                const filas = await trx
                    .from('core.roles_permisos as rp')
                    .join('core.permisos as p', 'p.id', 'rp.permiso_id')
                    .join('core.roles as r', 'r.id', 'rp.role_id')
                    .where('r.nombre', nombreRol)
                    .select('p.nombre')
                const permisos = filas.map((f) => f.nombre as string)
                assert.sameMembers(permisos, [
                    'smartolt.crear_instancia',
                    'smartolt.editar_instancia',
                    'smartolt.eliminar_instancia',
                    'smartolt.vincular_olt',
                    'acs.configurar',
                ])
                assert.lengthOf(await trx.from('core.permisos').whereLike('nombre', 'equipos.%'), 0)
                const cambio = await trx
                    .from('audit.cambios')
                    .where({
                        entidad_tipo: 'rol',
                        request_id: 'migracion:1795636688259_separar_smartolt_acs',
                    })
                    .orderBy('id', 'desc')
                    .first()
                assert.isNotNull(cambio)
            },
        )
    })

    test('7: dos empresas con la misma URL de SmartOLT → una instancia compartida (empresa_id null)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        try {
            await enMigracionRevertida(
                async (trx) => {
                    await trx.table('integraciones.equipos_config').insert(filaVieja(1))
                    await trx.table('integraciones.equipos_config').insert(
                        filaVieja(e.B, {
                            smartolt_url: 'https://norte.smartolt.com',
                            genieacs_url: null,
                            pppoe_por_acs: false,
                        }),
                    )
                },
                async (trx) => {
                    const instancias = await trx.from('integraciones.smartolt_instancias')
                    assert.lengthOf(instancias, 1)
                    assert.isNull(instancias[0].empresa_id)
                    const aviso = await trx
                        .from('audit.acciones')
                        .where({
                            accion: 'equipos.separar_smartolt_acs',
                            request_id: 'migracion:1795636688259_separar_smartolt_acs',
                        })
                        .whereRaw(`entrada ->> 'motivo' = 'smartolt_compartida'`)
                        .first()
                    assert.isNotNull(aviso)
                    assert.notInclude(JSON.stringify(aviso), TOKEN)
                    // B no tenía ACS
                    assert.isNull(await trx.from('integraciones.acs_config').where('empresa_id', e.B).first())
                },
            )
        } finally {
            await soloEmpresaPrincipal()
        }
    })
})
