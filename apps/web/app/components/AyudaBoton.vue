<script setup lang="ts">
/**
 * Ayuda contextual (contrato `documentacion.md` §6 y sistema visual Argos): el botón «Ayuda» abre
 * un panel lateral con el resumen de la pantalla actual tomado del manual (`INDICE_AYUDA`, generado
 * de `docs/manual` por `herramientas/indiceAyuda.mjs`) y el enlace «Ver manual completo», que abre
 * en otra pestaña `<docsUrl>/ayuda/?pantalla=<clave>`. Sin resumen para la pantalla, el botón va
 * directo al manual.
 * No usa `UTooltip`: va en todas las pantallas y las pruebas las montan sin el proveedor de `UApp`.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    /** Con la etiqueta siempre visible (menú lateral del teléfono). */
    conEtiqueta?: boolean
    /** Solo el icono (junto al título de la página). */
    soloIcono?: boolean
}>(), {
    conEtiqueta: false,
    soloIcono: false,
})

const route = useRoute()
const config = useRuntimeConfig()

const clave = computed(() => claveAyudaDeRuta(route.matched))
const url = computed(() => clave.value ? urlAyuda(String(config.public.docsUrl), clave.value) : null)
const entrada = computed(() => (clave.value ? INDICE_AYUDA[clave.value] ?? null : null))
const abierto = ref(false)

const boton = computed(() => ({
    label: props.soloIcono ? undefined : 'Ayuda',
    icon: 'i-lucide-circle-help',
    color: 'neutral' as const,
    variant: 'ghost' as const,
    block: props.conEtiqueta,
    square: props.soloIcono,
    size: 'md' as const,
    class: props.conEtiqueta ? 'justify-start cursor-help' : 'cursor-help justify-center',
    ui: { label: props.conEtiqueta ? '' : 'hidden md:inline', leadingIcon: 'size-5' },
}))
</script>

<template>
    <!-- La clase del padre (`hidden sm:inline-flex`, `boton-flotante boton-circulo`) va al botón, no a
         una envoltura: así el círculo y el icono quedan centrados. La envoltura no ocupa caja. -->
    <div
        v-if="url"
        class="contents"
    >
        <UButton
            v-if="entrada"
            v-bind="{ ...boton, ...$attrs, class: [boton.class, $attrs.class] }"
            title="Ayuda de esta pantalla"
            aria-label="Ayuda de esta pantalla"
            aria-haspopup="dialog"
            data-ayuda
            data-prueba="boton-ayuda"
            @click="abierto = true"
        />
        <UButton
            v-else
            v-bind="{ ...boton, ...$attrs, class: [boton.class, $attrs.class] }"
            :to="url"
            target="_blank"
            rel="noopener"
            title="Ayuda de esta pantalla"
            aria-label="Ayuda de esta pantalla (se abre en otra pestaña)"
            data-ayuda
            data-prueba="boton-ayuda"
        />
        <AyudaPanel
            v-if="entrada"
            v-model:open="abierto"
        />
    </div>
</template>
