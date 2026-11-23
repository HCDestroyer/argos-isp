<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'

/**
 * Traslados (A3, `contratos/inventario.md` D.1; sistema visual del tablero NuevoBodegas): lo enviado
 * viaja «en camino» hasta que el destino lo recibe. Tarjeta isla con «Todos / En camino / Con
 * faltante», el número y la bodega o el técnico; «Con faltante» es la lista de diferencias por
 * investigar. «Nuevo traslado» con `inventario.crear_traslado`.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Traslados · ArgosIsp' })

const { puede } = usePermisos()

const TODAS = 'todas'
const bodegaId = ref<string>(TODAS)
const numero = ref('')
const numeroBuscado = ref<number | null>(null)

const bodegas = shallowRef<Bodega[]>([])
const itemsBodega = computed<SelectItem[]>(() => [
    { label: 'Bodega o técnico: todos', value: TODAS },
    ...bodegas.value.filter(b => !esBodegaTransito(b)).map(b => ({ label: b.tipo === 'tecnico' ? (b.usuario_nombre ?? b.nombre) : b.nombre, value: String(b.id), icon: TIPOS_BODEGA[b.tipo].icono, description: b.tipo === 'tecnico' ? b.nombre : undefined })),
])

const filtros = computed<FiltrosOrdenesTraslado>(() => ({
    ...(bodegaId.value !== TODAS ? { bodega_id: Number(bodegaId.value) } : {}),
    ...(numeroBuscado.value ? { numero: numeroBuscado.value } : {}),
}))

let espera: ReturnType<typeof setTimeout> | undefined
watch(numero, () => {
    clearTimeout(espera)
    espera = setTimeout(() => {
        numeroBuscado.value = /^\d+$/.test(numero.value.trim().replace(/^T-?0*/i, '')) ? Number(numero.value.trim().replace(/^T-?0*/i, '')) : null
    }, 300)
})
onBeforeUnmount(() => clearTimeout(espera))

onMounted(async () => {
    const resultado = await useBodegas().listar({ limit: 200 })
    bodegas.value = resultado.ok ? resultado.data.data : []
})
</script>

<template>
    <PanelPagina
        id="inventario-traslados"
        titulo="Traslados"
        icono="i-lucide-truck"
        sin-descripcion
    >
        <template #acciones>
            <UButton
                to="/inventario/bodegas"
                icon="i-lucide-warehouse"
                label="Bodegas"
                color="neutral"
                variant="outline"
                class="boton-flotante rounded-full"
            />
            <UButton
                v-if="puede('inventario.crear_traslado')"
                label="Nuevo traslado"
                icon="i-lucide-truck"
                size="lg"
                to="/inventario/traslados/nueva"
                class="glow-brand rounded-full px-5"
                data-prueba="nueva-orden-traslado"
            />
        </template>

        <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-2xl">
            <InventarioTrasladosLista :filtros="filtros">
                <template #filtros>
                    <div class="flex w-full flex-wrap gap-2 sm:ms-auto sm:w-auto">
                        <UInput
                            v-model="numero"
                            icon="i-lucide-search"
                            inputmode="numeric"
                            placeholder="Número (T-0046)"
                            aria-label="Buscar por número de orden"
                            class="w-full sm:w-44"
                            :ui="{ base: 'rounded-full' }"
                        />
                        <USelect
                            v-model="bodegaId"
                            :items="itemsBodega"
                            icon="i-lucide-filter"
                            aria-label="Filtrar por bodega o técnico"
                            class="w-full sm:w-60"
                        />
                    </div>
                </template>
            </InventarioTrasladosLista>
        </div>
    </PanelPagina>
</template>
