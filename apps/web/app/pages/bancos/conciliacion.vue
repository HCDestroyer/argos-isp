<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Resumen de conciliación por cuenta y fecha (`GET /reportes/conciliacion-bancaria`,
 * `reportes.ver`; A3, fase 4 §10.3): saldo del libro, saldo del extracto, partidas en tránsito de
 * cada lado y la diferencia que queda = extracto − (libro − tránsito del libro + tránsito del extracto).
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reporte de conciliación · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { enlace } = usePermisos()

const hoy = hoyGuatemala()
const cuentaId = ref<number | null>(Number(route.query.cuenta) || null)
const fecha = ref(typeof route.query.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.fecha) ? route.query.fecha : hoy)
const filas = shallowRef<ResumenConciliacionBancaria[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const columnasPartidas: TableColumn<PartidaEnTransito>[] = [
    { accessorKey: 'descripcion', header: 'Partida' },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function cargar() {
    cargando.value = true
    const resultado = await useConciliaciones().reporte(cuentaId.value ?? undefined, fecha.value || undefined)
    cargando.value = false
    filas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

watch([cuentaId, fecha], async () => {
    const query: Record<string, string> = {}
    if (cuentaId.value) {
        query.cuenta = String(cuentaId.value)
    }
    if (fecha.value && fecha.value !== hoy) {
        query.fecha = fecha.value
    }
    await router.replace({ query })
    await cargar()
})

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="reporte-conciliacion"
        titulo="Reporte de conciliación"
        icono="i-lucide-scale"
    >
        <template #acciones>
            <UButton
                :to="enlace('/bancos/extractos')"
                icon="i-lucide-file-spreadsheet"
                label="Extractos"
                color="neutral"
                variant="ghost"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Extractos"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <CuentaBancoSelect
                    v-model="cuentaId"
                    con-todas
                    aria-label="Cuenta"
                />
                <UInput
                    v-model="fecha"
                    type="date"
                    :max="hoy"
                    aria-label="Al día"
                    class="w-full"
                />
            </div>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="reporte-conciliacion-error"
            />
            <USkeleton
                v-else-if="cargando && !filas.length"
                class="h-48 w-full"
            />
            <UEmpty
                v-else-if="!filas.length"
                icon="i-lucide-scale"
                title="Sin cuentas bancarias que reportar"
                variant="naked"
            />
            <UPageCard
                v-for="fila in filas"
                v-else
                :key="fila.cuenta_id"
                variant="subtle"
                :data-cuenta="fila.cuenta_id"
            >
                <div class="flex flex-col gap-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex flex-col">
                            <h2 class="text-lg font-semibold text-highlighted">
                                {{ fila.cuenta_nombre }}
                            </h2>
                            <p class="text-sm text-muted">
                                <span class="font-mono">{{ fila.cuenta_codigo }}</span> · al {{ formatearFecha(fila.fecha) }}<template v-if="fila.desde">
                                    · extractos desde {{ formatearFecha(fila.desde) }}
                                </template>
                            </p>
                        </div>
                        <UBadge
                            :label="fila.cuadra ? 'Cuadra' : `Diferencia ${formatearQuetzales(fila.diferencia)}`"
                            :color="fila.cuadra ? 'success' : 'error'"
                            :icon="fila.cuadra ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                            variant="subtle"
                            size="lg"
                            data-prueba="cuadra-conciliacion"
                        />
                    </div>

                    <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-5">
                        <DatoFicha
                            etiqueta="Saldo del libro"
                            :valor="formatearQuetzales(fila.saldo_libro)"
                            data-prueba="saldo-libro"
                        />
                        <DatoFicha
                            etiqueta="Saldo del extracto"
                            :valor="fila.saldo_extracto === null ? 'Sin extracto' : formatearQuetzales(fila.saldo_extracto)"
                            data-prueba="saldo-extracto"
                        />
                        <DatoFicha
                            etiqueta="En el libro, no en el banco"
                            :valor="formatearQuetzales(fila.total_libro_en_transito)"
                        />
                        <DatoFicha
                            etiqueta="En el banco, no en el libro"
                            :valor="formatearQuetzales(fila.total_extracto_en_transito)"
                        />
                        <DatoFicha
                            etiqueta="Diferencia de apertura"
                            :valor="formatearQuetzales(fila.diferencia_apertura)"
                        />
                    </dl>

                    <div class="grid gap-4 lg:grid-cols-2">
                        <section class="flex flex-col gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                                Partidas del libro en tránsito
                            </h3>
                            <UTable
                                :data="fila.libro_en_transito"
                                :columns="columnasPartidas"
                                tabindex="0"
                                :aria-label="`Partidas del libro en tránsito de ${fila.cuenta_nombre}`"
                            >
                                <template #descripcion-cell="{ row }">
                                    <div class="flex min-w-0 flex-col whitespace-normal">
                                        <span class="text-sm">{{ row.original.descripcion }}</span>
                                        <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }}</span>
                                    </div>
                                </template>
                                <template #monto-cell="{ row }">
                                    <span class="tabular-nums">{{ montoConSigno(row.original.monto) }}</span>
                                </template>
                                <template #empty>
                                    <span class="text-sm text-muted">Ninguna</span>
                                </template>
                            </UTable>
                        </section>
                        <section class="flex flex-col gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                                Partidas del extracto en tránsito
                            </h3>
                            <UTable
                                :data="fila.extracto_en_transito"
                                :columns="columnasPartidas"
                                tabindex="0"
                                :aria-label="`Partidas del extracto en tránsito de ${fila.cuenta_nombre}`"
                            >
                                <template #descripcion-cell="{ row }">
                                    <div class="flex min-w-0 flex-col whitespace-normal">
                                        <span class="text-sm">{{ row.original.descripcion }}</span>
                                        <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }}</span>
                                    </div>
                                </template>
                                <template #monto-cell="{ row }">
                                    <span class="tabular-nums">{{ montoConSigno(row.original.monto) }}</span>
                                </template>
                                <template #empty>
                                    <span class="text-sm text-muted">Ninguna</span>
                                </template>
                            </UTable>
                        </section>
                    </div>
                    <p class="text-xs text-muted">
                        Diferencia = extracto − (libro − tránsito del libro + tránsito del extracto). Una conciliación cuenta al día si su línea y sus movimientos son de esa fecha o antes.
                    </p>
                </div>
            </UPageCard>
        </div>
    </PanelPagina>
</template>
