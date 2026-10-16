import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { crearServidor } from '../src/app.ts'
import { Dispatcher } from '../src/dispatcher.ts'
import { MetricasCoa } from '../src/metricas.ts'
import { ClienteNasUdp } from '../src/nas.ts'
import {
    AlmacenMemoria,
    CLAVE,
    SECRET,
    servicio,
    sesion,
    silencio,
    SUSPENDIDO,
    TIMEOUT_ACK_MS,
} from './ayudas.ts'
import { NasSimulado } from './nas_simulado.ts'

/** Tarea 5 (semana 2): `/metrics` del coa-dispatcher. */
describe('GET /metrics de coa', () => {
    const nas = new NasSimulado({ ip: '127.0.0.1', secret: SECRET })
    const metricas = new MetricasCoa()
    const servidor = crearServidor({
        consumidor: () => ({ activo: true, ultimaLectura: null }),
        redisListo: () => true,
        metricas,
        pendientes: async () => 3,
        metricasToken: 'tok',
    })
    let base = ''

    before(async () => {
        await nas.iniciar()
        await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
    })
    after(async () => {
        await nas.cerrar()
        await new Promise<void>((r) => servidor.close(() => r()))
    })

    it('envíos por tipo y resultado, RTT, pendientes del grupo y token', async () => {
        const almacen = new AlmacenMemoria()
        almacen.servicios.set(101, servicio({ estado: 'suspendido' }))
        almacen.sesiones.set(101, [sesion(), sesion({ id: 2, radius_secret: null })])
        const dispatcher = new Dispatcher({
            almacen,
            nas: new ClienteNasUdp(),
            claveSecretos: CLAVE,
            suspendido: SUSPENDIDO,
            puertoNas: nas.puerto,
            timeoutMs: TIMEOUT_ACK_MS,
            reintentos: 0,
            esperaMs: 1,
            log: silencio,
            metricas,
        })
        await dispatcher.procesar({
            id: 1,
            evento: 'servicio.estado_cambiado',
            payload: { servicio_id: 101, de: 'activo', a: 'suspendido', motivo: 'corte' },
            requestId: 'req-1',
        })

        assert.equal((await fetch(`${base}/metrics`)).status, 401)
        const res = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer tok' } })
        assert.equal(res.status, 200)
        const t = await res.text()
        assert.match(t, /argosisp_coa_envios_total\{tipo="coa",resultado="ack"\} 1\n/)
        assert.match(t, /argosisp_coa_envios_total\{tipo="coa",resultado="sin_secret"\} 1\n/)
        assert.match(t, /argosisp_coa_rtt_segundos_count\{tipo="coa"\} 1\n/)
        assert.match(t, /argosisp_coa_eventos_pendientes 3\n/)
        assert.match(t, /argosisp_coa_consumidor_activo 1\n/)
    })
})
