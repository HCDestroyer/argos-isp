<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Alta (sin `cliente`) o edición de un cliente en un panel lateral, con el mismo formulario de
 * `/clientes/nuevo` y `/clientes/:id/editar`. Tras un 409 carga la versión actual y vuelve a montar
 * el formulario.
 */
const props = withDefaults(defineProps<{
    cliente?: Cliente | null
}>(), {
    cliente: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [cliente: Cliente]
}>()

const actual = shallowRef<Cliente | null>(props.cliente)
const generacion = ref(0)
const recargando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        actual.value = props.cliente
        problema.value = null
        generacion.value++
    }
})

async function recargar() {
    if (!actual.value) {
        return
    }
    recargando.value = true
    const resultado = await useClientes().ver(actual.value.id)
    recargando.value = false
    if (resultado.ok) {
        actual.value = resultado.data
        problema.value = null
        generacion.value++
    }
    else {
        problema.value = resultado.problema
    }
}

function alGuardar(cliente: Cliente) {
    abierto.value = false
    emit('guardado', cliente)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="cliente ? `Editar · ${cliente.nombre}` : 'Nuevo cliente'"
        :description="cliente ? 'Los cambios quedan en la bitácora del cliente.' : 'Solo el nombre es obligatorio; lo demás se puede completar después.'"
        :ui="{ content: 'w-full sm:max-w-2xl' }"
    >
        <template #body>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="recargar"
                :reintentando="recargando"
            />
            <ClienteFormulario
                v-else-if="abierto"
                :key="generacion"
                :cliente="actual"
                @guardado="alGuardar"
                @cancelar="abierto = false"
                @recargar="recargar"
            />
        </template>
    </USlideover>
</template>
