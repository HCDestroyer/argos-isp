<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Reporte del programa de lealtad (`GET /reportes/lealtad`, `reportes.ver`; A3, §15.1): puntos
 * emitidos, canjeados, vencidos y revertidos por empresa, y el pasivo de los lotes vivos contra el
 * saldo de 2.1.10 (`cuadra`). Si no cuadra, el aviso se ve arriba de todo.
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reporte de lealtad · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { empresas } = useEmpresaActiva()

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const texto = (valor: unknown) => (typeof valor === 'string' && FECHA.test(valor) ? valor : '')
const desde = ref(texto(route.query.desde))
const hasta = ref(texto(route.query.hasta))
const reporte = shallowRef<ReporteLealtad | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const descuadradas = computed(() => reporte.value?.empresas.filter(e => !e.cuadra) ?? [])

function nombreEmpresa(id: number): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

async function cargar() {
    cargando.value = true
    const resultado = await usePuntosLealtad().reporte(desde.value || undefined, hasta.value || undefined)
    cargando.value = false
    reporte.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch([desde, hasta], async () => {
    const query: Record<string, string> = {}
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    await router.replace({ query })
    await cargar()
})

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="reporte-lealtad"
        titulo="Reporte de lealtad"
        icono="i-lucide-gem"
    >
        <template #acciones>
            <UButton
                to="/reportes"
                icon="i-lucide-arrow-left"
                label="Reportes"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <UInput
                    v-model="desde"
                    type="date"
                    :max="hasta || undefined"
                    aria-label="Desde"
                    class="w-full"
                />
                <UInput
                    v-model="hasta"
                    type="date"
                    :min="desde || undefined"
                    aria-label="Hasta"
                    class="w-full"
                />
            </div>
            <p class="text-xs text-muted">
                Los movimientos se cuentan en el rango; el saldo y el pasivo son al día de hoy.
            </p>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="reporte-lealtad-error"
            />
            <USkeleton
                v-else-if="cargando && !reporte"
                class="h-48 w-full"
            />
            <template v-else-if="reporte">
                <UAlert
                    v-if="descuadradas.length"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="El pasivo de los puntos no cuadra con el libro"
                    :description="descuadradas.map(e => `${nombreEmpresa(e.empresa_id)}: lotes ${formatearQuetzales(e.pasivo_lotes)} · 2.1.10 ${formatearQuetzales(e.pasivo_libro)}`).join(' · ')"
                    data-prueba="lealtad-no-cuadra"
                />
                <UEmpty
                    v-if="!reporte.empresas.length"
                    icon="i-lucide-gem"
                    title="Sin programas de lealtad que reportar"
                    variant="naked"
                />
                <UPageCard
                    v-for="fila in reporte.empresas"
                    :key="fila.empresa_id"
                    variant="subtle"
                    :data-empresa="fila.empresa_id"
                >
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h2 class="text-lg font-semibold text-highlighted">
                                {{ nombreEmpresa(fila.empresa_id) }}
                            </h2>
                            <UBadge
                                :label="fila.cuadra ? 'Cuadra con el libro' : 'No cuadra'"
                                :color="fila.cuadra ? 'success' : 'error'"
                                :icon="fila.cuadra ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                                variant="subtle"
                                size="lg"
                                data-prueba="cuadra-lealtad"
                            />
                        </div>
                        <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                            <DatoFicha
                                etiqueta="Emitidos"
                                :valor="`${formatearPuntos(fila.emitidos)} · ${formatearQuetzales(fila.valor_emitido)}`"
                            />
                            <DatoFicha
                                etiqueta="Canjeados"
                                :valor="formatearPuntos(fila.canjeados)"
                            />
                            <DatoFicha
                                etiqueta="Vencidos"
                                :valor="formatearPuntos(fila.vencidos)"
                            />
                            <DatoFicha
                                etiqueta="Revertidos y ajustes negativos"
                                :valor="`${formatearPuntos(fila.revertidos)} · ${formatearPuntos(fila.ajustes_negativos)}`"
                            />
                            <DatoFicha
                                etiqueta="Valor liberado"
                                :valor="formatearQuetzales(fila.valor_liberado)"
                            />
                            <DatoFicha
                                etiqueta="Saldo de puntos"
                                :valor="formatearPuntos(fila.saldo_puntos)"
                            />
                            <DatoFicha
                                etiqueta="Puntos vivos en lotes"
                                :valor="formatearPuntos(fila.puntos_vivos)"
                            />
                            <DatoFicha
                                etiqueta="Pasivo: lotes / 2.1.10"
                                :valor="`${formatearQuetzales(fila.pasivo_lotes)} / ${formatearQuetzales(fila.pasivo_libro)}`"
                                data-prueba="pasivo-lealtad"
                            />
                        </dl>
                    </div>
                </UPageCard>
            </template>
        </div>
    </PanelPagina>
</template>
