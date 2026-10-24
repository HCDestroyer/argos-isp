import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaAvisos from '~/pages/notificaciones/index.vue'
import PaginaPlan from '~/pages/planes/[id].vue'
import PaginaRouter from '~/pages/routers/[id].vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Pantallas pendientes de la prioridad 2: plantillas de avisos, recordatorios y envíos; planes
 * temporales y configuración efectiva del servicio; implementación del plan por router; alta de
 * router, redes IPv4, bloques y pools IPv6. Composables contra los fixtures y las pantallas.
 */

function conApp(componente: Parameters<typeof h>[0]) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
})

describe('avisos: plantillas, recordatorios y envíos', () => {
    it('editar una plantilla valida Mustache (422 por campo) y la versión (409)', async () => {
        const plantilla = bd.plantillasNotificacion.find(p => p.evento === 'factura.emitida' && p.canal === 'correo')!
        const mala = await usePlantillasNotificacion().editar(plantilla.id, { version: plantilla.version, cuerpo: 'Hola {{#factura.vencida}}sin cerrar' })
        expect(!mala.ok && mala.problema.errors?.[0]).toMatchObject({ field: 'cuerpo', rule: 'mustache' })
        const buena = await usePlantillasNotificacion().editar(plantilla.id, { version: plantilla.version, cuerpo: 'Hola {{cliente.nombre}}', activa: false })
        expect(buena.ok && [buena.data.cuerpo, buena.data.activa, buena.data.version]).toEqual(['Hola {{cliente.nombre}}', false, 2])
        const vieja = await usePlantillasNotificacion().editar(plantilla.id, { version: 1, activa: true })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })

    it('recordatorio: días −60…60 y hora HH:MM; envíos filtran por estado', async () => {
        const r = bd.recordatoriosPago[0]!
        const fuera = await useRecordatoriosPago().editar(r.id, { version: r.version, dias: -90 })
        expect(!fuera.ok && fuera.problema.errors?.[0]?.field).toBe('dias')
        const bien = await useRecordatoriosPago().editar(r.id, { version: r.version, dias: -5, hora: '07:30' })
        expect(bien.ok && [bien.data.dias, bien.data.hora]).toEqual([-5, '07:30:00'])
        const fallidos = await useEnviosNotificacion().listar({ estado: 'fallido' })
        expect(fallidos.ok && fallidos.data.data.map(e => e.id)).toEqual([3])
        expect(diasRecordatorio(-3)).toBe('3 días antes del vencimiento')
        expect(etiquetaEvento('recordatorio.2')).toBe('Recordatorio de pago 2')
    })

    it('la pantalla muestra plantillas, recordatorios y envíos con su estado', async () => {
        const pagina = await mountSuspended(conApp(PaginaAvisos), { route: '/notificaciones' })
        await esperar(() => expect(pagina.find('[data-aviso="factura.emitida/correo"]').exists()).toBe(true))
        expect(pagina.find('[data-aviso="alerta.aaa.caido/telegram"]').exists()).toBe(false)
        pagina.unmount()
        const envios = await mountSuspended(conApp(PaginaAvisos), { route: '/notificaciones?tab=envios' })
        await esperar(() => expect(envios.find('[data-envio="3"]').exists()).toBe(true))
        expect(envios.find('[data-prueba="tabla-envios"]').text()).toContain('Fallido')
    })
})

describe('servicio: planes temporales y configuración efectiva', () => {
    it('programar sin inicio activa la mejora y cambia el plan; un segundo es 409; cancelar devuelve el base', async () => {
        const servicio = bd.servicios.find(s => s.id === 1)!
        const base = servicio.plan_id
        const otro = bd.planes.find(p => p.activo && p.id !== base && (bd.planesPorRouter[servicio.router_id] ?? []).includes(p.id))!
        const programado = await usePlanesTemporales().programar(1, { plan_id: otro.id, dias: 7, motivo: 'Promoción' }, nuevaClaveIdempotencia())
        expect(programado.ok && [programado.data.estado, programado.data.plan_original_id]).toEqual(['activo', base])
        expect(bd.servicios.find(s => s.id === 1)?.plan_id).toBe(otro.id)
        const ver = await useServicios().ver(1)
        expect(ver.ok && ver.data.plan_temporal?.estado).toBe('activo')
        const otraVez = await usePlanesTemporales().programar(1, { plan_id: base, dias: 3 }, nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:plan_temporal_activo')
        const plan = programado.ok ? programado.data : null
        const cancelado = await usePlanesTemporales().cancelar(plan!, 'El cliente no la quiso', nuevaClaveIdempotencia())
        expect(cancelado.ok && cancelado.data.estado).toBe('cancelado')
        expect(bd.servicios.find(s => s.id === 1)?.plan_id).toBe(base)
    })

    it('la configuración efectiva marca las excepciones del servicio', async () => {
        const conExcepcion = bd.servicios.find(s => Object.keys(s.excepciones ?? {}).length)!
        const resultado = await useServicios().configuracionEfectiva(conExcepcion.id)
        expect(resultado.ok && resultado.data.facturacion?.excepciones).toEqual(Object.keys(conExcepcion.excepciones ?? {}))
        expect(resultado.ok && resultado.data.facturacion?.dias_gracia).toBe(conExcepcion.excepciones?.dias_gracia)
    })

    it('la ficha del servicio muestra ambas secciones', async () => {
        const pagina = await mountSuspended(PaginaServicio, { route: '/servicios/1' })
        await esperar(() => expect(pagina.find('[data-prueba="configuracion-efectiva"]').text()).toContain('Rate-limit activo'))
        expect(pagina.find('[data-prueba="planes-temporales"]').text()).toContain('Sin planes temporales')
        expect(pagina.find('[data-prueba="programar-plan-temporal"]').exists()).toBe(true)
        pagina.unmount()
    })
})

describe('plan por router y direccionamiento del router', () => {
    it('implementar crea sin version y editar exige la leída; la garantía respeta el reuso', async () => {
        const nueva = await usePlanes().implementar(1, 2, { profile_ppp: 'argos-mixco', reuso: 4 })
        expect(nueva.ok && [nueva.data.version, nueva.data.profile_ppp, nueva.data.reuso]).toEqual([1, 'argos-mixco', 4])
        const sinVersion = await usePlanes().implementar(1, 2, { profile_ppp: 'otro' })
        expect(!sinVersion.ok && sinVersion.problema.status).toBe(409)
        const garantia = await usePlanes().implementar(1, 2, { version: 1, garantizado_pct: 50 })
        expect(!garantia.ok && garantia.problema.errors?.[0]?.field).toBe('garantizado_pct')
        const lista = await usePlanes().implementaciones(1)
        expect(lista.ok && lista.data.map(i => i.router_id).sort()).toEqual([1, 2])
    })

    it('router nuevo, red IPv4 sin solapar y pool IPv6 dentro de un bloque', async () => {
        const router = await useRouters().crear({ nombre: 'RB-Norte', host: '10.40.0.1', nas_ip: '10.40.0.1', radius_secret: 'secreto' })
        expect(router.ok && [router.data.tiene_radius_secret, router.data.tiene_api_password]).toEqual([true, false])
        const id = router.ok ? router.data.id : 0
        const repetido = await useRouters().crear({ nombre: 'Otro', host: 'x', nas_ip: '10.40.0.1' })
        expect(!repetido.ok && repetido.problema.errors?.[0]?.field).toBe('nas_ip')
        const red = await useRouters().agregarRed(id, { cidr: '100.64.40.0/24', tipo: 'pool' })
        expect(red.ok).toBe(true)
        const solapada = await useRouters().agregarRed(id, { cidr: '100.64.40.0/24', tipo: 'pool' })
        expect(!solapada.ok && solapada.problema.errors?.[0]?.rule).toBe('solapamiento')
        const bloque = await useRouters().agregarBloque(id, { prefijo: '2803:d100:4000::/40' })
        const bloqueId = bloque.ok ? bloque.data.id : 0
        const enlaceMal = await useIpv6Pools().crear(bloqueId, { prefijo: '2803:d100:4000::/44', tipo: 'enlace', tamano_entrega: 56 })
        expect(!enlaceMal.ok && enlaceMal.problema.errors?.[0]?.field).toBe('tamano_entrega')
        const pool = await useIpv6Pools().crear(bloqueId, { prefijo: '2803:d100:4000::/44', tipo: 'enlace', tamano_entrega: 64 })
        expect(pool.ok && pool.data.bloque_id).toBe(bloqueId)
    })

    it('las fichas del plan y del router muestran implementación y direccionamiento', async () => {
        const plan = await mountSuspended(PaginaPlan, { route: '/planes/1' })
        await esperar(() => expect(plan.find('[data-implementacion="1"]').exists()).toBe(true))
        expect(plan.find('[data-implementacion="1"]').text()).toContain('profile argos-hogar')
        plan.unmount()
        const router = await mountSuspended(PaginaRouter, { route: '/routers/1' })
        await esperar(() => expect(router.find('[data-pool="2"]').exists()).toBe(true))
        expect(router.find('[data-prueba="redes-router"]').text()).toContain('100.64.10.0/24')
        expect(router.find('[data-bloque="1"]').text()).toContain('Delegación · /56')
        router.unmount()
    })
})
