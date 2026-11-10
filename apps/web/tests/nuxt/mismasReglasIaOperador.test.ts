import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PlantillaFormulario from '~/components/PlantillaFormulario.vue'
import PaginaPlantillas from '~/pages/plantillas/index.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * «Mismas reglas para IA y operador» (`reglas_promesa.mismas_reglas_ia_operador`, A3): con la opción
 * el canal `ia` usa los límites efectivos de `operador`; `canales.ia` se conserva pero no se aplica.
 */

/** Servicio 2 (suspendido, con dos facturas vencidas): su plantilla, para tocar sus reglas. */
const SERVICIO_CON_DEUDA = 2

function plantillaDelServicio(servicioId: number) {
    const servicio = bd.servicios.find(s => s.id === servicioId)
    const plantilla = bd.plantillas.find(p => p.id === servicio?.plantilla_facturacion_id)
    if (!plantilla) {
        throw new Error(`Fixture: el servicio ${servicioId} no tiene plantilla`)
    }
    return plantilla
}

function enCuerpo(selector: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(selector)
}

describe('mismas reglas para IA y operador · esquema y cuerpo', () => {
    it('apagada por defecto, como `REGLAS_PROMESA_POR_DEFECTO`, y en todas las plantillas de los fixtures', () => {
        expect(entradaPlantillaVacia().reglas_promesa.mismas_reglas_ia_operador).toBe(false)
        reiniciarFixtures()
        expect(bd.plantillas.length).toBeGreaterThan(0)
        expect(bd.plantillas.map(p => p.reglas_promesa.mismas_reglas_ia_operador)).toEqual(bd.plantillas.map(() => false))
    })

    it('viaja en el cuerpo y conserva los límites de `canales.ia`', () => {
        const entrada = { ...entradaPlantillaVacia(), nombre: 'IA como operador' }
        entrada.reglas_promesa.mismas_reglas_ia_operador = true
        entrada.reglas_promesa.canales.ia.plazo_max_dias = 2
        const cuerpo = cuerpoPlantilla(esquemaPlantilla.parse(entrada))
        expect(cuerpo.reglas_promesa).toMatchObject({ mismas_reglas_ia_operador: true, canales: { ia: { plazo_max_dias: 2 } } })
    })

    it('el esquema espejo exige un booleano', () => {
        const entrada = entradaPlantillaVacia()
        const resultado = esquemaPlantilla.safeParse({ ...entrada, nombre: 'X1', reglas_promesa: { ...entrada.reglas_promesa, mismas_reglas_ia_operador: 'si' } })
        expect(!resultado.success && resultado.error.issues.map(i => i.path.join('.'))).toContain('reglas_promesa.mismas_reglas_ia_operador')
    })

    it('`ia` toma los límites de `operador` solo con la opción; los demás canales no cambian', () => {
        const reglas = structuredClone(entradaPlantillaVacia().reglas_promesa)
        expect(canalDeLimites({ mismas_reglas_ia_operador: false }, 'ia')).toBe('ia')
        expect(canalDeLimites({ mismas_reglas_ia_operador: true }, 'ia')).toBe('operador')
        expect(canalDeLimites({ mismas_reglas_ia_operador: true }, 'portal')).toBe('portal')
        reiniciarFixtures()
        const guardadas = structuredClone(bd.plantillas[0]!.reglas_promesa)
        guardadas.canales.operador.requiere_aprobacion = true
        expect(limitesEfectivosCanal(guardadas, 'ia').requiere_aprobacion).toBe(false)
        guardadas.mismas_reglas_ia_operador = true
        expect(limitesEfectivosCanal(guardadas, 'ia')).toEqual(guardadas.canales.operador)
        expect(reglas.canales.ia.plazo_max_dias).toBe(3)
    })
})

describe('mismas reglas para IA y operador · fixtures y pantallas', () => {
    beforeEach(() => {
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

    it('crear y editar la guardan; editar sin `reglas_promesa` no la cambia', async () => {
        const entrada = { ...entradaPlantillaVacia(), nombre: 'IA como operador' }
        entrada.reglas_promesa.mismas_reglas_ia_operador = true
        const creada = await usePlantillas().crear(cuerpoPlantilla(esquemaPlantilla.parse(entrada)))
        expect(creada.ok && creada.data.reglas_promesa).toMatchObject({ mismas_reglas_ia_operador: true, canales: { ia: { plazo_max_dias: 3 } } })
        if (!creada.ok) {
            return
        }
        const editada = await usePlantillas().editar(creada.data.id, { version: creada.data.version, dias_gracia: 3 })
        expect(editada.ok && editada.data.reglas_promesa.mismas_reglas_ia_operador).toBe(true)
        const invalida = await usePlantillas().editar(creada.data.id, { version: 2, reglas_promesa: { mismas_reglas_ia_operador: 'si' as unknown as boolean } })
        expect(!invalida.ok && invalida.problema.errors?.[0]?.field).toBe('reglas_promesa.mismas_reglas_ia_operador')
    })

    it('el simulador: con la opción, `ia` se evalúa con los límites de `operador` (origen operador)', async () => {
        const plantilla = plantillaDelServicio(SERVICIO_CON_DEUDA)
        plantilla.reglas_promesa.canales.ia.permitido = false
        plantilla.reglas_promesa.canales.operador.requiere_aprobacion = true

        const sin = await usePromesas().simular({ servicio_id: SERVICIO_CON_DEUDA, canal: 'ia' })
        expect(sin.ok && sin.data).toMatchObject({ resultado: 'rechazada', regla: 'canal_permitido' })
        expect(sin.ok && sin.data.reglas.find(r => r.regla === 'canal_permitido')?.origen).toBe('ia')

        plantilla.reglas_promesa.mismas_reglas_ia_operador = true
        const con = await usePromesas().simular({ servicio_id: SERVICIO_CON_DEUDA, canal: 'ia' })
        expect(con.ok && con.data).toMatchObject({ canal: 'ia', resultado: 'pendiente_aprobacion', regla: 'requiere_aprobacion' })
        expect(con.ok && con.data.limites).toMatchObject({ permitido: true, requiere_aprobacion: true })
        expect(con.ok && con.data.reglas.find(r => r.regla === 'canal_permitido')).toMatchObject({ ok: true, origen: 'operador' })
        expect(con.ok && con.data.motivo).toContain('(mismas reglas que operador)')
        // `canales.ia` se conserva: apagar la opción vuelve a rechazar.
        expect(plantilla.reglas_promesa.canales.ia.permitido).toBe(false)
    })

    it('el formulario: la casilla atenúa y deshabilita los campos de IA, explica que no se aplican y conserva sus valores', async () => {
        const plantilla = structuredClone(bd.plantillas[0]!)
        plantilla.reglas_promesa.canales.ia.plazo_max_dias = 2
        const wrapper = await mountSuspended(PlantillaFormulario, { props: { plantilla, open: true } })
        await esperar(() => expect(enCuerpo('[data-prueba="plantilla-mismas-reglas-ia-operador"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Mismas reglas para IA y operador')
        expect(document.body.textContent).toContain('El asistente de IA usará los mismos límites que una persona (operador).')
        expect(enCuerpo('[data-prueba="plantilla-canal-ia"]')?.dataset.ignorado).toBeUndefined()
        expect(enCuerpo('[data-prueba="plantilla-canal-ia-ignorado"]')).toBeNull()

        const casilla = enCuerpo('[data-prueba="plantilla-mismas-reglas-ia-operador"] [role="checkbox"], [role="checkbox"][data-prueba="plantilla-mismas-reglas-ia-operador"]')
        expect(casilla).not.toBeNull()
        casilla?.click()
        await esperar(() => expect(enCuerpo('[data-prueba="plantilla-canal-ia-ignorado"]')).not.toBeNull())
        const ia = enCuerpo('[data-prueba="plantilla-canal-ia"]')
        expect(ia?.dataset.ignorado).toBe('si')
        expect(ia?.textContent).toContain('no se aplican')
        expect(ia?.querySelector('.opacity-50')).not.toBeNull()
        const plazo = ia?.querySelector<HTMLInputElement>('[data-prueba="plantilla-canal-ia-plazo"] input, input[data-prueba="plantilla-canal-ia-plazo"]')
        expect(plazo?.disabled).toBe(true)
        expect(plazo?.value).toBe('2')
        expect(ia?.querySelector('[data-prueba="plantilla-canal-ia-permitido"]')?.hasAttribute('disabled')).toBe(true)
        // Los otros canales siguen editables.
        expect(enCuerpo('[data-prueba="plantilla-canal-operador"]')?.dataset.ignorado).toBeUndefined()
        expect(enCuerpo('[data-prueba="plantilla-canal-operador-ignorado"]')).toBeNull()
        wrapper.unmount()
    })

    it('la lista marca la plantilla y cuenta la aprobación de IA con los límites de operador', async () => {
        const plantilla = bd.plantillas.find(p => p.id === 2)!
        plantilla.reglas_promesa.mismas_reglas_ia_operador = true
        const pagina = await mountSuspended(defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaPlantillas) }) }))
        await esperar(() => expect(pagina.find('[data-plantilla="2"]').exists()).toBe(true))
        const fila = pagina.find('[data-plantilla="2"]').element.closest('tr')
        expect(fila?.querySelector('[data-prueba="plantilla-mismas-reglas"]')).not.toBeNull()
        expect(fila?.textContent).toContain('IA: con aprobación')
        const otra = pagina.find('[data-plantilla="1"]').element.closest('tr')
        expect(otra?.querySelector('[data-prueba="plantilla-mismas-reglas"]')).toBeNull()
        pagina.unmount()
    })
})
