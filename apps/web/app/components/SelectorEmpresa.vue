<script setup lang="ts">
import type { SelectMenuItem } from '@nuxt/ui'

/**
 * Selector de la empresa activa (multiempresa), en la barra superior. Con una sola empresa no se
 * muestra. "Todas las empresas" (consolidado) solo con alcance global. Al cambiar, la página se
 * vuelve a montar (`app.vue`) y relee sus datos con la nueva `X-Empresa-Id`, sin perder la sesión.
 */
const { eleccion, empresas, alcanceGlobal, conSelector, elegir } = useEmpresaActiva()

interface OpcionEmpresa {
    label: string
    value: EleccionEmpresa
    description?: string
    avatar?: { src?: string, alt: string }
    icon?: string
}

const opciones = computed<OpcionEmpresa[]>(() => [
    ...(alcanceGlobal.value ? [{ label: 'Todas las empresas', value: 'todas' as const, icon: 'i-lucide-layers', description: 'Consolidado' }] : []),
    ...empresas.value.map(e => ({
        label: e.nombre_comercial,
        value: e.id,
        description: e.nit ? `NIT ${e.nit}` : undefined,
        avatar: { src: urlLogoEmpresa(e.logo_url), alt: e.nombre_comercial },
    })),
])

const seleccionada = computed(() => opciones.value.find(o => o.value === eleccion.value))

const modelo = computed<EleccionEmpresa | undefined>({
    get: () => eleccion.value ?? undefined,
    set: (valor) => {
        if (valor !== undefined) {
            elegir(valor)
        }
    },
})

const items = computed<SelectMenuItem[]>(() => opciones.value)
</script>

<template>
    <USelectMenu
        v-if="conSelector"
        v-model="modelo"
        :items="items"
        value-key="value"
        :search-input="false"
        :avatar="seleccionada?.avatar"
        :icon="seleccionada?.icon"
        color="neutral"
        variant="outline"
        aria-label="Empresa activa"
        class="w-40 sm:w-56"
        :ui="{ content: 'min-w-64' }"
        data-prueba="selector-empresa"
    />
</template>
