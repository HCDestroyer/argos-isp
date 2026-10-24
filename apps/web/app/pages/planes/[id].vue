<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha de un plan (A1): tipo (residencial, empresarial o dedicado), velocidad y precio, edición
 * (`planes.editar`), los adicionales que trae (`GET/PUT /planes/:id/adicionales`) y su
 * implementación en cada router (`GET/PUT /planes/:id/routers`).
 */
definePageMeta({ permiso: 'planes.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const planId = computed(() => Number(route.params.id))
const plan = shallowRef<Plan | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const editando = ref(false)

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

function alGuardar(actualizado: Plan) {
    plan.value = actualizado
    toast.add({ title: `${actualizado.nombre} actualizado`, description: resumenVelocidadPlan(actualizado), icon: 'i-lucide-circle-check', color: 'success' })
}

watch(planId, () => void cargar())
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="plan"
        :titulo="plan?.nombre ?? 'Plan'"
        icono="i-lucide-gauge"
    >
        <template #acciones>
            <UButton
                v-if="plan && puede('planes.editar')"
                label="Editar"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                data-prueba="editar-plan"
                @click="editando = true"
            />
        </template>

        <div class="flex flex-col gap-6">
            <UButton
                to="/planes"
                label="Planes"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="link"
                class="self-start px-0"
            />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando && !plan"
                class="h-40 w-full"
            />

            <template v-else-if="plan">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            {{ plan.nombre }}
                        </h2>
                        <TipoPlanBadge
                            :tipo="plan.tipo"
                            data-prueba="tipo-plan"
                        />
                        <UBadge
                            v-if="!plan.activo"
                            label="Inactivo"
                            color="neutral"
                            variant="subtle"
                        />
                        <UBadge
                            v-if="!plan.global"
                            label="Por router"
                            color="neutral"
                            variant="outline"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        Plan #{{ plan.id }} · versión {{ plan.version }}
                    </p>
                </div>

                <UPageCard
                    title="Velocidad y precio"
                    icon="i-lucide-gauge"
                    variant="subtle"
                >
                    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                        <DatoFicha
                            etiqueta="Precio mensual"
                            :valor="formatearQuetzales(plan.precio)"
                        />
                        <DatoFicha
                            etiqueta="Bajada / subida"
                            :valor="`${formatearVelocidad(plan.bajada_kbps)} / ${formatearVelocidad(plan.subida_kbps)}`"
                        />
                        <DatoFicha
                            etiqueta="Limitado"
                            :valor="`${formatearVelocidad(plan.bajada_limitada_kbps)} / ${formatearVelocidad(plan.subida_limitada_kbps)}`"
                        />
                        <DatoFicha
                            etiqueta="Reuso · garantía · prioridad"
                            :valor="resumenVelocidadPlan(plan)"
                        />
                        <DatoFicha
                            etiqueta="Direcciones"
                            :valor="`${DUAL_STACK[plan.dual_stack]} · prefijo /${plan.tamano_prefijo_delegado}`"
                        />
                        <DatoFicha
                            etiqueta="Última modificación"
                            :valor="formatearFechaHora(plan.updated_at)"
                        />
                    </dl>
                </UPageCard>

                <PlanIncluidos
                    :plan="plan"
                    @actualizado="cargar"
                />

                <PlanRouters :plan="plan" />
            </template>
        </div>

        <PlanFormulario
            v-model:open="editando"
            :plan="plan"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
