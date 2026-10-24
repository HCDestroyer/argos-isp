import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaPlantillas from '~/pages/plantillas/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Plantillas de facturación (tarea 8): el esquema espejo de `validarCoherencia`, el cuerpo que se
 * manda y el CRUD contra los fixtures (409, 422 por campo, una sola por defecto).
 */

function entradaValida(): EntradaPlantilla {
    return { ...entradaPlantillaVacia(), nombre: 'Mensual día 10', dia: 10 }
}

describe('plantillas · esquema', () => {
    it('acepta los valores por defecto de la API con nombre', () => {
        expect(esquemaPlantilla.safeParse(entradaValida()).success).toBe(true)
    })

    it('aplica las reglas entre campos de la API', () => {
        const errores = (entrada: EntradaPlantilla) => {
            const r = esquemaPlantilla.safeParse(entrada)
            return r.success ? [] : r.error.issues.map(i => i.path.join('.'))
        }
        expect(errores({ ...entradaValida(), dia: null })).toContain('dia')
        expect(errores({ ...entradaValida(), facturas_para_limitar: 3, facturas_para_cortar: 2 })).toContain('facturas_para_limitar')
        expect(errores({ ...entradaValida(), mora_tipo: 'fija', mora_valor: '0' })).toContain('mora_valor')
        expect(errores({ ...entradaValida(), mora_tipo: 'porcentaje', mora_valor: '150' })).toContain('mora_valor')
        const reglas = { ...entradaValida().reglas_promesa, max_por_periodo: 3, max_por_periodo_buen_historial: 2 }
        expect(errores({ ...entradaValida(), reglas_promesa: reglas })).toContain('reglas_promesa.max_por_periodo_buen_historial')
        const canales = { ...reglas.canales, portal: { ...reglas.canales.portal, plazo_max_dias: 90 } }
        expect(errores({ ...entradaValida(), reglas_promesa: { ...entradaValida().reglas_promesa, canales } })).toContain('reglas_promesa.canales.portal.plazo_max_dias')
    })

    it('el cuerpo manda montos con 2 decimales, null sin límite y sin día en aniversario', () => {
        const entrada = entradaValida()
        entrada.ciclo = 'aniversario'
        entrada.mora_tipo = 'fija'
        entrada.mora_valor = '25'
        entrada.reglas_promesa.deuda_maxima = '500'
        entrada.reglas_promesa.canales.operador.deuda_maxima = ''
        const cuerpo = cuerpoPlantilla(esquemaPlantilla.parse(entrada))
        expect(cuerpo).toMatchObject({ dia: null, mora_valor: '25.00', reglas_promesa: { deuda_maxima: '500.00', canales: { operador: { deuda_maxima: null } } } })
    })

    it('la edición solo manda por_defecto si cambió', () => {
        const plantilla = bd.plantillas[0]!
        const datos = esquemaPlantilla.parse(entradaDesdePlantilla(plantilla))
        expect(cambiosPlantilla(datos, plantilla)).not.toHaveProperty('por_defecto')
        expect(cambiosPlantilla({ ...datos, por_defecto: false }, plantilla)).toMatchObject({ por_defecto: false, version: plantilla.version })
    })
})

describe('plantillas · composable y fixtures', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('crea con todas las reglas y marcar por defecto desmarca la anterior', async () => {
        const datos = esquemaPlantilla.parse({ ...entradaValida(), por_defecto: true })
        datos.reglas_promesa.canales.portal.requiere_aprobacion = true
        const creada = await usePlantillas().crear(cuerpoPlantilla(datos))
        expect(creada.ok && creada.data).toMatchObject({ nombre: 'Mensual día 10', dia: 10, por_defecto: true, reglas_promesa: { canales: { portal: { requiere_aprobacion: true, plazo_max_dias: 3 } } } })
        const lista = await usePlantillas().listar()
        expect(lista.ok && lista.data.filter(p => p.por_defecto).map(p => p.nombre)).toEqual(['Mensual día 10'])
    })

    it('editar con la versión vieja da 409 y un 422 de coherencia trae el campo', async () => {
        const plantilla = bd.plantillas[0]!
        const datos = esquemaPlantilla.parse(entradaDesdePlantilla(plantilla))
        const editada = await usePlantillas().editar(plantilla.id, cambiosPlantilla({ ...datos, dias_gracia: 7 }, plantilla))
        expect(editada.ok && editada.data).toMatchObject({ dias_gracia: 7, version: 2 })
        const vieja = await usePlantillas().editar(plantilla.id, cambiosPlantilla(datos, { ...plantilla, version: 1 }))
        expect(!vieja.ok && vieja.problema.status).toBe(409)
        const incoherente = await usePlantillas().editar(plantilla.id, { version: 2, facturas_para_limitar: 5, facturas_para_cortar: 2 })
        expect(!incoherente.ok && incoherente.problema.errors?.[0]?.field).toBe('facturas_para_limitar')
    })

    it('la pantalla lista las plantillas con su resumen y ofrece crear y editar', async () => {
        const pagina = await mountSuspended(defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaPlantillas) }) }))
        await esperar(() => expect(pagina.find('[data-plantilla="1"]').exists()).toBe(true))
        expect(pagina.text()).toContain('Mensual día 1')
        expect(pagina.find('[data-prueba="plantilla-defecto"]').exists()).toBe(true)
        expect(pagina.find('[data-prueba="nueva-plantilla"]').exists()).toBe(true)
        expect(pagina.find('[data-prueba="editar-plantilla-2"]').exists()).toBe(true)
        expect(pagina.text()).toContain('Operador: con aprobación')
    })
})
