import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import LibroCierres from '~/components/LibroCierres.vue'
import PaginaBloqueos from '~/pages/libro/bloqueos.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Lista de verificación de cierre y últimas corridas (A3, fase 6 PR B). En los fixtures, julio de
 * ArgosNet está verificado con un turno de caja abierto (anomalía), fondos en tránsito supervisados
 * con nota y la depreciación sin verificar; los demás meses cuadran. La corrida del cron del 15/10
 * dejó tres facturas de septiembre bajo el bloqueo de ventas y dos moras de agosto bajo el global; sus
 * contadores van por empresa (`resultado.por_empresa`, fase 6 PR C).
 */
describe('lista de verificación de cierre', () => {
    beforeEach(async () => {
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    function idDe(clave: string, periodo = '2026-07-01'): number {
        return Math.max(...bd.checksCierre.filter(c => c.empresa_id === 1 && c.periodo === periodo && c.clave === clave).map(c => c.id))
    }

    function escribir(selector: string, texto: string) {
        const campo = document.body.querySelector<HTMLTextAreaElement>(selector)
        expect(campo, selector).not.toBeNull()
        if (campo) {
            campo.value = texto
            campo.dispatchEvent(new Event('input'))
        }
    }

    function botonDelDialogo(texto: string): HTMLButtonElement | undefined {
        return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.trim() === texto)
    }

    it('utilidades: qué pasa, qué se supervisa, errores legibles, checks pendientes y corridas', () => {
        expect([checkPasa({ estado: 'revisado' }), checkPasa({ estado: 'supervisado' }), checkPasa({ estado: 'anomalia' })]).toEqual([true, true, false])
        expect(puedeSupervisarse({ estado: 'anomalia', resultado: 'anomalia', aviso: false })).toBe(true)
        expect(puedeSupervisarse({ estado: 'anomalia', resultado: 'anomalia', aviso: true })).toBe(false)
        expect(puedeSupervisarse({ estado: 'supervisado', resultado: 'anomalia', aviso: false })).toBe(false)
        expect(puedeRetirarse({ estado: 'supervisado' })).toBe(true)
        expect(detalleCheck({ turnos: [7, 9], ruptura: null, depositos: 2 })).toBe('turnos: 7, 9 · depositos: 2')
        expect(detalleCheck(null)).toBeNull()
        expect(porResolver({ checks: [{ estado: 'anomalia' }, { estado: 'supervisado' }] as CheckCierre[], sin_verificar: [{ clave: 'x', titulo: 'X' }] })).toBe(2)

        const pendientes = { type: 'urn:argosisp:problema:checks_pendientes', title: 'Checks de cierre pendientes', status: 422, detail: 'Hay 1…', errors: [{ field: 'turnos_cerrados', message: 'Ningún turno de caja abierto del periodo: esperado 0, obtenido 1', rule: 'checks_pendientes' }] }
        expect(checksPendientesDe(pendientes)).toEqual([{ clave: 'turnos_cerrados', mensaje: 'Ningún turno de caja abierto del periodo: esperado 0, obtenido 1' }])
        expect(checksPendientesDe({ type: 'about:blank', title: 'Otro', status: 422 })).toEqual([])
        expect(problemaCheckLegible(pendientes).title).toBe('Faltan checks del cierre')
        expect(problemaBloqueoLegible(pendientes).title).toBe('Faltan checks del cierre')
        expect(problemaCheckLegible({ type: 'urn:argosisp:problema:check_desactualizado', title: 'Check desactualizado', status: 409 }).title).toBe('El check se volvió a verificar')
        expect(problemaCheckLegible({ type: 'urn:argosisp:problema:check_en_orden', title: 'Check en orden', status: 422 }).title).toBe('El check está en orden')

        expect(resumenCorrida({ proceso: 'facturas.generar', resultado: { generadas: 4, omitidas: 9, errores: 1 } })).toBe('4 generadas · 9 ya tenían factura · 1 con error')
        expect(resumenCorrida({ proceso: 'facturas.vencer_pendientes', resultado: { vencidas: 6, moras: 2, errores: 0 } })).toBe('6 vencidas · 2 moras')
        expect(resumenCorrida({ proceso: 'facturas.generar', resultado: { generadas: 2, omitidas: 0, bonificadas: 1, errores: 0 } })).toBe('2 generadas · 0 ya tenían factura · 1 bonificadas')
        expect(resumenCorrida({ proceso: 'facturas.generar', resultado: null })).toBeNull()
        expect(origenCorrida({ actor_tipo: 'sistema', canal: 'cron' })).toBe('Automática')
        expect(origenCorrida({ actor_tipo: 'usuario', canal: 'panel' })).toBe('A mano desde el panel')
    })

    it('API de los fixtures: listar, verificar solo lo que cambió y supervisar con sus errores', async () => {
        const checks = useChecksCierre()
        const julio = await checks.listar('mensual', '2026-07')
        expect(julio.ok).toBe(true)
        if (!julio.ok) {
            return
        }
        expect(julio.data.pasan).toBe(false)
        expect(julio.data.sin_verificar.map(s => s.clave)).toEqual(['depreciacion_al_dia'])
        expect(julio.data.checks.find(c => c.clave === 'turnos_cerrados')?.estado).toBe('anomalia')
        expect(julio.data.checks.find(c => c.clave === 'fondos_transito')?.estado).toBe('supervisado')

        const filasAntes = bd.checksCierre.length
        const verificado = await checks.verificar('mensual', '2026-07', nuevaClaveIdempotencia())
        // Solo la depreciación es nueva: lo demás no cambió y la supervisión de fondos sigue vigente.
        expect(bd.checksCierre.length).toBe(filasAntes + 1)
        expect(verificado.ok && verificado.data.anomalias).toEqual(['turnos_cerrados'])

        const enOrden = await checks.revisar(idDe('cxc_antiguedad'), 'supervisado', 'Nada que ver', nuevaClaveIdempotencia())
        expect(!enOrden.ok && codigoProblema(enOrden.problema)).toBe('check_en_orden')
        const viejo = Math.min(...bd.checksCierre.filter(c => c.clave === 'fondos_transito').map(c => c.id))
        const desactualizado = await checks.revisar(viejo, 'supervisado', 'Otra vez', nuevaClaveIdempotencia())
        expect(!desactualizado.ok && codigoProblema(desactualizado.problema)).toBe('check_desactualizado')
        const sinNota = await checks.revisar(idDe('turnos_cerrados'), 'supervisado', '', nuevaClaveIdempotencia())
        expect(!sinNota.ok && sinNota.problema.status).toBe(422)

        const supervisado = await checks.revisar(idDe('turnos_cerrados'), 'supervisado', 'El turno de Carlos se cerró el 01/08', nuevaClaveIdempotencia())
        expect(supervisado.ok && [supervisado.data.estado, supervisado.data.automatico, supervisado.data.revisado_por_nombre]).toEqual(['supervisado', false, 'Ana Administradora'])
        const otraVez = await checks.revisar(idDe('turnos_cerrados'), 'supervisado', 'Igual', nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('check_sin_cambio')
        const pasa = await checks.listar('mensual', '2026-07')
        expect(pasa.ok && pasa.data.pasan).toBe(true)

        // Si el cálculo cambia, la verificación agrega fila nueva y la supervisión deja de valer.
        const turnos = bd.calculosChecks.find(c => c.periodo === '2026-07-01' && c.clave === 'turnos_cerrados')
        if (turnos) {
            turnos.obtenido = '2'
        }
        const otraVerificacion = await checks.verificar('mensual', '2026-07', nuevaClaveIdempotencia())
        expect(otraVerificacion.ok && otraVerificacion.data.anomalias).toEqual(['turnos_cerrados'])
    })

    it('cerrar el mes y el bloqueo duro exigen los checks: 422 checks_pendientes sin guardar nada', async () => {
        const filasAntes = bd.checksCierre.length
        const julio = await useLibro().cerrarPeriodo('2026-07', nuevaClaveIdempotencia())
        expect(!julio.ok && codigoProblema(julio.problema)).toBe('checks_pendientes')
        expect(!julio.ok && julio.problema.errors?.map(e => e.field)).toEqual(['turnos_cerrados'])
        expect(bd.checksCierre.length).toBe(filasAntes)

        bd.cierres.push({ ...structuredClone(bd.cierres[0]!), id: 900, periodo: '2026-07', estado: 'cerrado' })
        const duro = await useBloqueosLibro().bloquearDuro({ hasta: '2026-07-31', motivo: 'Auditoría de julio', confirmacion: 'BLOQUEO DURO hasta 2026-07-31' }, nuevaClaveIdempotencia())
        expect(!duro.ok && [codigoProblema(duro.problema), duro.problema.errors?.map(e => e.field)]).toEqual(['checks_pendientes', ['turnos_cerrados']])

        await useChecksCierre().revisar(idDe('turnos_cerrados'), 'supervisado', 'Turno cerrado el 01/08', nuevaClaveIdempotencia())
        const duroOk = await useBloqueosLibro().bloquearDuro({ hasta: '2026-07-31', motivo: 'Auditoría de julio', confirmacion: 'BLOQUEO DURO hasta 2026-07-31' }, nuevaClaveIdempotencia())
        expect(duroOk.ok && duroOk.data.hasta).toBe('2026-07-31')
        // Agosto cuadra: cerrarlo deja verificada su lista.
        const agosto = await useLibro().cerrarPeriodo('2026-08', nuevaClaveIdempotencia())
        expect(agosto.ok).toBe(true)
        const lista = await useChecksCierre().listar('mensual', '2026-08')
        expect(lista.ok && [lista.data.pasan, lista.data.checks.length]).toEqual([true, 15])
    })

    it('corridas: la del cron por empresa; correr a mano la reemplaza y, sin bloqueo, no queda nada', async () => {
        const antes = await useFacturas().corridas()
        expect(antes.ok).toBe(true)
        if (!antes.ok) {
            return
        }
        const argos = antes.data.find(e => e.empresa_id === 1)
        const facturar = argos?.procesos.find(p => p.proceso === 'facturas.generar')
        expect([facturar?.actor_tipo, facturar?.canal, facturar?.bloqueados, facturar?.bloqueos[0]?.tipo]).toEqual(['sistema', 'cron', 3, 'ventas'])
        expect(argos?.procesos.find(p => p.proceso === 'facturas.vencer_pendientes')?.bloqueados).toBe(2)
        // Los contadores son solo de la empresa: la misma corrida facturó 3 en ArgosNet y 1 en Fibra del Sur.
        expect(facturar?.resultado?.generadas).toBe(3)
        const sur = antes.data.find(e => e.empresa_id === 2)
        expect(sur?.procesos.map(p => p.bloqueados)).toEqual([0, 0])
        expect(sur?.procesos.map(p => resumenCorrida(p))).toEqual(['1 generadas · 3 ya tenían factura', '2 vencidas · 0 moras'])

        await useBloqueosLibro().desbloquear({ tipo: 'ventas', hasta: null, motivo: 'Abrir ventas de septiembre' }, nuevaClaveIdempotencia())
        const corrida = await useFacturas().generar(nuevaClaveIdempotencia())
        expect(corrida.ok && corrida.data.bloqueados).toBe(0)
        const despues = await useFacturas().corridas()
        const nueva = despues.ok ? despues.data.find(e => e.empresa_id === 1)?.procesos.find(p => p.proceso === 'facturas.generar') : undefined
        expect([nueva?.actor_tipo, nueva?.bloqueados, nueva?.resultado?.generadas]).toEqual(['usuario', 0, 3])
    })

    it('procesos detenidos: se lee la última corrida sin correr nada; «Correr ahora» corre y vuelve a leer', async () => {
        const vista = await mountSuspended(PaginaBloqueos, { route: '/libro/bloqueos' })
        await esperar(() => expect(vista.find('[data-empresa="1"] [data-proceso="facturar"] [data-prueba="proceso-bloqueados"]').text()).toBe('3 documentos siguen pendientes por un bloqueo'))
        expect(vista.find('[data-empresa="1"] [data-proceso="facturar"] [data-prueba="proceso-ultima"]').text()).toContain('Automática')
        expect(vista.find('[data-empresa="1"] [data-proceso="vencer"] [data-prueba="proceso-bloqueados"]').text()).toBe('2 documentos siguen pendientes por un bloqueo')
        // Leer no corrió nada: la bitácora no tiene una corrida a mano.
        expect(bd.acciones.filter(a => a.accion === 'facturas.generar' && a.actor_tipo === 'usuario')).toHaveLength(0)

        await vista.get('[data-empresa="1"] [data-prueba="correr-facturar"]').trigger('click')
        await esperar(() => expect(botonDelDialogo('Correr ahora')).toBeDefined())
        botonDelDialogo('Correr ahora')?.click()
        await esperar(() => expect(vista.find('[data-empresa="1"] [data-proceso="facturar"] [data-prueba="proceso-ultima"]').text()).toContain('A mano'))
        expect(vista.find('[data-empresa="1"] [data-proceso="facturar"] [data-prueba="proceso-bloqueados"]').text()).toBe('3 documentos siguen pendientes por un bloqueo')
        vista.unmount()
    })

    it('corrida vieja sin conteos por empresa: de varias empresas es null; de una sola, sus conteos', async () => {
        const vieja = (id: number, empresas: number[] | null) => ({
            ...structuredClone(bd.acciones.find(a => a.accion === 'facturas.vencer_pendientes')!),
            id,
            created_at: '2026-10-16T06:10:00.000Z',
            entrada: { parametros: { hasta: '2026-10-16', servicio_id: null, empresas }, resultado: { vencidas: 9, moras: 3, errores: 0, bloqueados: 2 }, bloqueos: [{ empresa_id: 1, tipo: 'global', hasta: '2026-08-31', fecha: '2026-08-25', documentos: 2, ejemplos: [3, 5] }] },
        })
        bd.acciones.push(vieja(99001, null))
        const varias = await useFacturas().corridas()
        const vencerDe = (empresaId: number) => (varias.ok ? varias.data.find(e => e.empresa_id === empresaId)?.procesos.find(p => p.proceso === 'facturas.vencer_pendientes') : undefined)
        expect([vencerDe(1)?.resultado, vencerDe(1)?.bloqueados]).toEqual([null, 2])
        expect([vencerDe(2)?.resultado, vencerDe(2)?.bloqueados]).toEqual([null, 0])

        const vista = await mountSuspended(PaginaBloqueos, { route: '/libro/bloqueos' })
        await esperar(() => expect(vista.find('[data-empresa="2"] [data-proceso="vencer"] [data-prueba="proceso-sin-detalle"]').exists()).toBe(true))
        // Sin conteos de la empresa no se muestra ni «0 vencidas» ni «Nada quedó detenido».
        expect(vista.find('[data-empresa="2"] [data-proceso="vencer"] [data-prueba="proceso-resumen"]').exists()).toBe(false)
        expect(vista.find('[data-empresa="2"] [data-proceso="vencer"] [data-prueba="proceso-bloqueados"]').exists()).toBe(false)
        // Lo detenido sí es de la empresa (cada bloqueo lleva la suya).
        expect(vista.find('[data-empresa="1"] [data-proceso="vencer"] [data-prueba="proceso-bloqueados"]').text()).toBe('2 documentos siguen pendientes por un bloqueo')
        vista.unmount()

        bd.acciones.push({ ...vieja(99002, [1]), created_at: '2026-10-16T07:00:00.000Z' })
        const una = await useFacturas().corridas()
        const argos = una.ok ? una.data.find(e => e.empresa_id === 1)?.procesos.find(p => p.proceso === 'facturas.vencer_pendientes') : undefined
        expect([argos?.resultado?.vencidas, argos?.resultado?.moras, argos?.bloqueados]).toEqual([9, 3, 2])
    })

    it('si las corridas fallan: error con Reintentar y ningún «nada detenido»', async () => {
        simularFalla('GET /api/v1/facturas/corridas', 500)
        const vista = await mountSuspended(PaginaBloqueos, { route: '/libro/bloqueos' })
        await esperar(() => expect(vista.find('[data-prueba="corridas-error"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="corridas-error"]').text()).toContain('Reintentar')
        expect(vista.find('[data-prueba="proceso-bloqueados"]').exists()).toBe(false)
        vista.unmount()
    })

    it('pantalla: julio con lo que falta; verificar; supervisar con nota y el mes pasa', async () => {
        const vista = await mountSuspended(LibroCierres, { route: '/libro?tab=cierres&mes=2026-07' })
        await esperar(() => expect(vista.find('[data-prueba="checklist-resumen"]').text()).toBe('2 por resolver'))
        expect(vista.find('[data-clave="turnos_cerrados"]').text()).toContain('Ningún turno de caja abierto')
        expect(vista.find('[data-prueba="checklist-sin-verificar"]').text()).toContain('Cuotas de activos y diferidos')
        const estados = vista.findAll('[data-prueba="check-estado"]').map(b => b.text())
        expect(estados.filter(e => e === 'Anomalía')).toHaveLength(1)
        expect(estados.filter(e => e === 'Supervisado')).toHaveLength(1)
        expect(vista.find('[data-prueba="check-nota"]').text()).toContain('Supervisó Ana Administradora')

        await vista.get('[data-prueba="checklist-verificar"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="checklist-resumen"]').text()).toBe('1 por resolver'))
        expect(vista.find('[data-prueba="checklist-sin-verificar"]').exists()).toBe(false)

        await vista.get('[data-prueba="supervisar-turnos_cerrados"]').trigger('click')
        await esperar(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Supervisar la anomalía'))
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('esperado 0, obtenido 1')
        escribir('[role="dialog"] textarea', 'El turno de Carlos se cerró el 01/08 con arqueo')
        botonDelDialogo('Supervisar')?.click()
        await esperar(() => expect(vista.find('[data-prueba="checklist-resumen"]').text()).toBe('El mes pasa la lista'))
        expect(vista.find('[data-prueba="retirar-turnos_cerrados"]').exists()).toBe(true)
        vista.unmount()
    })

    it('pantalla: cerrar un mes con checks pendientes los muestra y lleva a su lista', async () => {
        bd.calculosChecks.push({ empresa_id: 1, tipo: 'mensual', periodo: '2026-08-01', clave: 'dte_pendientes', esperado: '0', obtenido: '2', resultado: 'anomalia', detalle: { dte: [41, 42] } })
        const vista = await mountSuspended(LibroCierres, { route: '/libro?tab=cierres' })
        // Por defecto, la lista del primer mes que falta cerrar (agosto, reabierto).
        await esperar(() => expect(vista.find('[data-prueba="checklist-resumen"]').text()).toBe('15 por resolver'))
        await vista.get('[data-prueba="abrir-cerrar-periodo"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="confirmar-cierre"]')).not.toBeNull())
        document.querySelector<HTMLButtonElement>('[data-prueba="confirmar-cierre"]')?.click()
        await esperar(() => expect(document.querySelector('[data-prueba="cierre-checks"]')?.textContent).toContain('Ningún DTE pendiente, enviando o en contingencia del periodo: esperado 0, obtenido 2'))
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Faltan checks del cierre')
        document.querySelector<HTMLButtonElement>('[data-prueba="cierre-a-checklist"]')?.click()
        await esperar(() => expect(document.querySelector('[data-prueba="cierre-checks"]')).toBeNull())

        // El cierre no guardó la verificación: se verifica desde la lista y se ve la anomalía.
        await vista.get('[data-prueba="checklist-verificar"]').trigger('click')
        await esperar(() => expect(vista.find('[data-clave="dte_pendientes"]').text()).toContain('dte: 41, 42'))
        expect(vista.find('[data-prueba="checklist-resumen"]').text()).toBe('1 por resolver')
        vista.unmount()
    })

    it('si la lista falla: error con Reintentar y ningún «en orden»', async () => {
        simularFalla('GET /api/v1/libro/cierres/:tipo/:periodo/checks', 500)
        const vista = await mountSuspended(LibroCierres, { route: '/libro?tab=cierres&mes=2026-07' })
        await esperar(() => expect(vista.find('[data-prueba="checklist-error"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="checklist-error"]').text()).toContain('Reintentar')
        expect(vista.find('[data-prueba="checklist-resumen"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="check-estado"]').exists()).toBe(false)
        vista.unmount()
    })

    it('permisos: «Verificar» pide cierres.verificar; supervisar y retirar, cierres.revisar_check', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'cierres.verificar') }
        const sinVerificar = await mountSuspended(LibroCierres, { route: '/libro?tab=cierres&mes=2026-07' })
        await esperar(() => expect(sinVerificar.find('[data-prueba="checklist-resumen"]').text()).toBe('2 por resolver'))
        expect(sinVerificar.find('[data-prueba="checklist-verificar"]').exists()).toBe(false)
        expect(sinVerificar.find('[data-prueba="supervisar-turnos_cerrados"]').exists()).toBe(true)
        sinVerificar.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'cierres.revisar_check') }
        const sinRevisar = await mountSuspended(LibroCierres, { route: '/libro?tab=cierres&mes=2026-07' })
        await esperar(() => expect(sinRevisar.find('[data-prueba="checklist-resumen"]').text()).toBe('2 por resolver'))
        expect(sinRevisar.find('[data-prueba="checklist-verificar"]').exists()).toBe(true)
        expect(sinRevisar.find('[data-prueba="supervisar-turnos_cerrados"]').exists()).toBe(false)
        expect(sinRevisar.find('[data-prueba="retirar-fondos_transito"]').exists()).toBe(false)
        sinRevisar.unmount()

        // La API pide lo mismo: el cajero no tiene cierres.revisar_check (403).
        sesionFixture('fixture-cajero')
        const cajero = await useChecksCierre().revisar(idDe('turnos_cerrados'), 'supervisado', 'Sin permiso', nuevaClaveIdempotencia())
        expect(!cajero.ok && cajero.problema.status).toBe(403)
    })
})
