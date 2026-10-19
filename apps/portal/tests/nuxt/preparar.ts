import { mountSuspended } from '@nuxt/test-utils/runtime'
import { config, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach } from 'vitest'
import { defineComponent } from 'vue'

/**
 * Preparación de cada archivo de `tests/nuxt` (`setupFiles` de `vitest.config.ts`). Quita las dos
 * causas por las que las pruebas pasaban los 5 s con la máquina cargada:
 *
 * 1. **Arranque en frío dentro de la primera prueba.** El primer `mountSuspended` de cada archivo
 *    arranca la app de Nuxt (router, plugins, transformación de módulos) y tarda de 1 a 3 s sin
 *    carga; con la máquina ocupada, varias veces eso. Se hace aquí, en un hook (con el
 *    `hookTimeout` de 60 s), y las pruebas solo miden lo suyo.
 * 2. **Montajes que se acumulan.** Una página que no se desmonta sigue viva el resto del archivo:
 *    re-renderiza con cada cambio del estado compartido (`useState`, fixtures) y sigue con sus
 *    sondeos. Cada prueba pagaba las anteriores (de ~150 ms a más de 600 ms por montaje al cuarto).
 *    Toda raíz montada se desmonta al terminar su prueba, salvo que la prueba ya lo hiciera.
 */

const montadas = new Set<VueWrapper>()

config.plugins.VueWrapper.install((wrapper) => {
    // solo las raíces (las de `findComponent` tienen padre y no se pueden desmontar solas)
    if (wrapper.vm?.$ && wrapper.vm.$.parent === null) {
        montadas.add(wrapper)
    }
    return {}
})

let enFrio = true

// `beforeEach` y no `beforeAll`: la app de Nuxt la crea el `beforeAll` de su entorno
// (`@nuxt/test-utils/runtime/entry`), que corre después de los de este archivo. Solo la primera vez.
beforeEach(async () => {
    if (!enFrio) {
        return
    }
    enFrio = false
    const vacia = await mountSuspended(defineComponent({ render: () => null }))
    vacia.unmount()
})

afterEach(() => {
    for (const wrapper of montadas) {
        if (!wrapper.vm.$.isUnmounted) {
            wrapper.unmount()
        }
    }
    montadas.clear()
})
