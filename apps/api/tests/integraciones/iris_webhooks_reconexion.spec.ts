import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import {
    AHORA_PROMESAS,
    cuentaBancariaPrueba,
    diasDespues,
    eventosDe,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import type { MotivoReconexion } from '#billing/reglas_promesa'
import RegistrarReconexionTemporal from '#billing/actions/registrar_reconexion_temporal'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import { ConsumidorIris } from '#integraciones/iris/consumidor'

/**
 * Webhooks `promesa.*` a Iris con `motivo_reconexion` (A3, 17 nov 2026): `fuera_de_horario` o
 * `sin_personal` en una reconexión temporal, null en una promesa común. Aditivo, sin condición de
 * versión. Un evento viejo del outbox (sin la clave) lo toma de `billing.promesas`. Flujo real:
 * la acción de A3 escribe el evento en el outbox y el consumidor de Iris arma el webhook en
 * `integraciones.iris_envios`.
 */

const consumidor = new ConsumidorIris()

async function fijarConector(contrato: string) {
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

/** El usuario técnico Iris existe y tiene alcance global (el webhook pasa por su alcance). */
async function usuarioTecnicoGlobal() {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
}

/** Reconexión temporal real (acción de A3) sobre un comprobante pendiente del servicio cortado. */
async function reconexion(motivo: MotivoReconexion): Promise<number> {
    const datos = await servicioCortado()
    await db
        .from('billing.plantillas_facturacion')
        .where('id', datos.plantillaId)
        .update({
            reglas_promesa: JSON.stringify(
                normalizarReglasPromesa({
                    no_exceder_siguiente_facturacion: false,
                    reconexion_temporal: { permitida: true },
                }),
            ),
        })
    const cuenta = await cuentaBancariaPrueba()
    const [comprobante] = (await db
        .table('billing.comprobantes')
        .insert({
            empresa_id: 1,
            cliente_id: datos.clienteId,
            servicio_id: datos.servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuenta.id,
            referencia: await unicoBd('boleta-motivo'),
            monto: '300.00',
            fecha_deposito: '2026-10-08',
            archivo: `2026/10/${unico('x')}.png`,
            archivo_tipo: 'image/png',
            archivo_tamano: 10,
            canal: 'panel',
            estado: 'pendiente',
        })
        .returning('id')) as Array<{ id: number }>
    const r = await new RegistrarReconexionTemporal().execute(
        { comprobante_id: comprobante!.id, motivo, canal: 'operador', ahora: AHORA_PROMESAS },
        contextoPrueba(),
    )
    return r.promesa_id
}

/** Pasa el `promesa.creada` del outbox por el consumidor y devuelve el payload del webhook. */
async function webhook(promesaId: number, quitarClave = false) {
    const [ev] = await eventosDe('promesa.creada', 'promesa_id', promesaId)
    const payload = { ...(typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload) }
    if (quitarClave) delete payload.motivo_reconexion
    await fijarConector('0.7.1')
    try {
        await consumidor.procesar({ id: Number(ev.id), evento: 'promesa.creada', payload })
        const fila = await db
            .from('integraciones.iris_envios')
            .where('evento_id', `argos-evt-${ev.id}`)
            .firstOrFail()
        return JSON.parse(fila.cuerpo).payload as Record<string, unknown>
    } finally {
        await db.from('integraciones.iris_envios').delete()
        await db.from('integraciones.iris_conector').delete()
    }
}

test.group('integraciones · iris · webhooks promesa.* (motivo_reconexion)', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_envios').delete()
        await db.from('integraciones.iris_conector').delete()
        await usuarioTecnicoGlobal()
    })
    group.teardown(async () => {
        await soloEmpresaPrincipal()
    })

    test('reconexión sin_personal: el webhook trae motivo_reconexion sin_personal', async ({ assert }) => {
        const promesaId = await reconexion('sin_personal')
        const enviado = await webhook(promesaId)
        assert.containSubset(enviado, {
            promesa_id: promesaId,
            tipo: 'reconexion_temporal',
            motivo_reconexion: 'sin_personal',
        })
        assert.notProperty(enviado, 'origen')
    })

    test('reconexión fuera_de_horario: el webhook trae motivo_reconexion fuera_de_horario', async ({
        assert,
    }) => {
        const promesaId = await reconexion('fuera_de_horario')
        const enviado = await webhook(promesaId)
        assert.containSubset(enviado, {
            promesa_id: promesaId,
            tipo: 'reconexion_temporal',
            motivo_reconexion: 'fuera_de_horario',
        })
    })

    test('promesa común: motivo_reconexion null', async ({ assert }) => {
        const datos = await servicioCortado()
        const promesa = await new CrearPromesaPago().execute(
            {
                servicio_id: datos.servicioId,
                vence_en: diasDespues(2),
                monto: '300.00',
                canal: 'operador',
                ahora: AHORA_PROMESAS,
            },
            contextoPrueba(),
        )
        const enviado = await webhook(promesa.id)
        assert.property(enviado, 'motivo_reconexion')
        assert.isNull(enviado.motivo_reconexion)
        assert.equal(enviado.tipo, 'promesa')
    })

    test('evento viejo sin la clave: se completa con billing.promesas', async ({ assert }) => {
        const promesaId = await reconexion('sin_personal')
        const enviado = await webhook(promesaId, true)
        assert.equal(enviado.motivo_reconexion, 'sin_personal')
    })
})
