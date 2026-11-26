import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaCartera from '~/pages/cartera/index.vue'
import PaginaFinanzas from '~/pages/finanzas/index.vue'
import PaginaLibro from '~/pages/libro/index.vue'
import PaginaReporte from '~/pages/reportes/[reporte].vue'
import PaginaReportes from '~/pages/reportes/index.vue'
import { esperar } from '../ayudas/esperar'

const DOS_LINEAS = [
    { cuenta: '5.3.05', debe: '10.00', haber: null, cliente_id: null, proveedor_id: null },
    { cuenta: '1.1.01.01', debe: null, haber: '10.00', cliente_id: null, proveedor_id: null },
]

describe('plan de contabilidad P2 · lo que estaba apagado', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    describe('asiento manual y por aprobar', () => {
        it('sin aprobación el asiento queda en el libro; descuadrado se rechaza con 422', async () => {
            const bien = await useLibro().registrarAsiento({ descripcion: 'Ajuste de redondeo', movimientos: DOS_LINEAS }, 'k-1')
            expect(bien.ok && bien.data.estado).toBe('registrado')
            const id = bien.ok ? bien.data.asiento_id : null
            expect(bd.asientos.some(a => a.id === id && a.origen_tipo === 'ajuste')).toBe(true)

            const mal = await useLibro().registrarAsiento({ descripcion: 'No cuadra', movimientos: [DOS_LINEAS[0]!, { ...DOS_LINEAS[1]!, haber: '9.00' }] }, 'k-2')
            expect(mal.ok).toBe(false)
            expect(!mal.ok && mal.problema.status).toBe(422)
        })

        it('con aprobación queda como borrador; quien lo creó no lo aprueba y otra persona sí', async () => {
            bd.operacionPm.ajustesCobro[1] = { empresa_id: 1, asientos_requieren_aprobacion: true, pausa_tope_dias: 90, version: 1, updated_by: null, updated_at: null }
            const asientosAntes = bd.asientos.length
            const creado = await useLibro().registrarAsiento({ descripcion: 'Ajuste con aprobación', movimientos: DOS_LINEAS }, 'k-3')
            expect(creado.ok && creado.data.estado).toBe('pendiente_aprobacion')
            expect(bd.asientos).toHaveLength(asientosAntes)
            const propio = creado.ok ? creado.data.borrador : null
            expect(propio?.estado).toBe('pendiente')

            const autoaprobar = await useLibro().aprobarBorrador(propio?.id ?? 0, 'k-4')
            expect(!autoaprobar.ok && autoaprobar.problema.status).toBe(403)

            // El borrador de la semilla es de otra persona.
            const aprobado = await useLibro().aprobarBorrador(1, 'k-5')
            expect(aprobado.ok && aprobado.data.estado).toBe('aprobado')
            expect(aprobado.ok && aprobado.data.asiento_id).not.toBeNull()
            expect(bd.asientos).toHaveLength(asientosAntes + 1)
            const otra = await useLibro().aprobarBorrador(1, 'k-6')
            expect(!otra.ok && otra.problema.status).toBe(409)
        })

        it('rechazar pide motivo y no toca el libro', async () => {
            const sinMotivo = await useLibro().rechazarBorrador(2, 'x', 'k-7')
            expect(sinMotivo.ok).toBe(false)
            const asientosAntes = bd.asientos.length
            const rechazado = await useLibro().rechazarBorrador(2, 'falta el comprobante', 'k-8')
            expect(rechazado.ok && rechazado.data.estado).toBe('rechazado')
            expect(rechazado.ok && rechazado.data.motivo_rechazo).toBe('falta el comprobante')
            expect(bd.asientos).toHaveLength(asientosAntes)
        })

        it('la pantalla: «Asiento de ajuste» está activo y «Por aprobar» lista los borradores con su insignia', async () => {
            const vista = await mountSuspended(PaginaLibro, { route: '/libro?tab=aprobar' })
            await esperar(() => expect(vista.find('[data-prueba="tabla-borradores"]').exists()).toBe(true))
            await esperar(() => expect(vista.text()).toContain('Reclasificar depósito sin identificar'))
            const boton = vista.get('[data-prueba="asiento-ajuste"]')
            expect(boton.attributes('disabled')).toBeUndefined()
            expect(vista.text()).toContain('Por aprobar')
            expect(vista.text()).not.toContain('Llega con la API')
        })

        it('con la lectura de borradores en error: aviso y «Reintentar», sin lista', async () => {
            simularFalla('GET /api/v1/libro/borradores', 500)
            const vista = await mountSuspended(PaginaLibro, { route: '/libro?tab=aprobar' })
            await esperar(() => expect(vista.text()).toContain('Reintentar'))
            expect(vista.find('[data-prueba="tabla-borradores"]').exists()).toBe(false)
        })
    })

    describe('gestión de cobro', () => {
        it('registra desde el panel; fuera de los 7 días se rechaza', async () => {
            const bien = await useGestionesCobro().registrar(2, { tipo: 'llamada', resultado: 'promete_pagar', ocurrido_en: new Date().toISOString(), origen_tipo: 'panel', nota: 'Paga el viernes' }, 'g-1')
            expect(bien.ok && bien.data.origen_tipo).toBe('panel')
            const lista = await useGestionesCobro().listar(2)
            expect(lista.ok && lista.data.data.map(g => g.nota)).toEqual(['Paga el viernes'])

            const vieja = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString()
            const mal = await useGestionesCobro().registrar(2, { tipo: 'visita', resultado: 'contesto', ocurrido_en: vieja, origen_tipo: 'panel' }, 'g-2')
            expect(!mal.ok && mal.problema.status).toBe(422)
        })

        it('instante en hora de Guatemala (UTC−6)', () => {
            expect(instanteGuatemala('2026-11-20T09:30')).toBe('2026-11-20T15:30:00.000Z')
        })

        it('la pantalla ya no dice «llega con su API» y el botón aparece al elegir clientes', async () => {
            const vista = await mountSuspended(PaginaCartera, { route: '/cartera' })
            await esperar(() => expect(vista.find('[data-prueba="tabla-por-cobrar"]').exists()).toBe(true))
            expect(vista.text()).not.toContain('llegan con su API')
            expect(vista.find('[data-prueba="registrar-gestion"]').exists()).toBe(false)
        })
    })

    describe('indicadores del panel financiero', () => {
        it('ingreso recurrente, bajas y por servicio salen de GET /panel-financiero', async () => {
            const vista = await mountSuspended(PaginaFinanzas, { route: '/finanzas' })
            await esperar(() => expect(vista.find('[data-kpi="ingreso-recurrente"]').text()).toMatch(/Q\s?[\d,]+\.\d{2}/))
            expect(vista.get('[data-kpi="ingreso-recurrente"]').text()).not.toContain('Sin datos todavía')
            expect(vista.get('[data-kpi="bajas"]').text()).not.toContain('llega con la API')
            expect(vista.get('[data-kpi="por-servicio"]').text()).not.toContain('Sin datos todavía')
        })

        it('con la API en error: «No se pudo leer» con «Reintentar», nunca una cifra', async () => {
            simularFalla('GET /api/v1/panel-financiero', 500)
            const vista = await mountSuspended(PaginaFinanzas, { route: '/finanzas' })
            await esperar(() => expect(vista.get('[data-kpi="ingreso-recurrente"]').text()).toContain('No se pudo leer'))
            expect(vista.get('[data-kpi="ingreso-recurrente"]').text()).toContain('Reintentar')
            expect(vista.get('[data-kpi="bajas"]').text()).not.toMatch(/\d/)
        })

        it('un bloque que no aplica dice su motivo', async () => {
            const panel = await usePanelFinanciero().ver()
            expect(panel.ok && panel.data.empresas[0]?.ingresos?.estado).toBe('ok')
        })
    })

    describe('favoritos y programar envío', () => {
        it('marcar y quitar favorito; un código fuera del catálogo es 404', async () => {
            expect((await useReportesCatalogo().favorito('iva', true)).ok).toBe(true)
            const catalogo = await useReportesCatalogo().listar()
            expect(catalogo.ok && catalogo.data[0]?.codigo).toBe('iva')
            expect(catalogo.ok && catalogo.data[0]?.favorito).toBe(true)
            await useReportesCatalogo().favorito('iva', false)
            const despues = await useReportesCatalogo().listar()
            expect(despues.ok && despues.data.some(r => r.favorito)).toBe(false)
            const malo = await useReportesCatalogo().favorito('balance', true)
            expect(!malo.ok && malo.problema.status).toBe(404)
        })

        it('el catálogo: la estrella marca y «Favoritos» lista solo los marcados', async () => {
            const vista = await mountSuspended(PaginaReportes, { route: '/reportes' })
            await esperar(() => expect(vista.find('[data-favorito="cartera-vencida"]').exists()).toBe(true))
            await vista.get('[data-favorito="cartera-vencida"]').trigger('click')
            await esperar(() => expect(vista.get('[data-favorito="cartera-vencida"]').attributes('aria-pressed')).toBe('true'))
            await vista.get('[data-categoria="favoritos"]').trigger('click')
            await esperar(() => expect(vista.findAll('[data-prueba^="reporte-"]')).toHaveLength(1))
            expect(vista.text()).not.toContain('llega con la API')
        })

        it('el visor: «Programar envío» abre el formulario y programa con los filtros sin fechas', async () => {
            const vista = await mountSuspended(PaginaReporte, { route: '/reportes/cartera-vencida?corte=2026-11-01&zona_id=1' })
            await esperar(() => expect(vista.find('[data-prueba="programar-envio"]').exists()).toBe(true))
            expect(vista.get('[data-prueba="programar-envio"]').attributes('disabled')).toBeUndefined()
            const antes = bd.operacionPm.envios.length
            const resultado = await useEnviosReportes().programar({
                reporte: 'cartera-vencida',
                nombre: 'Cartera vencida · semanal',
                filtros: { zona_id: 1 },
                formato: 'xlsx',
                frecuencia: 'semanal',
                dia: 1,
                hora: 7,
                destinatarios: { usuarios: [1], correos_externos: [] },
            }, 'e-1')
            expect(resultado.ok && resultado.data.activo).toBe(true)
            expect(bd.operacionPm.envios).toHaveLength(antes + 1)
            expect(resultado.ok && frecuenciaEnvio(resultado.data)).toBe('Cada lunes · 7:00')
        })

        it('a un correo externo no va un reporte con datos de un cliente (422 no_compartible)', async () => {
            const externo = bd.operacionPm.correosExternos.find(c => c.activo)
            expect(externo).toBeDefined()
            const resultado = await useEnviosReportes().programar({
                reporte: 'cartera-vencida',
                nombre: 'Por cliente',
                filtros: { cliente_id: 2 },
                formato: 'pdf',
                frecuencia: 'diaria',
                dia: null,
                hora: 19,
                destinatarios: { usuarios: [], correos_externos: [externo!.id] },
            }, 'e-2')
            expect(!resultado.ok && resultado.problema.status).toBe(422)
        })
    })
})
