<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Métricas de un anuncio (`GET /anuncios/:id/metricas`, `anuncios.ver`): vistas y clics (visitantes
 * distintos, una por sesión del navegador), por lugar y por día de los últimos 30 días (fecha de
 * Guatemala). Si la lectura falla: el error con "Reintentar" y ninguna cifra.
 */
const props = defineProps<{
    anuncioId: number
}>()

const metricas = shallowRef<MetricasAnuncio | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const columnasLugar: TableColumn<MetricasAnuncio['por_lugar'][number]>[] = [
    { accessorKey: 'lugar', header: 'Lugar' },
    { accessorKey: 'vistas', header: 'Vistas', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
    { accessorKey: 'clics', header: 'Clics', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
    { id: 'tasa', header: 'Tasa de clics', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
]

const dias = computed(() => (metricas.value ? diasMetricas(metricas.value.por_dia, hoyGuatemala()) : []))
const conEventos = computed(() => (metricas.value?.vistas ?? 0) > 0 || (metricas.value?.clics ?? 0) > 0)

const series = computed<SerieGrafica[]>(() => [
    { id: 'vistas', nombre: 'Vistas', valores: dias.value.map(d => d.vistas) },
    { id: 'clics', nombre: 'Clics', valores: dias.value.map(d => d.clics) },
])

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useAnuncios().metricas(props.anuncioId)
    cargando.value = false
    metricas.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => props.anuncioId, () => void cargar())
onMounted(cargar)
defineExpose({ recargar: cargar })
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Métricas del anuncio"
        data-prueba="anuncio-metricas"
    >
        <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Métricas
            </h3>
            <UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Actualizar las métricas"
                :loading="cargando"
                @click="cargar"
            />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!metricas"
            class="h-28 w-full"
        />
        <template v-else>
            <div class="grid gap-3 sm:grid-cols-3">
                <IndicadorTablero
                    etiqueta="Vistas"
                    :valor="String(metricas.vistas)"
                    detalle="Visitantes distintos que lo vieron"
                    icono="i-lucide-eye"
                    data-prueba="metrica-vistas"
                />
                <IndicadorTablero
                    etiqueta="Clics"
                    :valor="String(metricas.clics)"
                    detalle="Visitantes distintos que tocaron el botón"
                    icono="i-lucide-mouse-pointer-click"
                    data-prueba="metrica-clics"
                />
                <IndicadorTablero
                    etiqueta="Tasa de clics"
                    :valor="tasaClics(metricas)"
                    detalle="Clics entre vistas"
                    icono="i-lucide-percent"
                    data-prueba="metrica-tasa"
                />
            </div>

            <UEmpty
                v-if="!conEventos"
                icon="i-lucide-chart-no-axes-column"
                title="Todavía nadie lo ha visto"
                description="Las vistas cuentan cuando la tarjeta está al menos a la mitad en pantalla del portal."
                variant="naked"
            />
            <template v-else>
                <UTable
                    :data="metricas.por_lugar"
                    :columns="columnasLugar"
                    data-prueba="metricas-por-lugar"
                >
                    <template #lugar-cell="{ row }">
                        <span class="flex items-center gap-1.5 text-sm">
                            <UIcon
                                :name="LUGARES_ANUNCIO[row.original.lugar].icono"
                                class="size-4 text-muted"
                            />
                            {{ LUGARES_ANUNCIO[row.original.lugar].etiqueta }}
                        </span>
                    </template>
                    <template #tasa-cell="{ row }">
                        {{ tasaClics(row.original) }}
                    </template>
                </UTable>
                <GraficaColumnas
                    titulo="Vistas y clics por día (últimos 30 días)"
                    :categorias="dias.map(d => d.dia.slice(8, 10))"
                    :categorias-largas="dias.map(d => formatearFecha(d.dia))"
                    :series="series"
                    formato="entero"
                    :alto="200"
                    data-prueba="metricas-por-dia"
                />
            </template>
        </template>
    </section>
</template>
