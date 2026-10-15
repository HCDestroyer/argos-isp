<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

definePageMeta({ permiso: 'clientes.editar' })

const route = useRoute()
const toast = useToast()

const clienteId = computed(() => Number(route.params.id))
const cliente = shallowRef<Cliente | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
/** Cambia al recargar tras un 409 para montar el formulario de nuevo con la versión actual. */
const generacion = ref(0)

useHead(() => ({ title: `Editar ${cliente.value?.nombre ?? 'cliente'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    const resultado = await useClientes().ver(clienteId.value)
    cargando.value = false
    if (resultado.ok) {
        cliente.value = resultado.data
        problema.value = null
        generacion.value++
    }
    else {
        problema.value = resultado.problema
    }
}

async function alGuardar(actualizado: Cliente) {
    toast.add({ title: 'Cambios guardados', description: actualizado.nombre, color: 'success', icon: 'i-lucide-circle-check' })
    await navigateTo(`/clientes/${actualizado.id}`)
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="cliente-editar"
        :titulo="cliente ? `Editar · ${cliente.nombre}` : 'Editar cliente'"
        icono="i-lucide-user-pen"
    >
        <div
            v-if="cargando && !cliente"
            class="flex max-w-3xl flex-col gap-4"
        >
            <USkeleton class="h-48 w-full" />
            <USkeleton class="h-32 w-full" />
        </div>

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
        />

        <ClienteFormulario
            v-else-if="cliente"
            :key="generacion"
            :cliente="cliente"
            @guardado="alGuardar"
            @cancelar="navigateTo(`/clientes/${clienteId}`)"
            @recargar="cargar"
        />
    </PanelPagina>
</template>
