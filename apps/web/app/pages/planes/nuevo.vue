<script setup lang="ts">
/**
 * Nuevo plan en su página (tablero RedPlanForm; antes era un panel lateral). Al crear, va a la
 * ficha del plan para elegir dónde se ofrece si no es para todos los routers.
 */
definePageMeta({ permiso: 'planes.crear' })

useHead({ title: 'Nuevo plan · ArgosIsp' })

const toast = useToast()

function alGuardar(plan: Plan) {
    toast.add({ title: `${plan.nombre} creado`, description: resumenVelocidadPlan(plan), icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(`/planes/${plan.id}`)
}
</script>

<template>
    <PanelPagina
        id="plan-nuevo"
        titulo="Nuevo plan"
        icono="i-lucide-gauge"
        encabezado-propio
    >
        <PlanFormulario
            @guardado="alGuardar"
            @cancelar="navigateTo('/planes')"
        />
    </PanelPagina>
</template>
