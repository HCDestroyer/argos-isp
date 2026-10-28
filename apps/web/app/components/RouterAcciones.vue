<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Acciones de un router en un solo menú: Editar, Probar conexión, Reconciliar, Conexión de la API,
 * Control de velocidad y Script de conexión. Las que todavía no están disponibles se ven
 * deshabilitadas. Con `conEditar`, «Editar» también va como botón a la vista (ficha del router).
 */
const props = withDefaults(defineProps<{
    router: RouterNas
    conEditar?: boolean
    tamano?: 'xs' | 'sm' | 'md'
}>(), {
    conEditar: false,
    tamano: 'md',
})

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const { puede } = usePermisos()

const editarAbierto = ref(false)
const conexionAbierta = ref(false)
const velocidadAbierta = ref(false)

const NO_DISPONIBLE = 'No disponible por ahora'

const items = computed<DropdownMenuItem[][]>(() => [
    [
        ...(puede('routers.editar') ? [{ label: 'Editar', icon: 'i-lucide-pencil', onSelect: () => { editarAbierto.value = true } }] : []),
        { label: 'Probar conexión', icon: 'i-lucide-activity', description: NO_DISPONIBLE, disabled: true },
        { label: 'Reconciliar ahora', icon: 'i-lucide-refresh-cw', description: NO_DISPONIBLE, disabled: true },
    ],
    [
        { label: 'Conexión de la API', icon: 'i-lucide-plug', description: 'URL, puerto, TLS, DHCP e interfaz', onSelect: () => { conexionAbierta.value = true } },
        { label: 'Control de velocidad', icon: 'i-lucide-gauge', description: 'Capacidad y modo de colas', onSelect: () => { velocidadAbierta.value = true } },
        { label: 'Script de conexión', icon: 'i-lucide-file-code-2', description: NO_DISPONIBLE, disabled: true },
    ],
])

function alActualizar(router: RouterNas) {
    emit('actualizado', router)
}
</script>

<template>
    <div class="flex items-center justify-end gap-2">
        <UButton
            v-if="conEditar && puede('routers.editar')"
            label="Editar"
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            :size="tamano"
            :ui="{ label: 'hidden sm:inline' }"
            :aria-label="`Editar ${router.nombre}`"
            data-prueba="editar-router"
            @click="editarAbierto = true"
        />
        <UDropdownMenu
            :items="items"
            :content="{ align: 'end' }"
        >
            <UButton
                label="Acciones"
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="outline"
                :size="tamano"
                :ui="{ label: 'hidden sm:inline' }"
                :aria-label="`Acciones de ${router.nombre}`"
                :data-prueba="`acciones-router-${router.id}`"
            />
        </UDropdownMenu>

        <RouterEditarModal
            v-if="puede('routers.editar')"
            v-model:open="editarAbierto"
            :router="props.router"
            @actualizado="alActualizar"
        />
        <RouterConexion
            v-model:open="conexionAbierta"
            :router="props.router"
            @actualizado="alActualizar"
        />
        <RouterVelocidad
            v-model:open="velocidadAbierta"
            :router="props.router"
            @actualizado="alActualizar"
        />
    </div>
</template>
