import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { decidir, EventoInvalido, leerEvento, type EventoServicio } from '../src/decision.ts'
import { leerConfig } from '../src/config.ts'
import { Dispatcher } from '../src/dispatcher.ts'
import { ClienteNasUdp } from '../src/nas.ts'
import { AlmacenMemoria, CLAVE, SECRET, servicio, sesion, silencio, SUSPENDIDO } from './ayudas.ts'
import { NasSimulado } from './nas_simulado.ts'

function estado(de: string, a: string): EventoServicio {
    return leerEvento('servicio.estado_cambiado', { servicio_id: 101, de, a, motivo: 'prueba' })!
}

describe('decidir (tabla del PM, RouterOS 7.24.5)', () => {
    const casos: Array<[string, string, string, Record<string, string> | null]> = [
        [
            'activo',
            'suspendido',
            'coa',
            {
                'Mikrotik-Rate-Limit': '256k/256k',
                'Mikrotik-Address-List': 'suspendidos',
                'Filter-Id': 'argos-corte.in',
            },
        ],
        [
            'limitado',
            'suspendido',
            'coa',
            {
                'Mikrotik-Rate-Limit': '256k/256k',
                'Mikrotik-Address-List': 'suspendidos',
                'Filter-Id': 'argos-corte.in',
            },
        ],
        ['activo', 'limitado', 'coa', { 'Mikrotik-Rate-Limit': '1024k/2048k' }],
        ['limitado', 'activo', 'coa', { 'Mikrotik-Rate-Limit': '5120k/20480k' }],
        ['suspendido', 'activo', 'disconnect', null],
        ['suspendido', 'limitado', 'disconnect', null],
        ['activo', 'retirado', 'disconnect', null],
        ['suspendido', 'retirado', 'disconnect', null],
    ]
    for (const [de, a, accion, atributos] of casos) {
        it(`${de} → ${a}: ${accion}`, () => {
            const d = decidir(estado(de, a), servicio({ estado: a as never }), SUSPENDIDO)
            assert.equal(d.accion, accion)
            if (d.accion === 'coa') assert.deepEqual(d.atributos, atributos)
        })
    }

    it('rate_limit_override del router al volver a activo', () => {
        const d = decidir(
            estado('limitado', 'activo'),
            servicio({ rate_limit_override: '5M/20M 10M/40M 4M/16M 16/16 8 1M/4M' }),
            SUSPENDIDO,
        )
        assert.deepEqual(d, {
            accion: 'coa',
            razon: 'velocidad: limitado → activo',
            atributos: { 'Mikrotik-Rate-Limit': '5M/20M 10M/40M 4M/16M 16/16 8 1M/4M' },
        })
    })

    it('evento superado (el servicio ya cambió otra vez) o servicio inexistente: nada', () => {
        assert.equal(
            decidir(estado('activo', 'suspendido'), servicio({ estado: 'activo' }), SUSPENDIDO).accion,
            'nada',
        )
        assert.equal(decidir(estado('activo', 'suspendido'), null, SUSPENDIDO).accion, 'nada')
    })

    it('config: ips / prefijo_v6 / router → Disconnect; solo plan → CoA según el estado', () => {
        const config = (campos: string[]) =>
            leerEvento('servicio.config_cambiada', { servicio_id: 101, campos })!
        for (const c of ['ips', 'prefijo_v6', 'router']) {
            assert.equal(decidir(config(['plan', c]), servicio(), SUSPENDIDO).accion, 'disconnect')
        }
        assert.deepEqual(decidir(config(['plan']), servicio({ estado: 'limitado' }), SUSPENDIDO), {
            accion: 'coa',
            razon: 'cambió el plan',
            atributos: { 'Mikrotik-Rate-Limit': '1024k/2048k' },
        })
        assert.equal(decidir(config(['plan']), servicio({ estado: 'suspendido' }), SUSPENDIDO).accion, 'nada')
        assert.equal(decidir(config([]), servicio(), SUSPENDIDO).accion, 'nada')
    })

    it('leerEvento: ignora otros eventos y rechaza payloads fuera del catálogo', () => {
        assert.equal(leerEvento('pago.registrado', {}), null)
        assert.throws(() => leerEvento('servicio.estado_cambiado', { servicio_id: 'x' }), EventoInvalido)
        assert.throws(
            () => leerEvento('servicio.estado_cambiado', { servicio_id: 1, de: 'activo', a: 'cortado' }),
            EventoInvalido,
        )
    })
})

describe('Dispatcher (NAS simulado por UDP, almacén en memoria)', () => {
    const nas = new NasSimulado({ ip: '127.0.0.1', secret: SECRET })
    let almacen: AlmacenMemoria
    let dispatcher: Dispatcher

    before(() => nas.iniciar())
    after(() => nas.cerrar())

    beforeEach(() => {
        nas.modo = 'ack'
        nas.recibidos.length = 0
        almacen = new AlmacenMemoria()
        almacen.servicios.set(101, servicio({ estado: 'suspendido' }))
        almacen.sesiones.set(101, [sesion()])
        dispatcher = new Dispatcher({
            almacen,
            nas: new ClienteNasUdp(),
            claveSecretos: CLAVE,
            suspendido: SUSPENDIDO,
            puertoNas: nas.puerto,
            timeoutMs: 150,
            reintentos: 3,
            esperaMs: 10,
            log: silencio,
        })
    })

    const suspender = (id: number | string = 1) => ({
        id,
        evento: 'servicio.estado_cambiado',
        payload: { servicio_id: 101, de: 'activo', a: 'suspendido', motivo: 'corte' },
        requestId: 'req-1',
    })

    it('suspender → un CoA-Request a la sesión con el perfil de corte; ACK en audit.red', async () => {
        const r = await dispatcher.procesar(suspender())
        assert.deepEqual(r.sesiones, [{ sesion_id: 1, tipo: 'coa', resultado: 'ack', intentos: 1 }])
        assert.equal(nas.recibidos.length, 1)
        assert.equal(nas.recibidos[0]?.codigo, 'CoA-Request')
        assert.deepEqual(nas.recibidos[0]?.atributos, {
            'User-Name': 'cliente-101',
            'Acct-Session-Id': '81a00003',
            'Mikrotik-Rate-Limit': '256k/256k',
            'Mikrotik-Address-List': 'suspendidos',
            'Filter-Id': 'argos-corte.in',
        })
        assert.equal(almacen.red.length, 1)
        const fila = almacen.red[0]!
        assert.equal(fila.tipo, 'coa')
        assert.equal(fila.ok, true)
        assert.equal(fila.router_id, 1)
        assert.equal(fila.servicio_id, 101)
        assert.equal(fila.comando.evento_id, '1')
        assert.equal(fila.respuesta.codigo, 'CoA-ACK')
        assert.equal(almacen.outbox.length, 0)
    })

    it('el mismo evento dos veces (entrega al menos una vez) no reenvía', async () => {
        await dispatcher.procesar(suspender(7))
        const r = await dispatcher.procesar(suspender(7))
        assert.deepEqual(r.sesiones, [{ sesion_id: 1, tipo: 'coa', resultado: 'ya_procesado', intentos: 0 }])
        assert.equal(nas.recibidos.length, 1)
        assert.equal(almacen.red.length, 1)
    })

    it('reactivar → Disconnect-Request sin atributos de perfil', async () => {
        almacen.servicios.set(101, servicio({ estado: 'activo' }))
        const r = await dispatcher.procesar({
            id: 2,
            evento: 'servicio.estado_cambiado',
            payload: { servicio_id: 101, de: 'suspendido', a: 'activo', motivo: 'pago' },
        })
        assert.equal(r.sesiones[0]?.resultado, 'ack')
        assert.equal(nas.recibidos[0]?.codigo, 'Disconnect-Request')
        assert.deepEqual(nas.recibidos[0]?.atributos, {
            'User-Name': 'cliente-101',
            'Acct-Session-Id': '81a00003',
        })
        assert.equal(almacen.red[0]?.tipo, 'disconnect')
    })

    it('NAK: no reintenta, queda en audit.red y emite coa.fallido con el Error-Cause', async () => {
        nas.modo = 'nak'
        const r = await dispatcher.procesar(suspender(3))
        assert.equal(r.sesiones[0]?.resultado, 'nak')
        assert.equal(nas.recibidos.length, 1)
        assert.equal(almacen.red.length, 1)
        assert.equal(almacen.red[0]?.ok, false)
        assert.equal(almacen.red[0]?.respuesta.final, true)
        assert.deepEqual(almacen.outbox, [
            {
                payload: {
                    servicio_id: 101,
                    nas_ip: '127.0.0.1',
                    tipo: 'coa',
                    error: 'CoA-NAK: Session-Context-Not-Found',
                },
                requestId: 'req-1',
            },
        ])
    })

    it('timeout: 1 + 3 reintentos con backoff, cada intento en audit.red y coa.fallido al agotar', async () => {
        nas.modo = 'silencio'
        const r = await dispatcher.procesar(suspender(4))
        assert.deepEqual(r.sesiones, [{ sesion_id: 1, tipo: 'coa', resultado: 'timeout', intentos: 4 }])
        assert.equal(nas.recibidos.length, 4)
        assert.deepEqual(
            almacen.red.map((f) => [f.comando.intento, f.respuesta.resultado, f.respuesta.final]),
            [
                [1, 'timeout', false],
                [2, 'timeout', false],
                [3, 'timeout', false],
                [4, 'timeout', true],
            ],
        )
        assert.equal(almacen.outbox.length, 1)
        assert.equal(almacen.outbox[0]?.payload.error, 'timeout')
    })

    it('timeout y luego ACK: un solo envío exitoso, sin coa.fallido', async () => {
        nas.modo = (n) => (n < 3 ? 'silencio' : 'ack')
        const r = await dispatcher.procesar(suspender(5))
        assert.deepEqual(r.sesiones, [{ sesion_id: 1, tipo: 'coa', resultado: 'ack', intentos: 3 }])
        assert.equal(almacen.outbox.length, 0)
        assert.equal(almacen.red.length, 3)
    })

    it('sin sesión activa o evento superado: no envía nada', async () => {
        almacen.sesiones.set(101, [])
        await dispatcher.procesar(suspender(6))
        almacen.sesiones.set(101, [sesion()])
        almacen.servicios.set(101, servicio({ estado: 'activo' }))
        const r = await dispatcher.procesar(suspender(8))
        assert.equal(r.decision?.accion, 'nada')
        assert.equal(nas.recibidos.length, 0)
        assert.equal(almacen.red.length, 0)
    })

    it('router sin secret: audit.red sin envío y coa.fallido', async () => {
        almacen.sesiones.set(101, [sesion({ radius_secret: null })])
        const r = await dispatcher.procesar(suspender(9))
        assert.equal(r.sesiones[0]?.resultado, 'sin_secret')
        assert.equal(nas.recibidos.length, 0)
        assert.equal(almacen.outbox[0]?.payload.error, 'router sin radius_secret válido')
    })

    it('dos sesiones abiertas: envía a las dos', async () => {
        almacen.sesiones.set(101, [sesion(), sesion({ id: 2, acct_session_id: '81a00004' })])
        const r = await dispatcher.procesar(suspender(10))
        assert.deepEqual(
            r.sesiones.map((s) => s.resultado),
            ['ack', 'ack'],
        )
        assert.deepEqual(
            nas.recibidos.map((p) => p.atributos['Acct-Session-Id']),
            ['81a00003', '81a00004'],
        )
    })

    const desconexion = (id: number | string, sesionId = 5, servicioId: number | null = 101) => ({
        id,
        evento: 'sesion.desconexion_solicitada',
        payload: {
            sesion_id: sesionId,
            servicio_id: servicioId,
            nas_ip: '127.0.0.1',
            acct_session_id: '81a00009',
            user_ppp: 'cliente-101',
            motivo: 'cliente pidió reiniciar',
        },
        requestId: 'req-d',
    })

    it('desconexión manual → Disconnect-Request a esa sesión; audit.red con el motivo', async () => {
        almacen.abiertas.set(5, { ...sesion({ id: 5, acct_session_id: '81a00009' }), servicio_id: 101 })
        assert.equal(dispatcher.acepta('sesion.desconexion_solicitada'), true)
        const r = await dispatcher.procesar(desconexion(20))
        assert.deepEqual(r.sesiones, [{ sesion_id: 5, tipo: 'disconnect', resultado: 'ack', intentos: 1 }])
        assert.equal(nas.recibidos[0]?.codigo, 'Disconnect-Request')
        assert.deepEqual(nas.recibidos[0]?.atributos, {
            'User-Name': 'cliente-101',
            'Acct-Session-Id': '81a00009',
        })
        const fila = almacen.red[0]!
        assert.equal(fila.tipo, 'disconnect')
        assert.equal(fila.servicio_id, 101)
        assert.equal(fila.comando.razon, 'manual: cliente pidió reiniciar')
        assert.equal(fila.comando.evento, 'sesion.desconexion_solicitada')
        assert.equal(fila.respuesta.codigo, 'Disconnect-ACK')

        // duplicado: no se vuelve a desconectar
        const otra = await dispatcher.procesar(desconexion(20))
        assert.equal(otra.sesiones[0]?.resultado, 'ya_procesado')
        assert.equal(nas.recibidos.length, 1)
    })

    it('desconexión manual de una sesión ya cerrada: no envía nada', async () => {
        const r = await dispatcher.procesar(desconexion(21, 99))
        assert.equal(r.decision?.accion, 'nada')
        assert.equal(nas.recibidos.length, 0)
        assert.equal(almacen.red.length, 0)
    })

    it('desconexión manual con NAK y sin servicio conocido: coa.fallido con servicio_id null', async () => {
        nas.modo = 'nak'
        almacen.abiertas.set(6, { ...sesion({ id: 6 }), servicio_id: null })
        const r = await dispatcher.procesar(desconexion(22, 6, null))
        assert.equal(r.sesiones[0]?.resultado, 'nak')
        assert.equal(almacen.red[0]?.servicio_id, null)
        assert.equal(almacen.outbox[0]?.payload.servicio_id, null)
        assert.equal(almacen.outbox[0]?.payload.tipo, 'disconnect')
        assert.match(almacen.outbox[0]?.payload.error ?? '', /^Disconnect-NAK/)
    })

    it('desconexión con payload inválido: EventoInvalido (se descarta)', async () => {
        await assert.rejects(
            dispatcher.procesar({ id: 23, evento: 'sesion.desconexion_solicitada', payload: { sesion_id: 0 } }),
            EventoInvalido,
        )
    })

    it('suspender una sesión con IPv6: CoA por defecto; Disconnect con COA_SUSPENDER_CON_IPV6=disconnect', async () => {
        const conV6 = sesion({ prefijo_enlace_v6: '2001:db8:101:1::/64', prefijo_delegado_v6: '2001:db8:300:100::/56' })
        const soloV4 = sesion({ id: 2, acct_session_id: '81a00004' })
        almacen.sesiones.set(101, [conV6, soloV4])

        const porDefecto = await dispatcher.procesar(suspender(30))
        assert.deepEqual(
            porDefecto.sesiones.map((x) => x.tipo),
            ['coa', 'coa'],
        )

        const conDisconnect = new Dispatcher({
            almacen,
            nas: new ClienteNasUdp(),
            claveSecretos: CLAVE,
            suspendido: SUSPENDIDO,
            suspenderConIpv6: 'disconnect',
            puertoNas: nas.puerto,
            timeoutMs: 150,
            reintentos: 0,
            esperaMs: 10,
            log: silencio,
        })
        nas.recibidos.length = 0
        const r = await conDisconnect.procesar(suspender(31))
        assert.deepEqual(
            r.sesiones.map((x) => [x.sesion_id, x.tipo, x.resultado]),
            [
                [1, 'disconnect', 'ack'],
                [2, 'coa', 'ack'],
            ],
        )
        assert.deepEqual(
            nas.recibidos.map((p) => p.codigo),
            ['Disconnect-Request', 'CoA-Request'],
        )
        const fila = almacen.red.find((f) => f.comando.evento_id === '31' && f.tipo === 'disconnect')!
        assert.match(String(fila.comando.razon), /sesión con IPv6/)

        // reactivar o cambiar velocidad no se ve afectado por el modo
        almacen.servicios.set(101, servicio({ estado: 'limitado' }))
        const limitar = await conDisconnect.procesar({
            id: 32,
            evento: 'servicio.estado_cambiado',
            payload: { servicio_id: 101, de: 'activo', a: 'limitado', motivo: 'mora' },
        })
        assert.deepEqual(
            limitar.sesiones.map((x) => x.tipo),
            ['coa', 'coa'],
        )
    })

    it('leerConfig: COA_SUSPENDER_CON_IPV6 acepta coa | disconnect', () => {
        assert.equal(leerConfig({}).suspenderConIpv6, 'coa')
        assert.equal(leerConfig({ COA_SUSPENDER_CON_IPV6: 'disconnect' }).suspenderConIpv6, 'disconnect')
        assert.throws(() => leerConfig({ COA_SUSPENDER_CON_IPV6: 'otro' }), /COA_SUSPENDER_CON_IPV6/)
    })
})
