import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { CAMPOS_CUENTA_BANCARIA_CAMBIADA } from '#shared/eventos'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { cuentaBancariaUnica, eventoOutbox } from '#tests/notify/ayudas_notify'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import EditarCuentaBancaria from '#billing/actions/editar_cuenta_bancaria'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { EVENTOS_A_IRIS, EVENTOS_DESDE_080 } from '#integraciones/iris/envios'

/**
 * Webhooks Argos → Iris del contrato 0.8.0: `cuenta_bancaria.cambiada` (§7.8) solo a conectores con
 * contrato ≥ 0.8.0, con la empresa de la cuenta como alcance y solo nombres de campo (nunca número,
 * alias ni titular). Además, `"precio"` en `campos[]` de `servicio.config_cambiada` y de
 * `catalogo.cambiado` (§2.4) llega completo: el reenvío no recorta `campos[]`.
 */

const consumidor = new ConsumidorIris()

async function fijarConector(contrato: string | null) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: 'http://127.0.0.1:9/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar('secreto-del-receptor-de-iris-0123456789'),
        contrato,
    })
}

/** Usuario técnico «Iris» con alcance global (o solo `empresas`). */
async function usuarioTecnico(empresas: number[] | null = null) {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({}, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
}

/** Pasa por el consumidor un evento ya escrito en el outbox; devuelve el payload enviado o null. */
async function reenviar(outboxId: number) {
    const fila = await db.from('audit.outbox').where('id', outboxId).first()
    const payload = typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
    await consumidor.procesar({ id: outboxId, evento: fila.evento, payload })
    const envio = await db
        .from('integraciones.iris_envios')
        .where('evento_id', `argos-evt-${outboxId}`)
        .first()
    return envio ? (JSON.parse(envio.cuerpo).payload as Record<string, unknown>) : null
}

/** Último `cuenta_bancaria.cambiada` del outbox para la cuenta (el que emitió A3). */
async function outboxDeCuenta(cuentaId: number): Promise<number> {
    const fila = await db
        .from('audit.outbox')
        .where('evento', 'cuenta_bancaria.cambiada')
        .whereRaw(`(payload->>'cuenta_bancaria_id')::bigint = ?`, [cuentaId])
        .orderBy('id', 'desc')
        .first()
    return Number(fila.id)
}

async function evento(nombre: string, payload: Record<string, unknown>) {
    return reenviar(await eventoOutbox(nombre, payload))
}

test.group('integraciones · iris · webhooks 0.8.0 (cuentas bancarias y precio)', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_envios').delete()
        await usuarioTecnico()
        return async () => {
            await db.from('integraciones.iris_envios').delete()
            await db.from('integraciones.iris_conector').delete()
            await usuarioTecnico()
            // La empresa 2 de la prueba de alcance no debe quedar activa para el resto de la suite
            await soloEmpresaPrincipal()
        }
    })

    test('cuenta_bancaria.cambiada: 0.7.1 (o sin contrato) no la recibe; 0.8.0 sí', async ({ assert }) => {
        assert.deepEqual([...EVENTOS_DESDE_080], ['cuenta_bancaria.cambiada'])
        assert.isTrue(EVENTOS_DESDE_080.every((e) => (EVENTOS_A_IRIS as readonly string[]).includes(e)))
        assert.isTrue(consumidor.acepta('cuenta_bancaria.cambiada'))

        const cuenta = await cuentaBancariaUnica()
        const outboxId = await outboxDeCuenta(cuenta.id)

        await fijarConector('0.7.1')
        assert.isNull(await reenviar(outboxId))
        await fijarConector(null)
        assert.isNull(await reenviar(outboxId))
        await fijarConector('0.8.0')
        assert.isNotNull(await reenviar(outboxId))
        // Idempotente por id del outbox: un segundo paso no registra otro envío
        await reenviar(outboxId)
        assert.lengthOf(
            await db.from('integraciones.iris_envios').where('evento_id', `argos-evt-${outboxId}`),
            1,
        )
    })

    test('payload real de A3 al crear y al editar: solo nombres de campo, nunca valores', async ({
        assert,
    }) => {
        await fijarConector('0.8.0')
        const cuenta = await cuentaBancariaUnica()
        const creada = await reenviar(await outboxDeCuenta(cuenta.id))
        assert.deepEqual(creada, {
            cuenta_bancaria_id: cuenta.id,
            empresa_id: 1,
            campos: [...CAMPOS_CUENTA_BANCARIA_CAMBIADA],
            activa: true,
            creada: true,
        })

        const { version } = await db.from('billing.cuentas_bancarias').where('id', cuenta.id).first()
        await new EditarCuentaBancaria().execute(
            { id: cuenta.id, titular: 'Titular Secreto S.A.', tipo: 'monetaria', activa: false, version },
            contextoPrueba(),
        )
        const editada = await reenviar(await outboxDeCuenta(cuenta.id))
        assert.deepEqual(Object.keys(editada!).sort(), [
            'activa',
            'campos',
            'creada',
            'cuenta_bancaria_id',
            'empresa_id',
        ])
        assert.containsSubset(editada, {
            cuenta_bancaria_id: cuenta.id,
            empresa_id: 1,
            activa: false,
            creada: false,
        })
        assert.sameMembers(editada!.campos as string[], ['titular', 'tipo', 'activa'])

        const cuerpo = JSON.stringify([creada, editada])
        for (const valor of [cuenta.numero, cuenta.alias, 'Titular Secreto S.A.']) {
            assert.notInclude(cuerpo, valor)
        }
    })

    test('lista cerrada: un campo o un valor extra en el evento no sale hacia Iris', async ({ assert }) => {
        await fijarConector('0.8.0')
        const cuenta = await cuentaBancariaUnica()
        const enviado = await evento('cuenta_bancaria.cambiada', {
            cuenta_bancaria_id: cuenta.id,
            empresa_id: 1,
            campos: ['numero', 'numero', 'cuenta_id', 'titular'],
            activa: true,
            creada: false,
            numero: '0001-999-777',
            titular: 'Otro Titular',
        })
        assert.deepEqual(enviado, {
            cuenta_bancaria_id: cuenta.id,
            empresa_id: 1,
            campos: ['numero', 'titular'],
            activa: true,
            creada: false,
        })
    })

    test('alcance: una cuenta de una empresa fuera del alcance del usuario técnico no se envía', async ({
        assert,
    }) => {
        await fijarConector('0.8.0')
        const empresa2 = await crearEmpresaFila()
        const ajena = await cuentaBancariaUnica('Banrural', empresa2)
        const propia = await cuentaBancariaUnica('Banrural', 1)
        await usuarioTecnico([1])

        assert.isNull(await reenviar(await outboxDeCuenta(ajena.id)))
        assert.containsSubset(await reenviar(await outboxDeCuenta(propia.id)), { empresa_id: 1 })

        // Con la empresa en el alcance, la de la empresa 2 sí sale
        await usuarioTecnico([empresa2])
        assert.containsSubset(await reenviar(await outboxDeCuenta(ajena.id)), {
            cuenta_bancaria_id: ajena.id,
            empresa_id: empresa2,
        })
    })

    test('"precio" llega en campos[] de servicio.config_cambiada y catalogo.cambiado', async ({ assert }) => {
        // A1 aún no lo emite en esta rama: evento sintético del outbox; el reenvío conserva campos[]
        await fijarConector('0.8.0')
        const servicio = await evento('servicio.config_cambiada', {
            servicio_id: 1_999_999_980,
            empresa_id: 1,
            cliente_id: 1,
            campos: ['plan', 'precio'],
        })
        assert.deepEqual(servicio?.campos, ['plan', 'precio'])

        const plan = await evento('catalogo.cambiado', {
            catalogo: 'plan',
            id: 1_999_999_981,
            empresa_id: null,
            campos: ['precio'],
        })
        assert.deepEqual(plan, {
            catalogo: 'plan',
            id: 1_999_999_981,
            empresa_id: null,
            campos: ['precio'],
        })
    })
})
