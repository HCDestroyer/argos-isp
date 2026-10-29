import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import ServicioCredenciales from '~/components/ServicioCredenciales.vue'
import { esperar } from '../ayudas/esperar'

describe('ficha de servicio · composables', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    async function servicio(id: number): Promise<Servicio> {
        const resultado = await useServicios().ver(id)
        if (!resultado.ok) {
            throw new Error(resultado.problema.title)
        }
        return resultado.data
    }

    it('suspender → reactivar con motivo e Idempotency-Key', async () => {
        const api = useServicios()
        expect((await servicio(5)).estado).toBe('activo')

        const clave = nuevaClaveIdempotencia()
        const suspendido = await api.ejecutar(5, 'suspender', 'Solicitud del cliente', clave)
        expect(suspendido.ok && suspendido.data.estado).toBe('suspendido')

        // Repetir la misma clave devuelve la misma respuesta y no falla por el estado nuevo.
        const repetido = await api.ejecutar(5, 'suspender', 'Solicitud del cliente', clave)
        expect(repetido.ok && repetido.data.version).toBe(suspendido.ok && suspendido.data.version)

        const reactivado = await api.ejecutar(5, 'reactivar', 'Pagó en agencia', nuevaClaveIdempotencia())
        expect(reactivado.ok && reactivado.data.estado).toBe('activo')
    })

    it('limitar y quitar límite; una acción fuera de estado es 422', async () => {
        const api = useServicios()
        const limitado = await api.ejecutar(5, 'limitar', 'Factura vencida', nuevaClaveIdempotencia())
        expect(limitado.ok && limitado.data.estado).toBe('limitado')

        const otraVez = await api.ejecutar(5, 'limitar', 'Factura vencida', nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.status).toBe(422)

        const sinLimite = await api.ejecutar(5, 'quitar_limite', 'Pagó', nuevaClaveIdempotencia())
        expect(sinLimite.ok && sinLimite.data.estado).toBe('activo')
    })

    it('retirar libera IPv4 y prefijos y cierra la sesión', async () => {
        const retirado = await useServicios().ejecutar(1, 'retirar', 'Se mudó fuera de cobertura', nuevaClaveIdempotencia())
        expect(retirado.ok).toBe(true)
        if (retirado.ok) {
            expect(retirado.data.estado).toBe('retirado')
            expect(retirado.data.ipv4).toBeNull()
            expect(retirado.data.prefijo_delegado_v6).toBeNull()
        }
        const sesion = await useSesiones().activaDe(1)
        expect(sesion.ok && sesion.data).toBeNull()
    })

    it('el motivo es obligatorio (espejo del validador) y la API lo vuelve a validar', async () => {
        expect(esquemaMotivo.safeParse({ motivo: 'ok' }).success).toBe(false)
        expect(esquemaMotivo.safeParse({ motivo: '  Pagó en caja  ' }).data?.motivo).toBe('Pagó en caja')
        const sinMotivo = await useServicios().ejecutar(5, 'suspender', '', nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.status).toBe(422)
    })

    it('un 501 de la API llega como Problem sin romper', async () => {
        simularFalla('POST /api/v1/servicios/:id/suspender', 501)
        const resultado = await useServicios().ejecutar(5, 'suspender', 'Prueba', nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.title).toBe('Operación no disponible')
        expect((await servicio(5)).estado).toBe('activo')
    })

    it('las acciones exigen su permiso: cajero no suspende', async () => {
        sesionFixture('fixture-cajero')
        const resultado = await useServicios().ejecutar(5, 'suspender', 'Prueba', nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })

    it('credenciales: requieren servicios.ver_credenciales y quedan auditadas', async () => {
        const resultado = await useServicios().credenciales(5)
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            expect(resultado.data.user_ppp).toBe((await servicio(5)).user_ppp)
            expect(resultado.data.pass_ppp).toMatch(/^\w{12}$/)
        }
        const bitacora = await useBitacora().acciones({ entidad_tipo: 'servicio', entidad_id: 5, accion: 'servicios.ver_credenciales' })
        expect(bitacora.ok && bitacora.data.data).toHaveLength(1)

        sesionFixture('fixture-cajero')
        const sinPermiso = await useServicios().credenciales(5)
        expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
    })

    it('sesión activa del servicio con sus direcciones', async () => {
        const activo = await servicio(1)
        const sesion = await useSesiones().activaDe(1)
        expect(sesion.ok).toBe(true)
        if (sesion.ok && sesion.data) {
            expect(sesion.data.fin).toBeNull()
            expect(sesion.data.ipv4).toBe(activo.ipv4)
            expect(sesion.data.prefijo_delegado_v6).toBe(activo.prefijo_delegado_v6)
        }
    })

    it('la contraseña solo se pide al hacer clic en "Mostrar"', async () => {
        const wrapper = await mountSuspended(ServicioCredenciales, { props: { servicio: await servicio(5) } })
        expect(wrapper.text()).toContain('••••')
        const antes = await useBitacora().acciones({ accion: 'servicios.ver_credenciales' })
        expect(antes.ok && antes.data.data).toHaveLength(0)

        await wrapper.findAll('button').find(b => b.text().includes('Mostrar'))?.trigger('click')
        await esperar(() => expect(wrapper.text()).toContain('Ocultar'))
        expect(wrapper.text()).not.toContain('••••')
    })

    it('presentación de acciones: permisos del catálogo y estados de origen', () => {
        const porAccion = Object.fromEntries(ACCIONES_SERVICIO.map(a => [a.accion, a]))
        expect(porAccion.quitar_limite?.permiso).toBe('servicios.quitar_limite')
        expect(porAccion.reactivar?.desde).toEqual(['suspendido'])
        expect(porAccion.retirar?.desde).not.toContain('retirado')
        expect(ACCIONES_SERVICIO.every(a => a.permiso === `servicios.${a.accion}`)).toBe(true)
        expect(formatearBytes(7_412_000_000)).toBe('7.4 GB')
        expect(formatearDuracion('2026-10-09T03:14:00Z', null, new Date('2026-10-15T14:30:00Z'))).toBe('6 d 11 h')
    })
})
