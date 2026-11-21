import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { cuentaBancariaPrueba, escenario, generar, siguienteDeSecuencia } from '#tests/billing/ayudas_billing'
import { crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import CrearContactoCliente from '#core/actions/crear_contacto_cliente'

/**
 * `X-Iris-Contacto` (contrato Iris 0.10.1 §7.1 y §3.5) en lo de A3 que pide un contacto: el estado de
 * cuenta por servicio (`consultar`), las promesas y los comprobantes (`pagar`). 403
 * `servicio_fuera_del_contacto` y `permiso_de_contacto`; 422 si está mal formada; `titular` = como siempre.
 */

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
)

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

async function contacto(clienteId: number, datos: { servicios: number[] | null; pagar?: boolean }) {
    const n = await siguienteDeSecuencia('core.contactos_cliente')
    const numero = `+5025${String(n * 7919 + 1000000).slice(-7)}`
    const c = await new CrearContactoCliente().execute(
        {
            cliente_id: clienteId,
            nombre: unico('Contacto'),
            relacion: 'familiar',
            servicios: datos.servicios,
            permisos: { pagar: datos.pagar ?? true },
            telefonos: [{ numero, principal: true }],
        },
        contextoPrueba(),
    )
    return Number(c.contacto_id)
}

test.group('billing · X-Iris-Contacto (Iris 0.10.1 §7.1)', () => {
    test('estado de cuenta por servicio, promesas y comprobantes pedidos por un contacto', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const e = await escenario()
        const otro = await crearServicioFila({
            cliente_id: e.clienteId,
            plan_id: e.planId,
            plantilla_facturacion_id: e.plantillaId,
            fecha_instalacion: '2026-09-01',
        })
        await generar(e.servicioId, '2026-09-01')
        const acotado = await contacto(e.clienteId, { servicios: [e.servicioId], pagar: false })
        const todos = await contacto(e.clienteId, { servicios: null })
        const ajeno = await escenario()
        const deOtroCliente = await contacto(ajeno.clienteId, { servicios: null })

        const cuenta = (servicioId: number | null, valor: string | null) => {
            const p = client
                .get(
                    `/api/v1/clientes/${e.clienteId}/estado-cuenta${servicioId ? `?servicio_id=${servicioId}` : ''}`,
                )
                .bearerToken(iris)
            if (valor !== null) p.header('X-Iris-Contacto', valor)
            return p
        }
        await estado(cuenta(e.servicioId, String(acotado)), 200)
        const fuera = await estado(cuenta(otro, String(acotado)), 403)
        assert.match(fuera.body().type, /servicio_fuera_del_contacto$/)
        const sinServicio = await estado(cuenta(null, String(acotado)), 403)
        assert.match(sinServicio.body().type, /servicio_fuera_del_contacto$/)
        await estado(cuenta(otro, String(todos)), 200)
        const ajenoResp = await estado(cuenta(e.servicioId, String(deOtroCliente)), 403)
        assert.match(ajenoResp.body().type, /servicio_fuera_del_contacto$/)
        const malFormada = await estado(cuenta(e.servicioId, 'abc'), 422)
        assert.equal(malFormada.body().errors[0].field, 'X-Iris-Contacto')
        await estado(cuenta(e.servicioId, 'titular'), 200)
        await estado(cuenta(null, null), 200)

        // promesa: el contacto acotado no tiene `pagar`
        const promesa = (valor: string) =>
            client
                .post('/api/v1/promesas')
                .bearerToken(iris)
                .header('X-Iris-Actor', 'asistente_ia')
                .header('X-Iris-Conversacion', 'wa:c1')
                .header('Idempotency-Key', unico('iris:promesa'))
                .header('X-Iris-Contacto', valor)
                .json({ servicio_id: e.servicioId, vence_en: '2026-12-01' })
        const sinPagar = await estado(promesa(String(acotado)), 403)
        assert.match(sinPagar.body().type, /permiso_de_contacto$/)
        const promesaAjena = await estado(promesa(String(deOtroCliente)), 403)
        assert.match(promesaAjena.body().type, /servicio_fuera_del_contacto$/)

        // comprobante: mismo permiso, antes de leer el archivo
        const cuentaBancaria = await cuentaBancariaPrueba()
        const comprobante = (valor: string, servicioId: number) => {
            let p = client.post('/api/v1/comprobantes').bearerToken(iris)
            const campos: Record<string, string> = {
                cliente_id: String(e.clienteId),
                servicio_id: String(servicioId),
                metodo: 'deposito',
                cuenta_bancaria_id: String(cuentaBancaria.id),
                referencia: unico('boleta'),
                monto: '100.00',
                fecha_deposito: '2026-11-01',
                canal_contacto: 'whatsapp',
                leido_por: 'ia',
            }
            for (const [k, v] of Object.entries(campos)) p = p.field(k, v)
            return p
                .file('archivo', PNG, { filename: 'boleta.png' })
                .header('X-Iris-Actor', 'asistente_ia')
                .header('X-Iris-Conversacion', 'wa:c1')
                .header('Idempotency-Key', unico('iris:boleta'))
                .header('X-Iris-Contacto', valor)
        }
        const boletaSinPagar = await estado(comprobante(String(acotado), e.servicioId), 403)
        assert.match(boletaSinPagar.body().type, /permiso_de_contacto$/)
        const boletaFuera = await estado(comprobante(String(deOtroCliente), e.servicioId), 403)
        assert.match(boletaFuera.body().type, /servicio_fuera_del_contacto$/)
        const boletas = await db
            .from('billing.comprobantes')
            .where('cliente_id', e.clienteId)
            .count('* as n')
            .first()
        assert.equal(Number(boletas.n), 0)
    })
})
