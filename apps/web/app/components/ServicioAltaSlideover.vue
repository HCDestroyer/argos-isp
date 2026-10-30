<script setup lang="ts">
/**
 * Alta de un servicio sin salir de la ficha del cliente: el mismo formulario de `/servicios/nuevo`
 * en un panel lateral. Al crear, se cierra y avisa al padre para recargar sus servicios.
 */
defineProps<{
    cliente: Cliente
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    creado: [servicio: Servicio]
}>()

function alCrear(servicio: Servicio) {
    abierto.value = false
    emit('creado', servicio)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Nuevo servicio · ${cliente.nombre}`"
        description="Router, plan, red y PPPoE con valores sugeridos; revisa el resumen antes de crear."
        :ui="{ content: 'w-full sm:max-w-2xl' }"
    >
        <template #body>
            <ServicioAltaFormulario
                v-if="abierto"
                :cliente="cliente"
                compacto
                @creado="alCrear"
                @cancelar="abierto = false"
            />
        </template>
    </USlideover>
</template>
