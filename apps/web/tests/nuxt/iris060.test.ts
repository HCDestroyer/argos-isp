import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { UApp } from '#components'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { COMPROBANTE_IRIS } from '~~/fixtures/comprobantes/datos'
import { CLIENTE_ACEPTA_WHATSAPP, CLIENTE_BAJA_IRIS } from '~~/fixtures/notificaciones/datosWhatsapp'
import PaginaComprobante from '~/pages/comprobantes/[id].vue'
import PaginaComprobantes from '~/pages/comprobantes/index.vue'
import PaginaPromesas from '~/pages/promesas/index.vue'
import PaginaBitacora from '~/pages/bitacora/index.vue'
import ClienteWhatsapp from '~/components/ClienteWhatsapp.vue'
import { esperar } from '../ayudas/esperar'

/** La página usa `UTooltip`: necesita el `TooltipProvider` de `UApp`, como en la app real. */
function conApp(componente: ReturnType<typeof defineComponent>) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

describe('contrato Iris 0.6.0 en el panel', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('utilidades', () => {
        it('confianza, lectura y actor de Iris en palabras, sin inventar', () => {
            expect(textoConfianza('0.92')).toBe('92 %')
            expect(textoConfianza('')).toBeNull()
            expect(textoConfianza('1.5')).toBeNull()
            expect(textoConfianza(null)).toBeNull()
            expect(resumenLecturaIris({ canal: 'iris', leido_por: 'ia', confianza: '0.92', canal_contacto: 'whatsapp' })).toBe('Leído por IA · 92 % · WhatsApp')
            expect(resumenLecturaIris({ canal: 'iris', leido_por: null, confianza: null, canal_contacto: null })).toBe('Llegó por Iris')
            expect(resumenLecturaIris({ canal: 'portal', leido_por: null, confianza: null, canal_contacto: null })).toBeNull()
            expect(textoActorIris('asistente_ia')).toBe('Asistente de IA de Iris')
            expect(textoActorIris('usuario:ana-77')).toBe('Persona en Iris (ana-77)')
            expect(textoActorIris(null)).toBeNull()
            expect(origenIris({ iris_actor: 'asistente_ia', iris_conversacion: 'wa:1' })).toBe('Iris · asistente de IA · conversación wa:1')
            expect(origenIris({ iris_actor: null, iris_conversacion: null })).toBeNull()
        })

        it('el esquema de rechazo exige motivo y una causa del contrato (incluida falta_dato)', () => {
            expect(esquemaRechazarComprobante.safeParse({ causa: 'falta_dato', motivo: 'Falta el número de boleta' }).success).toBe(true)
            expect(esquemaRechazarComprobante.safeParse({ causa: 'falta_dato', motivo: 'no' }).success).toBe(false)
            expect(esquemaRechazarComprobante.safeParse({ causa: 'inventada', motivo: 'Algo pasó' }).success).toBe(false)
            expect(Object.keys(CAUSAS_RECHAZO)).toEqual(['no_aparece', 'monto_distinto', 'ilegible', 'falta_dato', 'duplicado', 'otro'])
        })

        it('reconexión temporal: apagada por defecto, rangos del validador y resumen', () => {
            const entrada = entradaPlantillaVacia()
            expect(entrada.reglas_promesa.reconexion_temporal).toEqual({ permitida: false, max_por_periodo: 1, horas_max: 24 })
            const fuera = structuredClone(entrada)
            fuera.nombre = 'Prueba'
            fuera.reglas_promesa.reconexion_temporal.horas_max = 200
            const resultado = esquemaPlantilla.safeParse(fuera)
            expect(!resultado.success && resultado.error.issues[0]?.path.join('.')).toBe('reglas_promesa.reconexion_temporal.horas_max')
            const reglas = bd.plantillas[0]!.reglas_promesa
            expect(resumenReconexionTemporal(reglas)).toBe('Reconexión temporal apagada')
            expect(resumenReconexionTemporal({ ...reglas, reconexion_temporal: { permitida: true, max_por_periodo: 1, horas_max: 24 } })).toBe('Reconexión temporal: hasta 1 por periodo · 24 h')
        })

        it('WhatsApp: baja de Iris, sin registro y casilla inicial', () => {
            expect(bajaDesdeIris({ estado: 'baja', ocurrido_en: '2026-10-14T02:15:00.000Z', origen: 'iris_cliente' })).toBe(true)
            expect(bajaDesdeIris({ estado: 'baja', ocurrido_en: '2026-10-14T02:15:00.000Z', origen: 'iris_vigente' })).toBe(true)
            expect(bajaDesdeIris({ estado: 'baja', ocurrido_en: '2026-10-14T02:15:00.000Z', origen: 'argos_panel' })).toBe(false)
            expect(presentacionContactoWhatsapp(null).etiqueta).toBe('Sin permiso registrado')
            expect(aceptaWhatsapp(null)).toBe(false)
        })
    })

    describe('cola de caja', () => {
        it('filtra canal=iris y trae la lectura de Iris', async () => {
            const lista = await useComprobantes().listar({ canal: 'iris' })
            expect(lista.ok && lista.data.data.map(c => c.id)).toEqual([COMPROBANTE_IRIS.id])
            expect(lista.ok && lista.data.data[0]).toMatchObject({ leido_por: 'ia', confianza: '0.92', canal_contacto: 'whatsapp', iris_conversacion: COMPROBANTE_IRIS.conversacion })
            const portal = await useComprobantes().listar({ canal: 'portal', estado: 'pendiente' })
            expect(portal.ok && portal.data.data.every(c => c.canal === 'portal' && c.leido_por === null)).toBe(true)
        })

        it('la lista marca «Llegó por Iris» con su lectura', async () => {
            const wrapper = await mountSuspended(PaginaComprobantes, { route: '/comprobantes?canal=iris' })
            await esperar(() => expect(wrapper.find('[data-prueba="fila-iris"]').exists()).toBe(true))
            expect(wrapper.text()).toContain('Llegó por Iris')
            expect(wrapper.text()).toContain('Leído por IA · 92 % · WhatsApp')
            wrapper.unmount()
        })

        it('el detalle muestra la lectura, el botón de conversación deshabilitado con su porqué y la reconexión activa', async () => {
            const wrapper = await mountSuspended(conApp(PaginaComprobante), { route: `/comprobantes/${COMPROBANTE_IRIS.id}` })
            await esperar(() => expect(wrapper.find('[data-prueba="aviso-reconexion"]').exists()).toBe(true))
            const lectura = wrapper.find('[data-prueba="lectura-iris"]')
            expect(lectura.text()).toContain('Leído por IA')
            expect(lectura.text()).toContain('92 %')
            expect(lectura.text()).toContain('WhatsApp')
            expect(lectura.text()).toContain('Asistente de IA de Iris')
            expect(lectura.text()).toContain(COMPROBANTE_IRIS.conversacion)
            const boton = wrapper.find('[data-prueba="ver-conversacion-iris"]')
            expect(boton.attributes('disabled')).toBeDefined()
            expect(lectura.text()).toContain('pedido B2')
            expect(wrapper.find('[data-prueba="aviso-reconexion"]').text()).toContain('Rechazarlo vuelve a cortar el servicio a la hora de corte')
            wrapper.unmount()
        })

        it('sin poder leer las promesas, el aviso de reconexión es un error con «Reintentar»', async () => {
            simularFalla('GET /api/v1/promesas', 500)
            const wrapper = await mountSuspended(conApp(PaginaComprobante), { route: `/comprobantes/${COMPROBANTE_IRIS.id}` })
            await esperar(() => expect(wrapper.find('[data-prueba="error-reconexion"]').exists()).toBe(true))
            expect(wrapper.text()).toContain('Reintentar')
            expect(wrapper.find('[data-prueba="aviso-reconexion"]').exists()).toBe(false)
            wrapper.unmount()
        })

        it('rechazar con causa falta_dato guarda la causa y cancela la reconexión temporal', async () => {
            const rechazado = await useComprobantes().rechazar(COMPROBANTE_IRIS.id, { motivo: 'Falta el número de boleta', causa: 'falta_dato' }, nuevaClaveIdempotencia())
            expect(rechazado.ok && rechazado.data).toMatchObject({ estado: 'rechazado', causa_rechazo: 'falta_dato' })
            const promesas = await usePromesas().listar({ tipo: 'reconexion_temporal', estado: 'cancelada' })
            const cancelada = promesas.ok ? promesas.data.data.find(p => p.comprobante_id === COMPROBANTE_IRIS.id) : undefined
            expect(cancelada?.estado).toBe('cancelada')
            expect(ultimoPaso(leerEvaluacion(cancelada!).evaluacion)).toContain('caja rechazó el comprobante')
            const sinCausa = await useComprobantes().rechazar(4, { motivo: 'No coincide con el banco' }, nuevaClaveIdempotencia())
            expect(sinCausa.ok && sinCausa.data.causa_rechazo).toBe('otro')
        })
    })

    describe('promesas', () => {
        it('lista tipo, canal ia, comprobante y la cancelada con su motivo', async () => {
            const wrapper = await mountSuspended(PaginaPromesas, { route: '/promesas?tipo=reconexion_temporal' })
            await esperar(() => expect(wrapper.findAll('[data-prueba="tipo-promesa"]').length).toBe(2))
            expect(wrapper.text()).toContain('Reconexión temporal')
            expect(wrapper.text()).toContain('(ia)')
            expect(wrapper.findAll('[data-prueba="promesa-comprobante"]').map(e => e.text())).toEqual(['Comprobante #1', `Comprobante #${COMPROBANTE_IRIS.id}`])
            expect(wrapper.find('[data-prueba="promesa-iris"]').exists()).toBe(true)
            expect(wrapper.text()).toContain('la reconexión temporal venció con el comprobante sin revisar')
            wrapper.unmount()
        })
    })

    describe('WhatsApp', () => {
        it('la ficha muestra la baja que llegó de Iris', async () => {
            const wrapper = await mountSuspended(ClienteWhatsapp, { props: { clienteId: CLIENTE_BAJA_IRIS } })
            await esperar(() => expect(wrapper.find('[data-prueba="whatsapp-baja-iris"]').exists()).toBe(true))
            expect(wrapper.find('[data-prueba="whatsapp-contacto"]').text()).toBe('Baja dada en Iris')
            expect(wrapper.find('[data-prueba="whatsapp-no-disponible"]').text()).toContain('apagado')
            wrapper.unmount()
        })

        it('con error, «Reintentar» y ningún estado supuesto', async () => {
            simularFalla('GET /api/v1/notificaciones/whatsapp/clientes/:id', 500)
            const wrapper = await mountSuspended(ClienteWhatsapp, { props: { clienteId: CLIENTE_ACEPTA_WHATSAPP } })
            await esperar(() => expect(wrapper.text()).toContain('Reintentar'))
            expect(wrapper.find('[data-prueba="whatsapp-contacto"]').exists()).toBe(false)
            wrapper.unmount()
        })

        it('registrar el permiso queda en cola hacia Iris y cambia el estado', async () => {
            const registrado = await useConsentimientosWhatsapp().registrar({ cliente_id: CLIENTE_BAJA_IRIS, estado: 'acepta' }, nuevaClaveIdempotencia())
            expect(registrado.ok && registrado.data).toMatchObject({ estado: 'acepta', entrega: 'pendiente', origen: 'argos_panel', canal: 'whatsapp' })
            const estado = await useConsentimientosWhatsapp().estadoCliente(CLIENTE_BAJA_IRIS)
            expect(estado.ok && estado.data.contacto?.estado).toBe('acepta')
        })

        it('el cajero no tiene notificaciones.registrar_consentimiento', async () => {
            sesionFixture('fixture-cajero')
            useUsuarioActual().value = meCajero
            const resultado = await useConsentimientosWhatsapp().registrar({ cliente_id: 2, estado: 'acepta' }, nuevaClaveIdempotencia())
            expect(!resultado.ok && resultado.problema.status).toBe(403)
        })

        it('el interruptor whatsapp.activo viaja en la configuración', async () => {
            const config = await useNotificaciones().ver(null)
            expect(config.ok && config.data.whatsapp.activo).toBe(false)
            if (!config.ok) {
                return
            }
            const form = formularioNotificaciones(config.data)
            form.whatsapp.activo = true
            const cuerpo = cuerpoNotificaciones(form, config.data.version, false)
            expect(cuerpo.whatsapp).toEqual({ activo: true })
            const guardado = await useNotificaciones().guardar(null, cuerpo)
            expect(guardado.ok && guardado.data.whatsapp.activo).toBe(true)
        })
    })

    describe('bitácora', () => {
        it('filtra por conversación de Iris y muestra quién en Iris', async () => {
            const acciones = await useBitacora().acciones({ iris_conversacion: COMPROBANTE_IRIS.conversacion })
            expect(acciones.ok && acciones.data.data.map(a => a.accion).sort()).toEqual(['clientes.verificar_identidad', 'comprobantes.reconexion_temporal', 'comprobantes.registrar'])
            const wrapper = await mountSuspended(PaginaBitacora, { route: `/bitacora?conversacion=${COMPROBANTE_IRIS.conversacion}` })
            await esperar(() => expect(wrapper.findAll('[data-prueba="origen-iris"]').length).toBe(3))
            expect(wrapper.text()).toContain('Reconexión temporal mientras se revisa el comprobante')
            expect(wrapper.text()).toContain(`Iris · asistente de IA · conversación ${COMPROBANTE_IRIS.conversacion}`)
            wrapper.unmount()
        })
    })
})
