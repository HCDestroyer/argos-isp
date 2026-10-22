import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import RegistrarAlerta from '#notify/actions/registrar_alerta'
import { CanalFalso, ColaFalsa } from '#tests/notify/ayudas_notify'
import { unico } from '#tests/ayudas'
import { ipUnica } from '#tests/core/fabricas'

/**
 * Semana 2, tarea 3: alerta al equipo de `routeros.fallido` (`contratos/routeros.md`:
 * `{ servicio_id, router_id, operacion, error }` tras 3 reintentos). Eventos simulados: A2 lo
 * agrega al catálogo hoy.
 */

const CHAT = '-1009990002'
let siguienteId = 9_500_000_000 + randomInt(0, 1_000_000) * 1000

function evento(payload: Record<string, unknown>, id = ++siguienteId) {
    return { id, evento: 'routeros.fallido', payload, requestId: `prueba-${id}` }
}

async function crearRouter(nombre: string): Promise<number> {
    const [fila] = (await db
        .table('network.routers')
        .insert({
            nombre,
            host: `10.${randomInt(1, 255)}.${randomInt(1, 255)}.1`,
            nas_ip: ipUnica(),
        })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function incidente(clave: string, estado?: 'abierto' | 'cerrado') {
    return (await db
        .from('notify.incidentes')
        .where('clave', clave)
        .if(estado, (q) => q.where('estado', estado!))
        .orderBy('id', 'desc')
        .first()) as { id: number; tipo: string; eventos: number; detalle: Record<string, unknown> } | null
}

async function enviosDe(incidenteId: number) {
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${incidenteId}:%`)
        .orderBy('id')
        .select('evento', 'canal', 'destino', 'cuerpo', 'cliente_id')) as Array<{
        evento: string
        canal: string
        destino: string
        cuerpo: string
        cliente_id: number | null
    }>
}

test.group('notify · alertas · routeros.fallido', (group) => {
    group.each.setup(() => {
        registrarCanal('telegram', new CanalFalso('telegram'))
        fijarChatEquipo(CHAT)
        return () => {
            reiniciarCanales()
            fijarChatEquipo(undefined)
        }
    })

    test('una alerta por router con nombre, operación y error; se agrupa 30 min; idempotente por evento', async ({
        assert,
    }) => {
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorAlertas(cola)
        const nombre = unico('Torre Norte')
        const routerId = await crearRouter(nombre)
        const otroRouter = await crearRouter(unico('Torre Sur'))
        const payload = (servicio: number, router = routerId) => ({
            servicio_id: servicio,
            router_id: router,
            operacion: 'queue/simple add',
            error: 'ETIMEDOUT tras 3 reintentos',
        })

        assert.isTrue(consumidor.acepta('routeros.fallido'))
        const primero = evento(payload(11))
        await consumidor.procesar(primero)
        await consumidor.procesar(primero) // el bus lo entrega dos veces
        await consumidor.procesar(evento(payload(12)))
        await consumidor.procesar(evento(payload(13, otroRouter)))

        const abierto = await incidente(`routeros:${routerId}`, 'abierto')
        assert.equal(abierto!.tipo, 'routeros')
        assert.equal(abierto!.eventos, 2)
        assert.equal(abierto!.detalle.operacion, 'queue/simple add')
        const envios = await enviosDe(abierto!.id)
        assert.lengthOf(envios, 1)
        assert.equal(envios[0]!.evento, 'alerta.routeros.fallido')
        assert.equal(envios[0]!.canal, 'telegram')
        assert.equal(envios[0]!.destino, CHAT)
        assert.isNull(envios[0]!.cliente_id)
        const cuerpo = envios[0]!.cuerpo
        assert.include(cuerpo, `ALERTA · El router ${nombre} (`)
        assert.include(cuerpo, 'no aceptó cambios por la API REST')
        assert.include(cuerpo, 'Operación: queue/simple add')
        assert.include(cuerpo, 'Servicio: 11')
        assert.include(cuerpo, 'Error: ETIMEDOUT tras 3 reintentos')
        assert.include(cuerpo, '30 min')
        assert.lengthOf(await enviosDe((await incidente(`routeros:${otroRouter}`, 'abierto'))!.id), 1)
        assert.lengthOf(new Set(cola.ids), 2) // la reentrega solo reencola el mismo envío

        // 31 minutos sin fallos: termina en silencio y el siguiente fallo vuelve a avisar
        const despues = DateTime.utc().plus({ minutes: 31 }).toISO()!
        const r = await new RegistrarAlerta().execute(
            {
                origen: `outbox:${++siguienteId}`,
                evento: 'routeros.fallido',
                payload: payload(14),
                ahora: despues,
            },
            contextoSistema('worker'),
        )
        assert.isTrue(r.alerta)
        assert.notEqual(r.incidenteId, abierto!.id)
    })

    test('router desconocido o sin servicio: la alerta sale igual, sin inventar datos', async ({
        assert,
    }) => {
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const routerId = 900_000_000 + randomInt(0, 99_999_999)
        await consumidor.procesar(
            evento({
                servicio_id: null,
                router_id: routerId,
                operacion: 'reconciliar',
                error: '401 Unauthorized',
            }),
        )
        const abierto = await incidente(`routeros:${routerId}`, 'abierto')
        const [envio] = await enviosDe(abierto!.id)
        assert.include(envio!.cuerpo, `El router #${routerId} no aceptó`)
        assert.notInclude(envio!.cuerpo, 'Servicio:')
        assert.include(envio!.cuerpo, 'Error: 401 Unauthorized')
    })

    test('validar velocidad: incidente propio, no se agrupa con el de router caído (a2.md)', async ({
        assert,
    }) => {
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const nombre = unico('Torre Este')
        const routerId = await crearRouter(nombre)
        const fallo = (servicio: number | null, operacion: string, error: string) =>
            evento({ servicio_id: servicio, router_id: routerId, operacion, error })

        // Router caído primero: abre routeros:<id>
        await consumidor.procesar(fallo(21, 'queue/simple add', 'ETIMEDOUT tras 3 reintentos'))
        // Validaciones de velocidad del mismo router: no suman al incidente de caída
        await consumidor.procesar(
            fallo(
                22,
                'validar velocidad (limit_at_hijos)',
                'La suma de limit-at de los hijos supera el padre',
            ),
        )
        await consumidor.procesar(
            fallo(
                23,
                'validar velocidad (limit_at_hijos)',
                'La suma de limit-at de los hijos supera el padre',
            ),
        )
        await consumidor.procesar(fallo(null, 'validar velocidad (ipv6)', 'Sin prefijo IPv6 para la cola'))

        const caida = await incidente(`routeros:${routerId}`, 'abierto')
        assert.equal(caida!.eventos, 1)
        assert.lengthOf(await enviosDe(caida!.id), 1)

        const hijos = await incidente(`routeros-velocidad:${routerId}:limit_at_hijos`, 'abierto')
        assert.equal(hijos!.tipo, 'routeros_velocidad')
        assert.equal(hijos!.eventos, 2)
        const [aviso] = await enviosDe(hijos!.id)
        assert.equal(aviso!.evento, 'alerta.routeros.velocidad')
        assert.include(aviso!.cuerpo, `Configuración de velocidad inválida en el router ${nombre} (`)
        assert.include(aviso!.cuerpo, 'Validación: limit_at_hijos')
        assert.include(aviso!.cuerpo, 'Servicio: 22')
        assert.include(aviso!.cuerpo, 'Detalle: La suma de limit-at de los hijos supera el padre')
        assert.notInclude(aviso!.cuerpo, 'no aceptó cambios')

        const ipv6 = await incidente(`routeros-velocidad:${routerId}:ipv6`, 'abierto')
        const [avisoIpv6] = await enviosDe(ipv6!.id)
        assert.notInclude(avisoIpv6!.cuerpo, 'Servicio:')

        // Solo validaciones (router sano): no abre el incidente de caída
        const sano = await crearRouter(unico('Torre Oeste'))
        await consumidor.procesar(
            evento({
                servicio_id: 30,
                router_id: sano,
                operacion: 'validar velocidad (limit_at_global)',
                error: 'x',
            }),
        )
        assert.isNull(await incidente(`routeros:${sano}`))
        assert.isNotNull(await incidente(`routeros-velocidad:${sano}:limit_at_global`, 'abierto'))
    })
})
