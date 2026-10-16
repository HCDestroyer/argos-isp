import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import { unico } from '#tests/ayudas'
import {
    crearClienteFila,
    crearPlanFila,
    crearRouterFila,
    crearServicioFila,
    ipUnica,
} from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { procesarPrefijo } from '#network/routeros/prefijos'
import { procesarAccounting } from '#network/sesiones/cola'
import type { RegistroAccounting } from '#network/sesiones/registro'

/**
 * Modo `radius_pool` de IPv6 (semana 2, tarea 4). `aaa` entrega `Framed-IPv6-Pool` y el pool de
 * delegación (`services/aaa/test`); aquí: el /64 que reporta el NAS en el Start, el /56 que lee
 * `CompletarPrefijoDelegado` del router (`/ipv6/dhcp-server/binding`) porque RouterOS no lo manda
 * en el accounting, y el /56 que sí llegue en un Interim-Update.
 */

const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 500,
            esperaMs: 5,
        }),
}

test.group('IPv6 · modo radius_pool', (group) => {
    let falso: RouterOSFalso
    let nasIp: string
    let userPpp: string
    let servicioId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        nasIp = ipUnica()
        const routerId = await crearRouterFila({
            nas_ip: nasIp,
            host: falso.url,
            api_usuario: falso.usuario,
            api_password: cifrar(falso.password),
        })
        userPpp = unico('pool')
        servicioId = await crearServicioFila({
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            plan_id: await crearPlanFila(),
            user_ppp: userPpp,
            pass_ppp: cifrar('clave'),
            ipv6_modo: 'radius_pool',
        })
        return () => falso.cerrar()
    })

    function registro(parcial: Partial<RegistroAccounting>): RegistroAccounting {
        return {
            tipo: 'Start',
            nas_ip: nasIp,
            acct_session_id: unico('ses'),
            user_ppp: userPpp,
            ipv4: '10.10.9.9',
            prefijo_enlace_v6: '2001:db8:77:1::/64',
            prefijo_delegado_v6: null,
            bytes_in: '0',
            bytes_out: '0',
            duracion_s: null,
            causa_fin: null,
            evento_en: new Date().toISOString(),
            ...parcial,
        }
    }

    const sesion = (acct: string) =>
        db
            .from('network.sesiones')
            .whereRaw('nas_ip = ?::inet', [nasIp])
            .where('acct_session_id', acct)
            .select(
                db.raw('prefijo_enlace_v6::text AS enlace'),
                db.raw('prefijo_delegado_v6::text AS delegado'),
                'id',
            )
            .firstOrFail()

    test('Start con el /64 del pool; el /56 se lee del binding DHCPv6-PD del router', async ({ assert }) => {
        const start = registro({})
        await procesarAccounting(start, randomUUID())
        assert.deepInclude(await sesion(start.acct_session_id), {
            enlace: '2001:db8:77:1::/64',
            delegado: null,
        })

        // DHCPv6-PD todavía no terminó: el job reintenta (lanza) sin escribir nada
        const datos = { nas_ip: nasIp, acct_session_id: start.acct_session_id }
        await assert.rejects(() => procesarPrefijo(datos, OPCIONES), /sin_binding/)
        const sinPrefijo = await sesion(start.acct_session_id)
        assert.isNull(sinPrefijo.delegado)

        falso.lectura('/ipv6/dhcp-server/binding').push(
            { '.id': '*1', server: '<pppoe-otro>', address: '2001:db8:77:200::/56' },
            {
                '.id': '*2',
                server: `<pppoe-${userPpp}>`,
                address: '2001:db8:77:100::/56',
                dynamic: 'true',
            },
        )
        const r = await procesarPrefijo(datos, OPCIONES)
        assert.equal(r.estado, 'completado')
        assert.equal(r.prefijo, '2001:db8:77:100::/56')
        const fila = await sesion(start.acct_session_id)
        assert.equal(fila.delegado, '2001:db8:77:100::/56')
        assert.equal(falso.escrituras.length, 0, 'solo lectura en el router')

        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'sesion')
            .where('entidad_id', fila.id)
            .where('campo', 'prefijo_delegado_v6')
            .first()
        assert.exists(cambio)

        // Ya tiene prefijo: no vuelve a preguntar
        const antes = falso.peticiones.length
        const repetido = await procesarPrefijo(datos, OPCIONES)
        assert.equal(repetido.estado, 'no_aplica')
        assert.equal(falso.peticiones.length, antes)
    })

    test('si el NAS reporta el /56 en un Interim-Update, se guarda y se audita', async ({ assert }) => {
        const start = registro({})
        await procesarAccounting(start, randomUUID())
        const interim = {
            ...start,
            tipo: 'Interim-Update' as const,
            prefijo_delegado_v6: '2001:db8:77:300::/56',
        }
        const salida = await procesarAccounting(interim, randomUUID())
        assert.deepInclude(salida, { efecto: 'actualizada', prefijoNuevo: true })
        const conPrefijo = await sesion(start.acct_session_id)
        assert.equal(conPrefijo.delegado, '2001:db8:77:300::/56')
        // Un Interim de contadores después no se audita
        const otra = await procesarAccounting({ ...interim, bytes_in: '1000' }, randomUUID())
        assert.deepInclude(otra, { prefijoNuevo: false })
    })

    test('un servicio fuera de radius_pool no consulta el router', async ({ assert }) => {
        await db.from('core.servicios').where('id', servicioId).update({ ipv6_modo: 'radius_servicio' })
        const start = registro({})
        await procesarAccounting(start, randomUUID())
        const r = await procesarPrefijo({ nas_ip: nasIp, acct_session_id: start.acct_session_id }, OPCIONES)
        assert.equal(r.estado, 'no_aplica')
        assert.lengthOf(falso.peticiones, 0)
    })
})
