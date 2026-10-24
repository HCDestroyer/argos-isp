import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { recargarConfiguracion } from '#notify/configuracion'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { ConsumidorNotify } from '#notify/consumidor'
import ConfigurarNotificaciones from '#notify/actions/configurar_notificaciones'
import { catalogoEventos } from '#notify/catalogo'
import { CanalFalso, ColaFalsa, crearCliente, eventoOutbox } from '#tests/notify/ayudas_notify'

/**
 * `pago.disputa_abierta` (A3, contracargo en la pasarela): alerta al equipo por Telegram y a
 * contabilidad por correo, con la configuración de la empresa del pago; una sola vez por pago
 * aunque el evento llegue dos veces o se reemita. No avisa al cliente. Plantilla editable y en el
 * catálogo de `GET /notificaciones/eventos`.
 */

const TOKEN = `7770505:${'G'.repeat(35)}`
const CHAT = '-1007770505'
const CONTA = 'conta-disputas@argos.gt'

interface Envio {
    canal: string
    destino: string
    asunto: string | null
    cuerpo: string
    empresa_id: number | null
    cliente_id: number | null
}

async function envios(clave: string): Promise<Envio[]> {
    const inc = (await db.from('notify.incidentes').where('clave', clave).orderBy('id', 'desc').first()) as {
        id: number
    } | null
    if (!inc) return []
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${inc.id}:%`)
        .orderBy('id')
        .select('canal', 'destino', 'asunto', 'cuerpo', 'empresa_id', 'cliente_id')) as Envio[]
}

async function entregar(payload: Record<string, unknown>, veces = 2) {
    const id = await eventoOutbox('pago.disputa_abierta', payload)
    const consumidores = [new ConsumidorAlertas(new ColaFalsa()), new ConsumidorNotify(new ColaFalsa())]
    for (let i = 0; i < veces; i++) {
        for (const c of consumidores) {
            if (c.acepta('pago.disputa_abierta')) {
                await c.procesar({ id, evento: 'pago.disputa_abierta', payload, requestId: `prueba-${id}` })
            }
        }
    }
}

test.group('notify · contracargo abierto en la pasarela', (group) => {
    group.each.setup(async () => {
        await db.from('notify.configuracion_canales').delete()
        registrarCanal('telegram', new CanalFalso('telegram'))
        registrarCanal('correo', new CanalFalso('correo'))
        fijarChatEquipo(undefined)
        await new ConfigurarNotificaciones().execute(
            {
                version: 0,
                empresa_id: null,
                correo: { host: 'smtp.argos.gt', remitente: 'no-responder@argos.gt', contabilidad: CONTA },
                telegram: { token: TOKEN, chat_equipo: CHAT },
            },
            contextoPrueba(),
        )
        await recargarConfiguracion()
        return async () => {
            reiniciarCanales()
            await db.from('notify.configuracion_canales').delete()
            await recargarConfiguracion()
            await soloEmpresaPrincipal()
        }
    })

    test('avisa al equipo y a contabilidad una vez por pago, sin avisar al cliente', async ({ assert }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearCliente({ nombre: 'Carlos Méndez', email: 'carlos@prueba.local' })
        const payload = {
            pago_id: 990001,
            empresa_id: e.B,
            cobro_id: 4401,
            cliente_id: clienteId,
            monto: '350.00',
            proveedor: 'recurrente',
            motivo: 'fraudulent',
        }
        assert.isFalse(
            new ConsumidorNotify(new ColaFalsa()).acepta('pago.disputa_abierta'),
            'no va al cliente',
        )

        await entregar(payload)
        // el mismo contracargo reemitido con otro id de outbox tampoco repite
        await entregar(payload, 1)

        const lista = await envios('pago-disputa:990001')
        assert.sameMembers(
            lista.map((x) => x.canal),
            ['telegram', 'correo'],
        )
        const correo = lista.find((x) => x.canal === 'correo')!
        const telegram = lista.find((x) => x.canal === 'telegram')!
        assert.equal(telegram.destino, CHAT)
        assert.equal(correo.destino, CONTA)
        assert.equal(correo.empresa_id, e.B)
        assert.isNull(correo.cliente_id)
        assert.include(correo.asunto!, 'Contracargo abierto: pago 990001 por Q 350.00')
        assert.include(correo.cuerpo, `del cliente Carlos Méndez (#${clienteId})`)
        assert.include(correo.cuerpo, 'Motivo: el titular dice que no reconoce el cargo (fraude)')
        assert.include(correo.cuerpo, 'Cobro en línea: 4401')
        assert.include(correo.cuerpo, 'El sistema no hace nada por su cuenta')
        assert.include(correo.cuerpo, 'anula el pago')
        assert.include(telegram.cuerpo, 'en Recurrente sobre el pago 990001')

        const incidente = (await db
            .from('notify.incidentes')
            .where('clave', 'pago-disputa:990001')
            .first()) as {
            eventos: number
        }
        assert.equal(incidente.eventos, 2, 'la reemisión suma al incidente sin otro aviso')
        assert.lengthOf(await db.from('notify.envios').where('cliente_id', clienteId), 0)
    })

    test('sin motivo y con la plantilla editada', async ({ assert }) => {
        const e = await prepararEmpresas()
        const filtro = { evento: 'alerta.pago.disputa_abierta', canal: 'telegram' }
        const original = (await db.from('notify.plantillas').where(filtro).firstOrFail()) as {
            cuerpo: string
        }
        try {
            await db.from('notify.plantillas').where(filtro).update({
                cuerpo: 'Disputa del pago {{alerta.pago_id}}{{#alerta.motivo}} ({{alerta.motivo}}){{/alerta.motivo}}',
            })
            await entregar({
                pago_id: 990002,
                empresa_id: e.B,
                cobro_id: null,
                cliente_id: null,
                monto: '80.00',
                proveedor: 'recurrente',
                motivo: null,
            })
            const lista = await envios('pago-disputa:990002')
            assert.equal(lista.find((x) => x.canal === 'telegram')!.cuerpo, 'Disputa del pago 990002')
            const correo = lista.find((x) => x.canal === 'correo')!
            assert.notInclude(correo.cuerpo, 'Motivo:')
            assert.notInclude(correo.cuerpo, 'Cobro en línea')
        } finally {
            await db.from('notify.plantillas').where(filtro).update({ cuerpo: original.cuerpo })
        }
    })

    test('está en el catálogo de eventos con sus variables', async ({ assert }) => {
        const catalogo = await catalogoEventos(db.connection(), null)
        const evento = catalogo.find((x) => x.evento === 'alerta.pago.disputa_abierta')!
        assert.containsSubset(evento, { grupo: 'alerta', tipo_aviso: null })
        assert.sameMembers(evento.canales, ['telegram', 'correo'])
        const variables = evento.variables.find((g) => g.grupo === 'alerta')!.variables.map((v) => v.nombre)
        assert.includeMembers(variables, [
            'alerta.pago_id',
            'alerta.monto_q',
            'alerta.cliente',
            'alerta.proveedor',
            'alerta.motivo_texto',
            'alerta.cobro_id',
        ])
    })
})
