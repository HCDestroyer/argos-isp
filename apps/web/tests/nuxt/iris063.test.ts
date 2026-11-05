import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import {
    conectorIrisAnterior063,
    conectorIrisCanjeConfirmado,
    conectorIrisCanjePendiente,
    conectorIrisDesconectado,
    conectorIrisInicial,
    conectorIrisReconexionPendiente,
} from '~~/fixtures/iris/datos'
import { CLAVE_IRIS_CANJE } from '~~/fixtures/iris/rutas'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { UApp } from '#components'
import PaginaIris from '~/pages/configuracion/integraciones/iris.vue'
import PaginaIntegraciones from '~/pages/configuracion/integraciones/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Contrato Iris 0.6.3: estado del canje del enlace de conexión. `pendiente` lleva una marca
 * informativa con la hora de vencimiento (Guatemala); `desconectado` un aviso de error con el motivo
 * en español, la fecha y «Generar enlace de conexión»; `confirmado`, null o una API anterior (sin los
 * campos) no muestran nada.
 */

const conApp = (componente: Component) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente) }),
})

const CANJE = new Date('2026-11-05T16:00:00.000Z')
const DESCONEXION = new Date('2026-11-05T18:45:00.000Z')

describe('iris 0.6.3 · utilidades', () => {
    it('pendiente trae su vencimiento; confirmado, null y sin campos no avisan', () => {
        expect(avisoCanjeIris(conectorIrisCanjePendiente(CANJE))).toEqual({ estado: 'pendiente', venceEn: '2026-11-06T16:00:00.000Z' })
        expect(avisoCanjeIris(conectorIrisCanjeConfirmado(CANJE))).toBeNull()
        expect(avisoCanjeIris(conectorIrisInicial)).toBeNull()
        expect(avisoCanjeIris(conectorIrisAnterior063())).toBeNull()
        // pendiente sin canje_vence_en: la marca sin hora, nunca una hora inventada
        expect(avisoCanjeIris({ ...conectorIrisCanjePendiente(CANJE), canje_vence_en: undefined })).toEqual({ estado: 'pendiente', venceEn: null })
    })

    it('desconectado: motivo en español y fecha; lo que falta se omite', () => {
        expect(avisoCanjeIris(conectorIrisDesconectado('revocado_por_iris', DESCONEXION))).toEqual({
            estado: 'desconectado',
            titulo: 'Iris está desconectado',
            motivo: 'Iris rechazó la conexión',
            desconectadoEn: DESCONEXION.toISOString(),
        })
        expect(avisoCanjeIris(conectorIrisDesconectado('canje_sin_uso', DESCONEXION))).toMatchObject({ motivo: 'La conexión no se activó en 24 h' })
        const sinDatos = avisoCanjeIris({ ...conectorIrisDesconectado('canje_sin_uso'), motivo_desconexion: undefined, desconectado_en: undefined })
        expect(sinDatos).toMatchObject({ estado: 'desconectado', motivo: null, desconectadoEn: null })
        expect(sinDatos?.estado === 'desconectado' ? textoDesconexionIris(sinDatos) : 'x').toBeNull()
    })

    it('fechas en hora de Guatemala (UTC-6)', () => {
        const aviso = avisoCanjeIris(conectorIrisDesconectado('revocado_por_iris', DESCONEXION))
        expect(aviso?.estado === 'desconectado' ? textoDesconexionIris(aviso) : null).toBe(`Iris rechazó la conexión · desconectado el ${formatearFechaHora(DESCONEXION)}`)
        expect(formatearFechaHora(DESCONEXION)).toMatch(/12:45/)
        expect(MARCA_CANJE_PENDIENTE_IRIS).toMatchObject({ color: 'info', etiqueta: 'Esperando que Iris active la conexión' })
        expect(MARCA_DESCONECTADO_IRIS.color).toBe('error')
        expect(MARCA_DESCONECTADO_IRIS.icono).toMatch(/^i-lucide-/)
    })

    it('reconexión: solo con reconexion_pendiente_desde; sin vencimiento se omite la hora', () => {
        expect(avisoReconexionIris(conectorIrisReconexionPendiente(CANJE))).toEqual({ desde: CANJE.toISOString(), venceEn: '2026-11-06T16:00:00.000Z' })
        expect(avisoReconexionIris(conectorIrisInicial)).toBeNull()
        expect(avisoReconexionIris(conectorIrisAnterior063())).toBeNull()
        expect(avisoReconexionIris({ ...conectorIrisCanjeConfirmado(CANJE), reconexion_pendiente_desde: undefined, reconexion_vence_en: '2026-11-06T16:00:00.000Z' })).toBeNull()
        const sinHora = avisoReconexionIris({ ...conectorIrisReconexionPendiente(CANJE), reconexion_vence_en: undefined })
        expect(sinHora).toEqual({ desde: CANJE.toISOString(), venceEn: null })
        expect(textoReconexionIris(sinHora!)).toBe('Iris aún no la activa; mientras tanto sigue la conexión actual.')
        expect(MARCA_RECONEXION_PENDIENTE_IRIS.color).toBe('info')
    })

    it('las fixtures son fieles a la API: inicial con los cuatro campos en null, desconectado sin secretos', () => {
        expect(conectorIrisInicial).toMatchObject({ estado_canje: null, canje_vence_en: null, desconectado_en: null, motivo_desconexion: null })
        expect(conectorIrisDesconectado('canje_sin_uso')).toMatchObject({ activo: false, token: null, webhook_salida_secreto: null, webhook_entrada_secreto: null, canje_vence_en: null })
        expect('estado_canje' in conectorIrisAnterior063()).toBe(false)
        expect('reconexion_pendiente_desde' in conectorIrisAnterior063()).toBe(false)
        expect(conectorIrisInicial).toMatchObject({ reconexion_pendiente_desde: null, reconexion_vence_en: null })
    })
})

describe('iris 0.6.3 · pantalla', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.removeItem(CLAVE_IRIS_CANJE)
        vi.restoreAllMocks()
    })

    it('pendiente: marca informativa con la hora de vencimiento, sin aviso de desconexión', async () => {
        bd.iris.conector = conectorIrisCanjePendiente(CANJE)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="marca-canje-pendiente-iris"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="marca-canje-pendiente-iris"]').text()).toBe('Esperando que Iris active la conexión')
        expect(vista.get('[data-prueba="canje-vence-iris"]').text()).toContain(formatearFechaHora('2026-11-06T16:00:00.000Z'))
        expect(vista.find('[data-prueba="aviso-desconectado-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="marca-desconectado-iris"]').exists()).toBe(false)
    })

    it.each([
        ['revocado_por_iris', 'Iris rechazó la conexión'],
        ['canje_sin_uso', 'La conexión no se activó en 24 h'],
    ] as const)('desconectado (%s): aviso de error con motivo, fecha y el enlace', async (motivo, texto) => {
        bd.iris.conector = conectorIrisDesconectado(motivo, DESCONEXION)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-desconectado-iris"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="aviso-desconectado-iris"]')
        expect(aviso.attributes('role')).toBe('alert')
        expect(aviso.html()).toMatch(/error/)
        expect(aviso.find('.iconify, [class*="i-lucide-unplug"], svg').exists()).toBe(true)
        expect(vista.get('[data-prueba="motivo-desconexion-iris"]').text()).toBe(texto)
        expect(vista.get('[data-prueba="desconectado-en-iris"]').text()).toContain(formatearFechaHora(DESCONEXION))
        expect(vista.get('[data-prueba="marca-desconectado-iris"]').text()).toBe('Desconectada')
        expect(vista.find('[data-prueba="marca-canje-pendiente-iris"]').exists()).toBe(false)

        const boton = aviso.findAll('button').find(b => b.text().trim() === 'Generar enlace de conexión')
        expect(boton).toBeDefined()
        await boton!.trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="valor-Enlace"]')?.textContent ?? '').toMatch(/\/conectar#\w{20,}/))
    })

    it('desconectado sin iris.configurar: el aviso se ve, sin el botón del enlace', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'iris.configurar') }
        bd.iris.conector = conectorIrisDesconectado('revocado_por_iris', DESCONEXION)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-desconectado-iris"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="aviso-desconectado-iris"]')
        expect(aviso.findAll('button').some(b => b.text().includes('Generar enlace'))).toBe(false)
        expect(aviso.text()).toContain('requiere el permiso para configurar Iris')
    })

    it.each([
        ['confirmado', () => conectorIrisCanjeConfirmado(CANJE)],
        ['null', () => structuredClone(conectorIrisInicial)],
        ['API anterior a 0.6.3', () => conectorIrisAnterior063()],
    ])('%s: nada nuevo', async (_nombre, conector) => {
        bd.iris.conector = conector()
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').exists()).toBe(true))
        for (const prueba of ['marca-canje-pendiente-iris', 'canje-vence-iris', 'aviso-desconectado-iris', 'marca-desconectado-iris', 'marca-reconexion-iris', 'reconexion-vence-iris']) {
            expect(vista.find(`[data-prueba="${prueba}"]`).exists()).toBe(false)
        }
    })

    it('índice: la tarjeta lleva la marca del canje pendiente con su vencimiento', async () => {
        bd.iris.conector = conectorIrisCanjePendiente(CANJE)
        const vista = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(vista.find('[data-prueba="marca-canje-pendiente-tarjeta-iris"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="canje-vence-tarjeta-iris"]').text()).toBe(`Vence el ${formatearFechaHora('2026-11-06T16:00:00.000Z')}`)
        expect(vista.find('[data-prueba="marca-desconectado-tarjeta-iris"]').exists()).toBe(false)
    })

    it('índice: la tarjeta de un conector desconectado lleva la marca, el motivo y la fecha', async () => {
        bd.iris.conector = conectorIrisDesconectado('canje_sin_uso', DESCONEXION)
        const vista = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(vista.find('[data-prueba="marca-desconectado-tarjeta-iris"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="estado-tarjeta-iris"]').text()).toBe('Apagada')
        expect(vista.get('[data-prueba="motivo-desconexion-tarjeta-iris"]').text()).toBe(`La conexión no se activó en 24 h · desconectado el ${formatearFechaHora(DESCONEXION)}`)

        bd.iris.conector = conectorIrisAnterior063()
        const anterior = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(anterior.find('[data-prueba="estado-tarjeta-iris"]').text()).toBe('Activa'))
        expect(anterior.find('[data-prueba="marca-canje-pendiente-tarjeta-iris"]').exists()).toBe(false)
        expect(anterior.find('[data-prueba="marca-desconectado-tarjeta-iris"]').exists()).toBe(false)
    })

    it.each(['revocado_por_iris', 'canje_sin_uso'] as const)('encender a mano tras %s lo deja configurado a mano (fixture como ConfigurarIris)', async (motivo) => {
        bd.iris.conector = { ...conectorIrisDesconectado(motivo, DESCONEXION), token: '***' }
        const respuesta = await useIris().guardar({ activo: true, version: bd.iris.conector.version })
        expect(respuesta.ok).toBe(true)
        expect(bd.iris.conector).toMatchObject({
            activo: true,
            estado_canje: null,
            canje_vence_en: null,
            conectado_por_enlace_en: null,
            token_argos_id: null,
            desconectado_en: null,
            motivo_desconexion: null,
            reconexion_pendiente_desde: null,
            reconexion_vence_en: null,
        })
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').text()).toBe('Activa'))
        for (const prueba of ['marca-canje-pendiente-iris', 'canje-vence-iris', 'aviso-desconectado-iris', 'marca-reconexion-iris']) {
            expect(vista.find(`[data-prueba="${prueba}"]`).exists()).toBe(false)
        }
    })

    it('reconexión pendiente: marca informativa con la hora de Guatemala y que sigue la conexión actual', async () => {
        bd.iris.conector = conectorIrisReconexionPendiente(CANJE)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="marca-reconexion-iris"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="marca-reconexion-iris"]').text()).toBe('Reconexión pendiente')
        expect(vista.get('[data-prueba="reconexion-vence-iris"]').text()).toBe(`Iris la activa antes del ${formatearFechaHora('2026-11-06T16:00:00.000Z')}; mientras tanto sigue la conexión actual.`)
        expect(vista.get('[data-prueba="estado-conector-iris"]').text()).toBe('Activa')
        expect(vista.find('[data-prueba="aviso-desconectado-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="marca-canje-pendiente-iris"]').exists()).toBe(false)

        const indice = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(indice.find('[data-prueba="marca-reconexion-tarjeta-iris"]').exists()).toBe(true))
        expect(indice.get('[data-prueba="reconexion-vence-tarjeta-iris"]').text()).toContain('mientras tanto sigue la conexión actual')
    })

    it('la clave de Playwright elige el estado del canje en el GET', async () => {
        localStorage.setItem(CLAVE_IRIS_CANJE, 'revocado_por_iris')
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-desconectado-iris"]').exists()).toBe(true))
        expect(bd.iris.conector.motivo_desconexion).toBe('revocado_por_iris')
    })
})
