import { CalendarDate } from '@internationalized/date'
import { es } from '@nuxt/ui/locale'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { Comment, createCommentVNode, createTextVNode, defineComponent, Fragment, h, nextTick, ref } from 'vue'
import type { VNode } from 'vue'
import { UApp, UCalendar } from '#components'
import CampoFecha from '~/components/CampoFecha.vue'

/** `CampoFecha` dentro de `UApp` con el idioma del panel (como en `app.vue`). */
function envolver(inicial: string | null, extra: Record<string, unknown> = {}) {
    const valor = ref<string | null>(inicial)
    const emitidos: string[] = []
    const Prueba = defineComponent({
        setup: () => () => h(UApp, { locale: es }, () => h(CampoFecha, {
            'modelValue': valor.value,
            'onUpdate:modelValue': (nuevo: string) => {
                emitidos.push(nuevo)
                valor.value = nuevo
            },
            ...extra,
        })),
    })
    return { Prueba, valor, emitidos }
}

describe('CampoFecha', () => {
    it('muestra la fecha de la API (YYYY-MM-DD) en dd/mm/aaaa', async () => {
        const { Prueba } = envolver('2026-08-05')
        const vista = await mountSuspended(Prueba)
        const campo = vista.get('input')
        expect((campo.element as HTMLInputElement).value).toBe('05/08/2026')
        expect(campo.attributes('placeholder')).toBe('dd/mm/aaaa')
    })

    it('al escribir pone las barras y devuelve YYYY-MM-DD solo con la fecha completa', async () => {
        const { Prueba, emitidos, valor } = envolver(null)
        const vista = await mountSuspended(Prueba)
        const campo = vista.get('input')
        await campo.setValue('3108')
        expect((campo.element as HTMLInputElement).value).toBe('31/08')
        expect(emitidos).toEqual([])
        await campo.setValue('31/08/2026')
        expect(emitidos).toEqual(['2026-08-31'])
        expect(valor.value).toBe('2026-08-31')
        // Borrar un dígito deja el campo sin fecha (como el nativo): el esquema la pide de nuevo.
        await campo.setValue('31/08/202')
        expect(emitidos).toEqual(['2026-08-31', ''])
        expect((campo.element as HTMLInputElement).value).toBe('31/08/202')
    })

    it('una fecha que no existe no se envía', async () => {
        const { Prueba, emitidos } = envolver(null)
        const vista = await mountSuspended(Prueba)
        await vista.get('input').setValue('31/02/2026')
        expect(emitidos).toEqual([])
    })

    it('un cambio de fuera (descartar) se ve en el campo', async () => {
        const { Prueba, valor } = envolver('2026-08-31')
        const vista = await mountSuspended(Prueba)
        valor.value = '2026-01-02'
        await nextTick()
        await nextTick()
        expect((vista.get('input').element as HTMLInputElement).value).toBe('02/01/2026')
    })

    it('el calendario recibe min y max y escribe el día elegido', async () => {
        const { Prueba, emitidos } = envolver('2026-10-20', { min: '2026-10-01', max: '2026-10-31' })
        const vista = await mountSuspended(Prueba)
        await vista.get('[data-prueba="campo-fecha-calendario"]').trigger('click')
        await nextTick()
        const calendario = vista.findComponent(UCalendar)
        expect(calendario.exists()).toBe(true)
        const limites = calendario.props() as { minValue?: unknown, maxValue?: unknown }
        expect(String(limites.minValue)).toBe('2026-10-01')
        expect(String(limites.maxValue)).toBe('2026-10-31')
        calendario.vm.$emit('update:modelValue', new CalendarDate(2026, 10, 7))
        await nextTick()
        expect(emitidos).toEqual(['2026-10-07'])
        expect((vista.get('input').element as HTMLInputElement).value).toBe('07/10/2026')
    })
})

describe('hayContenido', () => {
    it('un slot cuyo botón quedó fuera por permiso no pinta nada', () => {
        expect(hayContenido(undefined)).toBe(false)
        expect(hayContenido([createCommentVNode('v-if')])).toBe(false)
        expect(hayContenido([createTextVNode('  ')])).toBe(false)
        expect(hayContenido([h(Fragment, [createCommentVNode('v-if')])])).toBe(false)
        expect(hayContenido([h(Comment)])).toBe(false)
    })

    it('un botón sí cuenta, también dentro de un fragmento', () => {
        const boton: VNode = h('span', 'Nuevo')
        expect(hayContenido([boton])).toBe(true)
        expect(hayContenido([h(Fragment, [createCommentVNode('x'), boton])])).toBe(true)
    })
})
