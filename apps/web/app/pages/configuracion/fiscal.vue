<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * Configuración → Fiscal (localización GT, fase 2; `contratos/localizacion-fiscal.md` §11 y §14):
 * país, régimen, banderas, establecimientos, frases, parámetros con vigencia e impuestos de la
 * empresa activa. Todo es por empresa: con «Todas las empresas» se pide elegir una.
 */
definePageMeta({ permiso: 'fiscal.ver' })

useHead({ title: 'Fiscal · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { empresaId, empresa, conSelector } = useEmpresaActiva()

const PESTANAS = ['general', 'establecimientos', 'frases', 'parametros', 'impuestos'] as const
type Pestana = typeof PESTANAS[number]

const items: TabsItem[] = [
    { label: 'País y régimen', value: 'general', icon: 'i-lucide-scale' },
    { label: 'Establecimientos', value: 'establecimientos', icon: 'i-lucide-store' },
    { label: 'Frases', value: 'frases', icon: 'i-lucide-quote' },
    { label: 'Parámetros', value: 'parametros', icon: 'i-lucide-sliders-horizontal' },
    { label: 'Impuestos', value: 'impuestos', icon: 'i-lucide-percent' },
]

const pestana = computed<Pestana>({
    get: () => {
        const valor = route.query.pestana
        return PESTANAS.find(p => p === valor) ?? 'general'
    },
    set: (valor) => {
        void router.replace({ query: { ...route.query, pestana: valor === 'general' ? undefined : valor } })
    },
})
</script>

<template>
    <PanelPagina
        id="configuracion-fiscal"
        titulo="Fiscal"
        icono="i-lucide-landmark"
    >
        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Localización fiscal de <span class="font-medium text-highlighted">{{ empresa?.nombre_comercial ?? 'la empresa' }}</span>: lo que cambia aquí rige desde la fecha que indiques y nunca reescribe lo ya emitido.
            </p>

            <UAlert
                v-if="empresaId === null"
                color="info"
                variant="subtle"
                icon="i-lucide-building-2"
                title="Elige una empresa"
                :description="conSelector ? 'La configuración fiscal es de cada empresa (NIT): elige una en el selector de empresa.' : 'No hay una empresa activa en tu sesión.'"
                data-prueba="elegir-empresa"
            />
            <template v-else>
                <UTabs
                    v-model="pestana"
                    :items="items"
                    :content="false"
                    variant="link"
                    class="w-full overflow-x-auto"
                    :ui="{ list: 'w-max sm:w-full', label: 'whitespace-nowrap' }"
                />
                <div :key="`${empresaId}-${pestana}`">
                    <FiscalGeneral
                        v-if="pestana === 'general'"
                        :empresa-id="empresaId"
                    />
                    <FiscalEstablecimientos v-else-if="pestana === 'establecimientos'" />
                    <FiscalFrases v-else-if="pestana === 'frases'" />
                    <FiscalParametros v-else-if="pestana === 'parametros'" />
                    <FiscalImpuestos v-else />
                </div>
            </template>
        </div>
    </PanelPagina>
</template>
