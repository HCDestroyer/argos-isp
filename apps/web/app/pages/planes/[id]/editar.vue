<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Editar plan en su página (tablero RedPlanForm): `PUT /planes/:id` con `version`
 * (`planes.editar`); al guardar vuelve a la ficha del plan.
 */
definePageMeta({ permiso: 'planes.editar' })

const route = useRoute()
const toast = useToast()
const { puede, destinoPermitido } = usePermisos()

const planId = computed(() => Number(route.params.id))
const plan = shallowRef<Plan | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `Editar ${plan.value?.nombre ?? 'plan'} · ArgosIsp` }))

async function cargar() {
    // La página pide `planes.editar`; leer el plan pide además `planes.ver`.
    if (!puede('planes.ver')) {
        cargando.value = false
        problema.value = problemaSinPermiso('planes.ver')
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await usePlanes().ver(planId.value)
    cargando.value = false
    plan.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

function alGuardar(actualizado: Plan) {
    toast.add({ title: `${actualizado.nombre} actualizado`, description: resumenVelocidadPlan(actualizado), icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(destinoPermitido(`/planes/${actualizado.id}`))
}
</script>

<template>
    <PanelPagina
        id="plan-editar"
        :titulo="plan ? `Editar ${plan.nombre}` : 'Editar plan'"
        icono="i-lucide-gauge"
        encabezado-propio
    >
        <USkeleton
            v-if="cargando"
            class="h-96 w-full rounded-[1.375rem]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
        />
        <PlanFormulario
            v-else-if="plan"
            :plan="plan"
            @guardado="alGuardar"
            @cancelar="navigateTo(destinoPermitido(`/planes/${plan.id}`))"
        />
    </PanelPagina>
</template>
