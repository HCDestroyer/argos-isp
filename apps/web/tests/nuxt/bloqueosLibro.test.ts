import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import PaginaBloqueos from '~/pages/libro/bloqueos.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Bloqueos del libro (A3, fase 6 PR A): vigentes por tipo, bloquear (solo avanza), desbloquear con
 * motivo, bloqueo duro con confirmación de texto exacto y sus requisitos, excepciones con fin y
 * revocación (solo admin) y los procesos que una corrida deja pendientes por un bloqueo. La pantalla
 * encadena varias peticiones: se espera con `esperar` (plazo común de `tests/ayudas/esperar.ts`).
 */

describe('bloqueos del libro', () => {
    beforeEach(() => {
        // La excepción sembrada de ventas está vigente hasta el 26/10/2026: la fecha es la de los fixtures.
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const vigentes = { global: '2026-08-31', ventas: '2026-09-30', compras: null, impuestos: '2026-08-31', duro: '2026-06-30' }

    it('esquemas espejo del validador: solo avanza, no futuro, no antes del duro; confirmación exacta; excepción con fin', () => {
        const bloquear = esquemaBloquear(vigentes, '2026-10-19')
        expect(bloquear.safeParse({ tipo: 'global', hasta: '2026-09-30', motivo: 'Cierre de septiembre' }).success).toBe(true)
        expect(bloquear.safeParse({ tipo: 'global', hasta: '2026-08-15', motivo: 'Atrás' }).error?.issues[0]?.message).toContain('Solo avanza')
        expect(bloquear.safeParse({ tipo: 'compras', hasta: '2026-10-20', motivo: 'Futuro' }).error?.issues[0]?.message).toContain('futuro')
        expect(bloquear.safeParse({ tipo: 'compras', hasta: '2026-05-31', motivo: 'Bajo el duro' }).error?.issues[0]?.message).toContain('duro')
        const desbloquear = esquemaDesbloquear(vigentes)
        expect(desbloquear.safeParse({ tipo: 'ventas', sin_bloqueo: false, hasta: '2026-09-30', motivo: 'Igual' }).error?.issues[0]?.message).toContain('anterior')
        expect(desbloquear.safeParse({ tipo: 'ventas', sin_bloqueo: true, hasta: '', motivo: 'Quitar' }).success).toBe(true)
        expect(confirmacionDuro('2026-09-30')).toBe('BLOQUEO DURO hasta 2026-09-30')
        const duro = esquemaDuro(vigentes, '2026-10-19')
        expect(duro.safeParse({ hasta: '2026-09-30', motivo: 'Auditoría', confirmacion: 'BLOQUEO DURO hasta 2026-09-30' }).success).toBe(true)
        expect(duro.safeParse({ hasta: '2026-09-30', motivo: 'Auditoría', confirmacion: 'bloqueo duro hasta 2026-09-30' }).error?.issues[0]?.path).toEqual(['confirmacion'])
        expect(esquemaExcepcion(Date.parse('2026-10-19T12:00:00Z')).safeParse({ tipo: 'ventas', usuario_id: null, motivo: 'Nota de crédito', hasta_en: '2026-10-01T10:00' }).error?.issues[0]?.path).toEqual(['hasta_en'])
        expect(bloqueoEfectivo(vigentes, 'compras')).toBe('2026-08-31')
        expect(bloqueoEfectivo(vigentes, 'ventas')).toBe('2026-09-30')
    })

    it('errores con título legible: periodo_bloqueado con su tipo y los requisitos del duro uno por uno', () => {
        expect(problemaBloqueoLegible({ type: 'urn:argosisp:problema:periodo_bloqueado', title: 'Regla', status: 422, errors: [{ field: 'fecha', message: 'x', rule: 'ventas' }] }).title).toBe('Periodo bloqueado (ventas)')
        expect(problemaBloqueoLegible({ type: 'urn:argosisp:problema:bloqueo_duro', title: 'Bloqueo duro', status: 409 }).title).toBe('Bajo el bloqueo duro no entra nada')
        const requisitos = problemaBloqueoLegible({ type: 'urn:argosisp:problema:bloqueo_duro_requisitos', title: 'Regla', status: 422, errors: [{ field: 'hasta', message: 'Meses sin cerrar: 2026-07', rule: 'meses_abiertos' }, { field: 'hasta', message: '2 DTE', rule: 'dte_pendientes' }] })
        expect([requisitos.title, requisitos.detail]).toEqual(['Faltan requisitos para el bloqueo duro', 'Meses sin cerrar: 2026-07 · DTE sin certificar: 2 DTE'])
    })

    it('API de los fixtures: bloquear avanza; atrás es 422 bloqueo_regresivo; desbloquear; impuestos no retrocede; duro con requisitos', async () => {
        const b = useBloqueosLibro()
        const regresivo = await b.bloquear({ tipo: 'global', hasta: '2026-08-01', motivo: 'Atrás' }, nuevaClaveIdempotencia())
        expect(!regresivo.ok && codigoProblema(regresivo.problema)).toBe('bloqueo_regresivo')
        const avanza = await b.bloquear({ tipo: 'global', hasta: '2026-09-15', motivo: 'Cierre de quincena' }, nuevaClaveIdempotencia())
        expect(avanza.ok && [avanza.data.hasta, avanza.data.anterior]).toEqual(['2026-09-15', '2026-08-31'])
        const impuestos = await b.desbloquear({ tipo: 'impuestos' as 'global', hasta: null, motivo: 'Quitar' }, nuevaClaveIdempotencia())
        expect(!impuestos.ok && codigoProblema(impuestos.problema)).toBe('bloqueo_regresivo')
        const sinVentas = await b.desbloquear({ tipo: 'ventas', hasta: null, motivo: 'Abrir ventas' }, nuevaClaveIdempotencia())
        expect(sinVentas.ok && sinVentas.data.hasta).toBeNull()
        const sinCompras = await b.desbloquear({ tipo: 'compras', hasta: null, motivo: 'Nada' }, nuevaClaveIdempotencia())
        expect(!sinCompras.ok && codigoProblema(sinCompras.problema)).toBe('sin_bloqueo')

        const malConfirmado = await b.bloquearDuro({ hasta: '2026-08-31', motivo: 'Auditoría', confirmacion: 'BLOQUEO DURO' }, nuevaClaveIdempotencia())
        expect(!malConfirmado.ok && codigoProblema(malConfirmado.problema)).toBe('confirmacion_invalida')
        const requisitos = await b.bloquearDuro({ hasta: '2026-08-31', motivo: 'Auditoría', confirmacion: 'BLOQUEO DURO hasta 2026-08-31' }, nuevaClaveIdempotencia())
        expect(!requisitos.ok && [codigoProblema(requisitos.problema), requisitos.problema.errors?.map(e => e.rule)]).toEqual(['bloqueo_duro_requisitos', ['meses_abiertos']])
        bd.cierres.push(...['2026-07', '2026-08'].map((periodo, i) => ({ ...structuredClone(bd.cierres[0]!), id: 900 + i, periodo, estado: 'cerrado' as const })))
        const duro = await b.bloquearDuro({ hasta: '2026-08-31', motivo: 'Auditoría', confirmacion: 'BLOQUEO DURO hasta 2026-08-31' }, nuevaClaveIdempotencia())
        expect(duro.ok && [duro.data.tipo, duro.data.hasta]).toEqual(['duro', '2026-08-31'])
        const bajoDuro = await b.bloquear({ tipo: 'compras', hasta: '2026-08-15', motivo: 'Compras' }, nuevaClaveIdempotencia())
        expect(!bajoDuro.ok && codigoProblema(bajoDuro.problema)).toBe('bloqueo_bajo_duro')
        const reabrir = await useLibro().reabrirPeriodo('2026-08', 'Corregir', nuevaClaveIdempotencia())
        expect(!reabrir.ok && codigoProblema(reabrir.problema)).toBe('bloqueo_duro')
    })

    it('excepciones: sin fin o para el duro es 422; se crea vigente y se revoca una vez', async () => {
        const b = useBloqueosLibro()
        const sinFin = await b.crearExcepcion({ tipo: 'ventas', motivo: 'Sin fin' }, nuevaClaveIdempotencia())
        expect(!sinFin.ok && codigoProblema(sinFin.problema)).toBe('excepcion_sin_fin')
        const duro = await b.crearExcepcion({ tipo: 'duro', motivo: 'Duro', hasta_en: '2027-01-01T00:00:00.000Z' }, nuevaClaveIdempotencia())
        expect(!duro.ok && codigoProblema(duro.problema)).toBe('excepcion_sin_fin')
        const nueva = await b.crearExcepcion({ tipo: 'global', usuario_id: 1, motivo: 'Reclasificar septiembre', hasta_en: '2027-01-01T00:00:00.000Z' }, nuevaClaveIdempotencia())
        if (!nueva.ok) {
            throw new Error(nueva.problema.title)
        }
        expect([nueva.data.estado, nueva.data.usuario_nombre]).toEqual(['vigente', 'Ana Administradora'])
        const revocada = await b.revocarExcepcion(nueva.data.id, 'Ya se reclasificó', nuevaClaveIdempotencia())
        expect(revocada.ok && revocada.data.estado).toBe('revocada')
        const otraVez = await b.revocarExcepcion(nueva.data.id, 'De nuevo', nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('excepcion_revocada')
        const vigentesLista = await b.excepciones({ estado: 'vigente' })
        expect(vigentesLista.ok && vigentesLista.data.data.map(e => e.id)).toEqual([1])
    })

    it('procesos: lo que cae bajo un bloqueo queda pendiente; al desbloquear, la corrida lo procesa', async () => {
        const antes = await useFacturas().generar(nuevaClaveIdempotencia())
        expect(antes.ok && [antes.data.bloqueados, antes.data.bloqueos?.map(b => [b.tipo, b.hasta, b.fecha, b.documentos])]).toEqual([3, [['ventas', '2026-09-30', '2026-09-01', 3]]])
        await useBloqueosLibro().desbloquear({ tipo: 'ventas', hasta: '2026-08-31', motivo: 'Facturar septiembre' }, nuevaClaveIdempotencia())
        const despues = await useFacturas().generar(nuevaClaveIdempotencia())
        expect(despues.ok && [despues.data.generadas, despues.data.bloqueados]).toEqual([3, 0])
        const moras = await useFacturas().vencer(nuevaClaveIdempotencia())
        expect(moras.ok && [moras.data.bloqueados, moras.data.bloqueos.map(b => b.tipo)]).toEqual([2, ['global']])
    })

    it('pantalla: vigentes por tipo, acciones según el permiso, excepciones e historial; correr un proceso muestra lo pendiente', async () => {
        const vista = await mountSuspended(PaginaBloqueos, { route: '/libro/bloqueos' })
        await esperar(() => expect(vista.find('[data-tipo="ventas"] [data-prueba="bloqueo-vigente"]').text()).toBe('Hasta 30/09/2026'))
        expect(vista.find('[data-tipo="compras"] [data-prueba="bloqueo-vigente"]').text()).toBe('Sin bloqueo')
        expect(vista.find('[data-tipo="duro"] [data-prueba="bloqueo-vigente"]').text()).toBe('Hasta 30/06/2026')
        expect(vista.find('[data-tipo="compras"]').text()).toContain('Efectivo hasta 31/08/2026')
        for (const boton of ['abrir-bloquear', 'abrir-desbloquear', 'abrir-duro', 'abrir-excepcion']) {
            expect(vista.find(`[data-prueba="${boton}"]`).exists(), boton).toBe(true)
        }
        await esperar(() => expect(vista.findAll('[data-prueba="tabla-excepciones"] [data-prueba="excepcion-estado"]').map(b => b.text())).toEqual(['Vigente']))
        await esperar(() => expect(vista.find('[data-prueba="tabla-historial-bloqueos"]').text()).toContain('Cierre de agosto'))

        await vista.find('[data-prueba="correr-facturar"]').trigger('click')
        await esperar(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Correr ahora'))
        const confirmar = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent?.trim() === 'Correr ahora')
        confirmar?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await esperar(() => expect(vista.find('[data-proceso="facturar"] [data-prueba="proceso-bloqueados"]').text()).toBe('3 documentos siguen pendientes por un bloqueo'))
        expect(vista.find('[data-proceso="facturar"] [data-prueba="proceso-bloqueo"]').text()).toContain('Ventas hasta 30/09/2026')
        vista.unmount()
    })

    it('sin los permisos de bloqueo solo se lee: ni bloquear, ni duro, ni excepciones, ni correr procesos', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !['libro.bloquear', 'libro.bloquear_duro', 'libro.desbloquear', 'libro.excepcion_bloqueo', 'facturas.generar'].includes(p)) }
        const vista = await mountSuspended(PaginaBloqueos, { route: '/libro/bloqueos' })
        await esperar(() => expect(vista.find('[data-tipo="global"] [data-prueba="bloqueo-vigente"]').text()).toBe('Hasta 31/08/2026'))
        for (const boton of ['abrir-bloquear', 'abrir-desbloquear', 'abrir-duro', 'abrir-excepcion', 'revocar-excepcion']) {
            expect(vista.find(`[data-prueba="${boton}"]`).exists(), boton).toBe(false)
        }
        // La última corrida se lee con `facturas.ver`; correrla pide `facturas.generar`.
        await esperar(() => expect(vista.find('[data-proceso="facturar"] [data-prueba="proceso-bloqueados"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="correr-facturar"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="correr-vencer"]').exists()).toBe(false)
        vista.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'facturas.ver' && p !== 'facturas.generar') }
        const sinFacturas = await mountSuspended(PaginaBloqueos, { route: '/libro/bloqueos' })
        await esperar(() => expect(sinFacturas.find('[data-tipo="global"] [data-prueba="bloqueo-vigente"]').exists()).toBe(true))
        expect(sinFacturas.find('[data-prueba="procesos-bloqueados"]').exists()).toBe(false)
        sinFacturas.unmount()
    })
})
