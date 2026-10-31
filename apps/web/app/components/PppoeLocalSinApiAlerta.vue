<script setup lang="ts">
/**
 * PPPoE sin RADIUS en un router sin credenciales de la API (`contratos/pppoe-local.md` §9): la API
 * responde 422 `pppoe_local_requiere_api` porque no hay cómo crear el secret. Se muestra antes de
 * enviar (el router leído no las tiene) y al recibir el 422, con el enlace a la ficha del router.
 */
const props = withDefaults(defineProps<{
    /** Router del servicio, para el enlace a su ficha (con `routers.ver`). */
    routerId?: number | null
    /** `detail` del 422, si llegó de la API. */
    detalle?: string | null
}>(), {
    routerId: null,
    detalle: null,
})

const { puede } = usePermisos()

const acciones = computed(() => (props.routerId && puede('routers.ver')
    ? [{
            label: 'Abrir la ficha del router',
            icon: 'i-lucide-router',
            color: 'warning' as const,
            variant: 'outline' as const,
            to: `/routers/${props.routerId}`,
        }]
    : undefined))
</script>

<template>
    <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-key-round"
        :title="MENSAJE_PPPOE_LOCAL_REQUIERE_API"
        :description="detalle ?? 'Sin usuario y contraseña de la API, Argos no puede crear el secret PPPoE en el MikroTik. Agrégalos en el router o elige otro tipo de conexión.'"
        :actions="acciones"
        data-prueba="pppoe-local-requiere-api"
    />
</template>
