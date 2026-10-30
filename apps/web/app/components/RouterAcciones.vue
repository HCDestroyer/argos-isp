<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Acciones de un router en un solo menú, cada una con su permiso: Editar (`routers.editar`), Probar
 * conexión (`routers.probar_conexion`), Reconciliar ahora (`routers.reconciliar`: vista previa y
 * después 202 con `encolado`, en `RouterReconciliarModal`), Conexión de la API, Control de velocidad y Script de conexión
 * (`routers.generar_script`). Con `conEditar`, «Editar» también va como botón a la vista (ficha).
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
    /** Se probó la conexión o se generó un script: la ficha recarga estado y conexión. */
    probado: []
}>()

const { puede } = usePermisos()

const editarAbierto = ref(false)
const conexionAbierta = ref(false)
const velocidadAbierta = ref(false)

const pruebaAbierta = ref(false)
const scriptAbierto = ref(false)
const reconciliarAbierto = ref(false)

const items = computed<DropdownMenuItem[][]>(() => [
    [
        ...(puede('routers.editar') ? [{ label: 'Editar', icon: 'i-lucide-pencil', onSelect: () => { editarAbierto.value = true } }] : []),
        ...(puede('routers.probar_conexion') ? [{ label: 'Probar conexión', icon: 'i-lucide-activity', description: 'Túnel, API, equipo y RADIUS', onSelect: () => { pruebaAbierta.value = true } }] : []),
        ...(puede('routers.reconciliar') ? [{ label: 'Reconciliar ahora', icon: 'i-lucide-refresh-cw', description: 'Ver qué corrige y corregirlo', onSelect: () => { reconciliarAbierto.value = true } }] : []),
    ],
    [
        { label: 'Conexión de la API', icon: 'i-lucide-plug', description: 'URL, puerto, TLS, DHCP e interfaz', onSelect: () => { conexionAbierta.value = true } },
        { label: 'Control de velocidad', icon: 'i-lucide-gauge', description: 'Capacidad y modo de colas', onSelect: () => { velocidadAbierta.value = true } },
        ...(puede('routers.generar_script') ? [{ label: 'Script de conexión', icon: 'i-lucide-file-code-2', description: 'Conectar el router por WireGuard', onSelect: () => { scriptAbierto.value = true } }] : []),
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
        <RouterPruebaConexionModal
            v-if="puede('routers.probar_conexion')"
            v-model:open="pruebaAbierta"
            :router="props.router"
            @probado="emit('probado')"
        />
        <RouterReconciliarModal
            v-if="puede('routers.reconciliar')"
            v-model:open="reconciliarAbierto"
            :router="props.router"
        />
        <RouterScriptModal
            v-if="puede('routers.generar_script')"
            v-model:open="scriptAbierto"
            :router="props.router"
            @generado="emit('probado')"
        />
    </div>
</template>
