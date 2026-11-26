import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import type { Schema } from '@argosisp/contracts'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { usuariosPorToken } from '~~/fixtures/comun'
import PaginaIntegraciones from '~/pages/configuracion/integraciones/index.vue'
import PaginaInstancia from '~/pages/configuracion/integraciones/smartolt/[id]/index.vue'
import ServicioEquipoGestion from '~/components/ServicioEquipoGestion.vue'
import { esperar } from '../ayudas/esperar'

/**
 * A6 · SmartOLT con varias instancias y el ACS por separado (tableros PendSmartolt*, PendAcs):
 * lista, detalle, permisos y secretos. Contra los fixtures fieles a la API.
 */
function enApp(componente: Component) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

const montadas: { unmount: () => void }[] = []
async function montar(componente: Component, route: string) {
    const vista = await mountSuspended(enApp(componente), { route, attachTo: document.body })
    montadas.push(vista)
    return vista
}
const enBody = (prueba: string) => document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
const botones = () => [...document.body.querySelectorAll<HTMLButtonElement>('button, a')]

/** Una instancia con los valores por defecto de la API (`InstanciaSmartOlt`). */
function instancia(datos: Partial<Schema<'InstanciaSmartOlt'>> & { id: number, nombre: string }): Schema<'InstanciaSmartOlt'> {
    return {
        empresa_id: 1, compartida: false, nota: null, url: `https://i${datos.id}.smartolt.com`, token: '***', activo: true, operativa: false,
        probado_en: null, prueba_ok: null, prueba_error: null, prueba_latencia_ms: null, probado_por: null, olts_sincronizadas_en: null, version: 1, olts: [],
        ...datos,
    }
}

function sembrar() {
    bd.operacionPm.smartolt = [
        instancia({ id: 1, nombre: 'Zona norte', operativa: true, prueba_ok: true, probado_en: '2026-11-25T14:40:00.000Z', prueba_latencia_ms: 212, probado_por: 'Ana Cruz', olts_sincronizadas_en: '2026-11-25T14:40:00.000Z',
            olts: [{ id: 11, smartolt_olt_id: '1', nombre: 'OLT-CENTRO-01', hardware: 'Huawei MA5800-X7', ip: '10.20.0.11', presente: true, origen: 'sincronizada', olt: { id: 1, nombre: 'OLT Centro' }, perfiles: [{ plan_id: null, authorization_preset_id: 31, pon_type: 'gpon' }] }] }),
        instancia({ id: 2, nombre: 'Costa sur', prueba_ok: false, prueba_error: 'SmartOLT: Invalid API Key (403)', probado_en: '2026-11-24T23:05:00.000Z' }),
        instancia({ id: 3, nombre: 'Principal', empresa_id: null, compartida: true, operativa: true, prueba_ok: true }),
    ]
    bd.operacionPm.tokensSmartolt = { 1: 'token-zona-norte-secreto', 2: 'token-costa-sur-secreto', 3: 'token-principal-secreto' }
    bd.operacionPm.secretosAcs = { 1: { clave: 'clave-acs-secreta', ca: null } }
}

beforeEach(async () => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().inicializar()
    useEmpresaActiva().elegir(1)
    sembrar()
    await flushPromises()
})

afterEach(() => {
    usuariosPorToken['fixture-admin'] = meAdmin
    sesionFixture(null)
    useUsuarioActual().value = null
    localStorage.clear()
    for (const vista of montadas.splice(0)) {
        vista.unmount()
    }
})

describe('A6 · SmartOLT y ACS en la bitácora', () => {
    it('nombra las acciones nuevas y los pasos del aprovisionamiento y del Wi-Fi', () => {
        expect(etiquetaAccion('smartolt.crear_instancia')).toBe('Instancia de SmartOLT registrada')
        expect(etiquetaAccion('smartolt.probar_instancia')).toBe('Prueba de conexión con SmartOLT (y sus OLT sincronizadas)')
        expect(etiquetaAccion('smartolt.vincular_olt')).toBe('OLT de SmartOLT ligada a una OLT de Argos')
        expect(etiquetaAccion('acs.configurar')).toBe('Configuración del ACS (GenieACS) guardada')
        expect(etiquetaAccion('acs.probar')).toBe('Prueba de conexión con el ACS (GenieACS)')
        expect(etiquetaAccion('equipos.preparar_aprovisionamiento')).toBe('Equipo configurado en SmartOLT o el ACS (aprovisionamiento)')
        expect(etiquetaAccion('equipos.aplicar_wifi')).toBe('Wi-Fi del equipo cambiado por el ACS')
    })
})

describe('A6 · Integraciones › SmartOLT y ACS', () => {
    it('dos instancias con estados distintos, la compartida marcada y el resumen «2 de 3 operativas»', async () => {
        await montar(PaginaIntegraciones, '/configuracion/integraciones?ver=smartolt')
        await esperar(() => expect(enBody('estado-instancia-2')?.textContent).toContain('Falla'))
        expect(enBody('estado-instancia-1')?.textContent).toContain('Probada')
        expect(document.body.querySelector('[data-instancia="3"]')?.textContent).toContain('Compartida')
        expect(enBody('estado-lista-smartolt')?.textContent).toContain('2 de 3 operativas')
        expect(document.body.innerHTML).not.toContain('token-zona-norte-secreto')
    })

    it('un 500 de la lista muestra el error con «Reintentar» y ningún conteo', async () => {
        simularFalla('GET /api/v1/integraciones/smartolt/instancias', 500)
        await montar(PaginaIntegraciones, '/configuracion/integraciones?ver=smartolt')
        await esperar(() => expect(enBody('smartolt-error')).not.toBeNull())
        expect(enBody('smartolt-reintentar')).not.toBeNull()
        expect(document.body.querySelector('[data-instancia]')).toBeNull()
        expect(enBody('estado-lista-smartolt')?.textContent).toContain('No se pudo leer')
        expect(enBody('estado-lista-smartolt')?.textContent).not.toMatch(/\d+ de \d+/)
    })

    it('«Todas las empresas» pide elegir una', async () => {
        useEmpresaActiva().elegir('todas')
        await montar(PaginaIntegraciones, '/configuracion/integraciones?ver=smartolt')
        await esperar(() => expect(enBody('smartolt-elige-empresa')).not.toBeNull())
    })

    it('con solo `acs.ver` no aparece la fila de SmartOLT y la clave del ACS nunca está en el DOM', async () => {
        const soloAcs = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !p.startsWith('smartolt.')) }
        usuariosPorToken['fixture-admin'] = soloAcs
        useUsuarioActual().value = soloAcs
        bd.operacionPm.acs[1] = { empresa_id: 1, activo: true, operativo: true, url: 'https://acs.miisp.gt:7557', usuario: 'argos', clave: '***', ca: false, probado_en: '2026-11-25T14:41:00.000Z', prueba_ok: true, prueba_error: null, prueba_latencia_ms: 180, probado_por: 'Ana Cruz', pppoe_por_acs: true, version: 2 }
        await montar(PaginaIntegraciones, '/configuracion/integraciones?ver=acs')
        await esperar(() => expect(enBody('estado-acs')?.textContent).toContain('Probado'))
        expect(document.body.querySelector('[data-integracion="smartolt"]')).toBeNull()
        expect(document.body.querySelector('[data-integracion="acs"]')).not.toBeNull()
        expect(document.body.innerHTML).not.toContain('clave-acs-secreta')
    })

    it('detalle: sin `smartolt.editar_instancia` no hay «Editar» ni «Eliminar»; el token nunca se ve', async () => {
        const lector = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !['smartolt.editar_instancia', 'smartolt.eliminar_instancia'].includes(p)) }
        usuariosPorToken['fixture-admin'] = lector
        useUsuarioActual().value = lector
        await montar(PaginaInstancia, '/configuracion/integraciones/smartolt/1')
        await esperar(() => expect(enBody('instancia-detalle')).not.toBeNull())
        expect(enBody('instancia-eliminar')).toBeNull()
        expect(botones().some(b => b.textContent?.trim() === 'Editar')).toBe(false)
        expect(document.body.textContent).toContain('OLT-CENTRO-01')
        expect(document.body.textContent).toContain('212 ms')
        expect(document.body.innerHTML).not.toContain('token-zona-norte-secreto')
    })

    it('una compartida sin alcance global se ve en solo lectura', async () => {
        const deUna = { ...meAdmin, alcance_global: false }
        usuariosPorToken['fixture-admin'] = deUna
        useUsuarioActual().value = deUna
        await montar(PaginaInstancia, '/configuracion/integraciones/smartolt/3')
        await esperar(() => expect(enBody('instancia-solo-lectura')).not.toBeNull())
        expect(enBody('instancia-probar')).toBeNull()
        expect(enBody('instancia-eliminar')).toBeNull()
    })
})

describe('A6 · ficha del servicio › Equipo', () => {
    function montarEquipo(servicioId: number) {
        return montar(defineComponent({ render: () => h(ServicioEquipoGestion, { servicioId }) }), `/servicios/${servicioId}?pestana=equipo`)
    }

    it('sin OLT ligada y dos cuentas operativas: se busca la serie en las dos; sin ACS, su aviso', async () => {
        bd.operacionPm.smartolt = bd.operacionPm.smartolt.map(i => ({ ...i, olts: [] }))
        const servicio = bd.servicios[0]!
        await montarEquipo(servicio.id)
        await esperar(() => expect(enBody('equipo-olt-sin-ligar')).not.toBeNull())
        expect(enBody('equipo-olt-sin-ligar')?.textContent).toContain('2 cuentas')
        expect(enBody('equipo-sin-acs')?.textContent).toContain('Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU')
        expect(enBody('equipo-aprovisionar')?.textContent).toContain('No disponible sin ACS')
    })

    it('con una sola cuenta y el ACS: la cuenta, el estado en vivo y el Wi-Fi por el ACS', async () => {
        bd.operacionPm.smartolt = bd.operacionPm.smartolt.filter(i => i.id === 1)
        bd.operacionPm.acs[bd.servicios[0]!.empresa_id] = { empresa_id: bd.servicios[0]!.empresa_id, activo: true, operativo: true, url: 'https://acs.miisp.gt:7557', usuario: 'argos', clave: '***', ca: false, probado_en: null, prueba_ok: true, prueba_error: null, prueba_latencia_ms: 180, probado_por: null, pppoe_por_acs: true, version: 1 }
        await montarEquipo(bd.servicios[0]!.id)
        await esperar(() => expect(enBody('equipo-estado-onu')?.textContent).toContain('En línea'))
        expect(enBody('equipo-smartolt')?.textContent).toContain('Zona norte')
        expect(enBody('equipo-acs')?.textContent).toContain('CASA_MENDEZ')
        expect(enBody('equipo-aprovisionar')?.textContent).toContain('Por el ACS')
    })
})
