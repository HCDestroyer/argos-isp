import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import VigilarCrons from '#notify/actions/vigilar_crons'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { ejecutarVigilancia } from '#notify/vigilancia'
import { CanalFalso, ColaFalsa, crearCliente, crearServicio } from '#tests/notify/ayudas_notify'
import { unico } from '#tests/ayudas'

const CHAT = '-1009990001'

let siguienteId = 9_000_000_000 + randomInt(0, 1_000_000) * 1000
/** Evento simulado del bus (ids altos para no chocar con `audit.outbox` real). */
function evento(nombre: string, payload: Record<string, unknown>, id = ++siguienteId) {
    return { id, evento: nombre, payload, requestId: `prueba-${id}` }
}

async function enviosDe(incidenteId: number) {
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${incidenteId}:%`)
        .orderBy('id')
        .select(
            'id',
            'origen',
            'evento',
            'cliente_id',
            'canal',
            'destino',
            'cuerpo',
            'estado',
            'error',
        )) as Array<{
        id: number
        origen: string
        evento: string
        cliente_id: number | null
        canal: string
        destino: string
        cuerpo: string
        estado: string
        error: string | null
    }>
}

async function incidente(clave: string, estado?: string) {
    return (await db
        .from('notify.incidentes')
        .where('clave', clave)
        .if(estado, (q) => q.where('estado', estado!))
        .orderBy('id', 'desc')
        .first()) as { id: number; estado: string; eventos: number; cerrado_en: Date | null } | null
}

test.group('notify · alertas internas', (group) => {
    let telegram: CanalFalso
    group.each.setup(() => {
        telegram = new CanalFalso('telegram')
        registrarCanal('telegram', telegram)
        fijarChatEquipo(CHAT)
        return () => {
            reiniciarCanales()
            fijarChatEquipo(undefined)
        }
    })

    test('aaa.caido: una alerta por incidente, idempotente por id de evento; aaa.recuperado la cierra', async ({
        assert,
    }) => {
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorAlertas(cola)
        const nodo = unico('aaa1')
        const desde = DateTime.utc().minus({ minutes: 12 }).toISO()

        const primero = evento('aaa.caido', { nodo, desde, ultimo_error: 'ECONNREFUSED redis' })
        await consumidor.procesar(primero)
        await consumidor.procesar(primero) // reentrega del mismo evento
        await consumidor.procesar(evento('aaa.caido', { nodo, desde, ultimo_error: 'timeout' }))

        const abierto = await incidente(`aaa:${nodo}`, 'abierto')
        assert.isNotNull(abierto)
        assert.equal(abierto!.eventos, 2, 'la reentrega no suma')
        let envios = await enviosDe(abierto!.id)
        assert.lengthOf(envios, 1)
        assert.include(envios[0]!, {
            evento: 'alerta.aaa.caido',
            cliente_id: null,
            canal: 'telegram',
            destino: CHAT,
            estado: 'encolado',
        })
        assert.include(envios[0]!.cuerpo, nodo)
        assert.include(envios[0]!.cuerpo, 'ECONNREFUSED redis')
        assert.deepEqual([...new Set(cola.ids)], [envios[0]!.id], 'la reentrega reencola el mismo envío')

        // Payload del contrato de A2: { nodo, desde, hasta, ultimo_error }; hasta = desde + 40 min
        const hasta = DateTime.fromISO(desde!).plus({ minutes: 40 }).toISO()
        const recuperado = evento('aaa.recuperado', { nodo, desde, hasta, ultimo_error: 'ECONNREFUSED' })
        await consumidor.procesar(recuperado)
        await consumidor.procesar(recuperado)
        await consumidor.procesar(evento('aaa.recuperado', { nodo, desde }))

        const cerrado = await incidente(`aaa:${nodo}`)
        assert.equal(cerrado!.id, abierto!.id)
        assert.equal(cerrado!.estado, 'cerrado')
        envios = await enviosDe(abierto!.id)
        assert.lengthOf(envios, 2)
        assert.equal(envios[1]!.evento, 'alerta.aaa.recuperado')
        assert.match(envios[1]!.cuerpo, /RESUELTO[\s\S]*\(40 min\)/)
        assert.include(envios[1]!.cuerpo, 'Último error: ECONNREFUSED')

        // Una caída posterior es otro incidente con su propia alerta
        await consumidor.procesar(evento('aaa.caido', { nodo, desde: DateTime.utc().toISO() }))
        const otro = await incidente(`aaa:${nodo}`, 'abierto')
        assert.notEqual(otro!.id, abierto!.id)
        assert.lengthOf(await enviosDe(otro!.id), 1)

        const auditadas = await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.alertar')
            .where('request_id', primero.requestId)
        assert.lengthOf(auditadas, 2, 'cada procesamiento se audita, también el duplicado')
    })

    test('coa.fallido: los fallos del mismo router se agrupan 30 min; otro router es otro incidente', async ({
        assert,
    }) => {
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorAlertas(cola)
        const { default: RegistrarAlerta } = await import('#notify/actions/registrar_alerta')
        const nas = `10.${randomInt(1, 255)}.${randomInt(1, 255)}.1`
        const otroNas = `10.${randomInt(1, 255)}.${randomInt(1, 255)}.2`
        const payload = (servicio: number, ip = nas) => ({
            servicio_id: servicio,
            nas_ip: ip,
            tipo: 'disconnect',
            error: 'timeout tras 4 intentos',
        })

        await consumidor.procesar(evento('coa.fallido', payload(1)))
        await consumidor.procesar(evento('coa.fallido', payload(2)))
        await consumidor.procesar(evento('coa.fallido', payload(3, otroNas)))

        const primero = await incidente(`coa:${nas}`, 'abierto')
        assert.equal(primero!.eventos, 2)
        const envios = await enviosDe(primero!.id)
        assert.lengthOf(envios, 1)
        assert.include(envios[0]!.cuerpo, 'Disconnect sin respuesta del router')
        assert.lengthOf(await enviosDe((await incidente(`coa:${otroNas}`, 'abierto'))!.id), 1)

        // 31 minutos sin fallos: el incidente termina y el siguiente fallo vuelve a avisar
        const despues = DateTime.utc().plus({ minutes: 31 }).toISO()!
        const r = await new RegistrarAlerta().execute(
            { origen: `outbox:${++siguienteId}`, evento: 'coa.fallido', payload: payload(4), ahora: despues },
            contextoSistema('worker'),
        )
        assert.isTrue(r.alerta)
        assert.notEqual(r.incidenteId, primero!.id)
        assert.equal((await incidente(`coa:${nas}`, 'cerrado'))!.id, primero!.id)
    })

    test('caja.cerrada: sin diferencia no hace nada; con faltante avisa una vez', async ({ assert }) => {
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorAlertas(cola)
        const cajaId = randomInt(100_000, 999_999)

        const cuadrada = evento('caja.cerrada', {
            caja_id: cajaId,
            cajero_id: 7,
            esperado: '500.00',
            contado: '500.00',
            diferencia: '0.00',
        })
        await consumidor.procesar(cuadrada)
        assert.isNull(
            await db.from('notify.alertas_eventos').where('origen', `outbox:${cuadrada.id}`).first(),
        )
        assert.isNull(await incidente(`caja:${cajaId}`))

        const descuadre = evento('caja.cerrada', {
            caja_id: cajaId,
            cajero_id: 7,
            esperado: '1500.00',
            contado: '1450.50',
            diferencia: '-49.50',
        })
        await consumidor.procesar(descuadre)
        await consumidor.procesar(descuadre)
        const fila = await incidente(`caja:${cajaId}`)
        assert.equal(fila!.estado, 'cerrado', 'un cierre de caja es un hecho puntual')
        const envios = await enviosDe(fila!.id)
        assert.lengthOf(envios, 1)
        assert.include(envios[0]!.cuerpo, 'faltante')
        assert.include(envios[0]!.cuerpo, 'Q 1,500.00')
        assert.include(envios[0]!.cuerpo, 'Q 1,450.50')
        assert.include(envios[0]!.cuerpo, '-Q 49.50')
    })

    test('sin chat del equipo la alerta queda fallida y visible; plantilla desactivada la silencia', async ({
        assert,
    }) => {
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorAlertas(cola)

        fijarChatEquipo(null)
        const nodo = unico('aaa-sin-chat')
        await consumidor.procesar(evento('aaa.caido', { nodo, desde: DateTime.utc().toISO() }))
        const sinChat = await enviosDe((await incidente(`aaa:${nodo}`, 'abierto'))!.id)
        assert.lengthOf(sinChat, 1)
        assert.include(sinChat[0]!, {
            estado: 'fallido',
            destino: '-',
            error: 'TELEGRAM_CHAT_EQUIPO no configurado',
        })
        assert.lengthOf(cola.ids, 0)

        fijarChatEquipo(CHAT)
        await db
            .from('notify.plantillas')
            .where({ evento: 'alerta.coa.fallido', canal: 'telegram' })
            .update({ activa: false })
        try {
            const nas = `10.${randomInt(1, 255)}.${randomInt(1, 255)}.9`
            await consumidor.procesar(
                evento('coa.fallido', { servicio_id: 1, nas_ip: nas, tipo: 'coa', error: 'NAK' }),
            )
            const fila = await incidente(`coa:${nas}`, 'abierto')
            assert.isNotNull(fila, 'el incidente queda registrado')
            assert.lengthOf(await enviosDe(fila!.id), 0)
        } finally {
            await db
                .from('notify.plantillas')
                .where({ evento: 'alerta.coa.fallido', canal: 'telegram' })
                .update({ activa: true })
        }
    })

    test('envío real por el worker: la alerta llega al chat del equipo sin notificacion.enviada', async ({
        assert,
    }) => {
        const { procesarEnvio } = await import('#notify/cola')
        const cola = new ColaFalsa()
        const nodo = unico('aaa-envio')
        await new ConsumidorAlertas(cola).procesar(
            evento('aaa.caido', { nodo, desde: DateTime.utc().toISO() }),
        )
        const envioId = cola.ids[0]!
        const job = { data: { envioId }, attemptsMade: 0, opts: { attempts: 3 } }
        const resultado = await procesarEnvio(job as never, cola)
        assert.equal(resultado.estado, 'enviado')
        assert.lengthOf(telegram.enviados, 1)
        assert.equal(telegram.enviados[0]!.destino, CHAT)
        assert.include(telegram.enviados[0]!.cuerpo, nodo)
        const emitidos = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw(`payload ->> 'evento_origen' = 'alerta.aaa.caido'`)
        assert.lengthOf(emitidos, 0)
    })
})

test.group('notify · vigilancia de crons', (group) => {
    group.each.setup(() => {
        registrarCanal('telegram', new CanalFalso('telegram'))
        fijarChatEquipo(CHAT)
        return () => {
            reiniciarCanales()
            fijarChatEquipo(undefined)
        }
    })

    test('cron horario atrasado: avisa una vez y avisa al volver a correr', async ({ assert }) => {
        const cola = new ColaFalsa()
        // Tres horas en el futuro: la última corrida real (si hubo) quedó atrás del límite.
        const tarde = DateTime.utc().plus({ hours: 3 }).toISO()!
        const r1 = await ejecutarVigilancia(cola, tarde)
        assert.include(r1.atrasados, 'cron:facturas.generar')
        const abierto = await incidente('cron:facturas.generar', 'abierto')
        const alerta = await enviosDe(abierto!.id)
        assert.lengthOf(alerta, 1)
        assert.include(alerta[0]!.cuerpo, 'La generación de facturas no se ejecutó a su hora')

        const r2 = await ejecutarVigilancia(cola, DateTime.utc().plus({ hours: 3, minutes: 5 }).toISO()!)
        assert.include(r2.atrasados, 'cron:facturas.generar')
        assert.lengthOf(await enviosDe(abierto!.id), 1, 'no se repite mientras sigue atrasado')

        await new RegistrarCorrida('facturas.generar').execute(
            { parametros: { hasta: 'prueba' }, resultado: { generadas: 0 } },
            contextoSistema('cron'),
        )
        const r3 = await ejecutarVigilancia(cola, DateTime.utc().plus({ minutes: 5 }).toISO()!)
        assert.notInclude(r3.atrasados, 'cron:facturas.generar')
        assert.include(r3.recuperados, 'cron:facturas.generar')
        const envios = await enviosDe(abierto!.id)
        assert.lengthOf(envios, 2)
        assert.include(envios[1]!.cuerpo, 'RESUELTO')
        assert.equal((await incidente('cron:facturas.generar'))!.estado, 'cerrado')
        assert.includeMembers(
            cola.ids,
            envios.map((e) => e.id),
        )
    })

    test('corte: una alerta por hora de corte perdida, resuelta cuando la corrida la procesa', async ({
        assert,
    }) => {
        const local = DateTime.now().setZone('America/Guatemala')
        const hora = '00:01'
        // Plantilla con una hora de corte propia y un servicio vigente que la usa
        const [plantilla] = (await db
            .table('billing.plantillas_facturacion')
            .insert({ nombre: unico('Plantilla alertas'), dia: 1, hora_corte: hora })
            .returning('id')) as Array<{ id: number }>
        const servicioId = await crearServicio(await crearCliente())
        await db
            .from('core.servicios')
            .where('id', servicioId)
            .update({ plantilla_facturacion_id: plantilla!.id })

        const clave = `cron:servicios.corte:${local.toISODate()} ${hora}`
        const ahora = local.set({ hour: 23, minute: 58 }).toUTC().toISO()!
        const vigilar = () => new VigilarCrons().execute({ ahora }, contextoSistema('cron'))

        const r1 = await vigilar()
        assert.include(r1.atrasados, clave)
        const abierto = await incidente(clave, 'abierto')
        const alerta = await enviosDe(abierto!.id)
        assert.lengthOf(alerta, 1)
        assert.include(alerta[0]!.cuerpo, `El corte de las ${hora} no se ejecutó a su hora`)

        await vigilar()
        assert.lengthOf(await enviosDe(abierto!.id), 1)

        await new RegistrarCorrida('servicios.corte').execute(
            { parametros: { ahora }, resultado: { horas: [hora], evaluados: 1, cambiados: 0, errores: 0 } },
            contextoSistema('cron'),
        )
        const r3 = await vigilar()
        assert.notInclude(r3.atrasados, clave)
        assert.include(r3.recuperados, clave)
        assert.lengthOf(await enviosDe(abierto!.id), 2)
    })
})
