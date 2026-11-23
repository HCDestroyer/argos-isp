<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha de un plan (sistema visual del rediseño): cabecera con tipo, velocidad y precio, y las
 * acciones en una fila (Sincronizar y Editar, que abre el formulario en página
 * `/planes/:id/editar`); tarjetas de velocidad, reparto y direcciones; los adicionales que trae
 * (`GET/PUT /planes/:id/adicionales`) y su implementación en cada router (`GET/PUT /planes/:id/routers`).
 */
definePageMeta({ permiso: 'planes.ver' })

const route = useRoute()
const { puede } = usePermisos()

const planId = computed(() => Number(route.params.id))
const plan = shallowRef<Plan | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${plan.value?.nombre ?? 'Plan'} · ArgosIsp` }))

const DUAL_STACK: Record<Plan['dual_stack'], string> = { ambos: 'IPv4 e IPv6', v4: 'Solo IPv4', v6: 'Solo IPv6' }

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePlanes().ver(planId.value)
    cargando.value = false
    if (resultado.ok) {
        plan.value = resultado.data
        return
    }
    plan.value = null
    problema.value = resultado.problema
}

watch(planId, () => void cargar())
onMounted(cargar)

/** «Sincronizar plan» en todos sus routers (`planes.sincronizar`). */
const sincronizarAbierto = ref(false)
</script>

<template>
    <PanelPagina
        id="plan"
        :titulo="plan?.nombre ?? 'Plan'"
        icono="i-lucide-gauge"
        encabezado-propio
    >
        <div class="flex flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando && !plan"
                class="h-24 w-full rounded-[1.375rem]"
            />

            <template v-else-if="plan">
                <header
                    class="surface-card flex flex-col gap-3 rounded-[1.375rem] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    data-prueba="plan-cabecera"
                >
                    <div class="flex min-w-0 items-center gap-3">
                        <span class="pastilla-icono pastilla-tono tono-marca size-12 shrink-0 rounded-2xl">
                            <UIcon
                                name="i-lucide-gauge"
                                class="size-6"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col gap-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <h1 class="truncate text-xl font-bold tracking-[-0.02em] text-highlighted">
                                    {{ plan.nombre }}
                                </h1>
                                <TipoPlanBadge
                                    :tipo="plan.tipo"
                                    data-prueba="tipo-plan"
                                />
                                <UBadge
                                    v-if="!plan.activo"
                                    label="No en venta"
                                    icon="i-lucide-circle-pause"
                                    color="neutral"
                                    variant="subtle"
                                    class="rounded-full"
                                />
                                <UBadge
                                    :label="plan.global ? 'Todos los routers' : 'Solo en algunos routers'"
                                    :icon="plan.global ? 'i-lucide-globe' : 'i-lucide-router'"
                                    color="neutral"
                                    variant="outline"
                                    class="rounded-full"
                                />
                            </div>
                            <p class="text-[0.8125rem] text-muted">
                                {{ formatearVelocidad(plan.bajada_kbps) }} / {{ formatearVelocidad(plan.subida_kbps) }} · {{ formatearQuetzales(plan.precio) }} al mes · última modificación {{ formatearFechaHora(plan.updated_at) }}
                            </p>
                        </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        <UButton
                            v-if="puede('planes.sincronizar')"
                            label="Sincronizar plan"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="outline"
                            class="rounded-full"
                            :ui="{ label: 'hidden sm:inline' }"
                            aria-label="Sincronizar plan"
                            data-prueba="sincronizar-plan"
                            @click="sincronizarAbierto = true"
                        />
                        <UButton
                            v-if="puede('planes.editar')"
                            :to="`/planes/${plan.id}/editar`"
                            label="Editar"
                            :icon="ICONOS.editar"
                            class="rounded-full"
                            data-prueba="editar-plan"
                        />
                    </div>
                </header>

                <div class="grid gap-4 lg:grid-cols-3">
                    <RedTarjeta
                        titulo="Velocidad"
                        icono="i-lucide-gauge"
                    >
                        <dl>
                            <RedFila
                                etiqueta="Bajada / subida"
                                :valor="`${formatearVelocidad(plan.bajada_kbps)} / ${formatearVelocidad(plan.subida_kbps)}`"
                            />
                            <RedFila
                                etiqueta="Limitado (mora)"
                                :valor="`${formatearVelocidad(plan.bajada_limitada_kbps)} / ${formatearVelocidad(plan.subida_limitada_kbps)}`"
                            />
                        </dl>
                    </RedTarjeta>
                    <RedTarjeta
                        titulo="Reparto"
                        icono="i-lucide-layers"
                    >
                        <dl>
                            <RedFila
                                etiqueta="Reuso · garantía · prioridad"
                                :valor="resumenVelocidadPlan(plan)"
                            />
                            <RedFila
                                etiqueta="Ráfaga"
                                :valor="plan.rafaga_bajada_kbps ? `${formatearVelocidad(plan.rafaga_bajada_kbps)} por ${plan.rafaga_segundos} s` : 'Sin ráfaga'"
                            />
                        </dl>
                    </RedTarjeta>
                    <RedTarjeta
                        titulo="Direcciones"
                        icono="i-lucide-network"
                    >
                        <dl>
                            <RedFila
                                etiqueta="IP"
                                :valor="DUAL_STACK[plan.dual_stack]"
                            />
                            <RedFila
                                etiqueta="Red de su casa (IPv6)"
                                :valor="`/${plan.tamano_prefijo_delegado}`"
                            />
                        </dl>
                    </RedTarjeta>
                </div>

                <PlanIncluidos
                    :plan="plan"
                    @actualizado="cargar"
                />

                <PlanRouters :plan="plan" />
            </template>
        </div>

        <SincronizarPlanModal
            v-if="plan && puede('planes.sincronizar')"
            v-model:open="sincronizarAbierto"
            :plan="plan"
        />
    </PanelPagina>
</template>
