<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Usuarios del panel (`usuarios.ver`): roles y empresas de cada uno. "Empresas" asigna en qué
 * empresas (NIT) trabaja o le da alcance global (`usuarios.asignar_empresas`). Roles, permisos y
 * tokens de API siguen pendientes (tarea 9 del brief).
 */
definePageMeta({ permiso: 'usuarios.ver' })

useHead({ title: 'Usuarios · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { empresas: mias, nombre: nombreEmpresa } = useEmpresaActiva()

const usuarios = shallowRef<UsuarioPanel[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

/** Empresas que se pueden repartir: las activas del alcance de quien asigna. */
const repartibles = shallowRef<{ id: number, nombre_comercial: string, nit: string | null }[]>([])

const elegido = shallowRef<UsuarioPanel | null>(null)
const modalAbierto = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useUsuarios().listar()
    cargando.value = false
    usuarios.value = resultado.ok ? resultado.data.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

async function cargarEmpresas() {
    if (puede('empresas.ver')) {
        const resultado = await useEmpresas().listar(true)
        repartibles.value = resultado.ok ? resultado.data : mias.value
        return
    }
    repartibles.value = mias.value
}

onMounted(() => {
    void cargar()
    void cargarEmpresas()
})

function nombreDe(id: number): string {
    return repartibles.value.find(e => e.id === id)?.nombre_comercial ?? nombreEmpresa(id)
}

function abrir(usuario: UsuarioPanel) {
    elegido.value = usuario
    modalAbierto.value = true
}

function alGuardar(usuario: UsuarioPanel) {
    usuarios.value = usuarios.value.map(u => (u.id === usuario.id ? usuario : u))
    toast.add({ title: 'Empresas guardadas', description: usuario.nombre, color: 'success', icon: 'i-lucide-circle-check' })
}

const columnas: TableColumn<UsuarioPanel>[] = [
    { accessorKey: 'nombre', header: 'Usuario' },
    { id: 'roles', header: 'Roles', meta: SOLO_ANCHO },
    { id: 'empresas', header: 'Empresas' },
    { accessorKey: 'activo', header: 'Estado', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right' } } },
]
</script>

<template>
    <PanelPagina
        id="usuarios"
        titulo="Usuarios"
        icono="i-lucide-user-cog"
    >
        <div class="flex flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="usuarios"
                :columns="columnas"
                :loading="cargando"
                :ui="{ td: 'py-3' }"
                data-prueba="tabla-usuarios"
            >
                <template #nombre-cell="{ row }">
                    <div class="flex min-w-40 flex-col">
                        <span class="font-medium text-highlighted">{{ row.original.nombre }}</span>
                        <span class="truncate text-xs text-muted">{{ row.original.email }}</span>
                    </div>
                </template>
                <template #roles-cell="{ row }">
                    <div class="flex flex-wrap gap-1">
                        <UBadge
                            v-for="rol in row.original.roles"
                            :key="`${rol.role_id}-${rol.alcance_id}`"
                            :label="rol.rol"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                    </div>
                </template>
                <template #empresas-cell="{ row }">
                    <UBadge
                        v-if="row.original.alcance_global"
                        label="Todas (alcance global)"
                        icon="i-lucide-layers"
                        color="info"
                        variant="subtle"
                        size="sm"
                    />
                    <div
                        v-else
                        class="flex flex-wrap gap-1"
                        :data-prueba="`empresas-${row.original.id}`"
                    >
                        <UBadge
                            v-for="id in row.original.empresas ?? []"
                            :key="id"
                            :label="nombreDe(id)"
                            icon="i-lucide-building-2"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                    </div>
                </template>
                <template #activo-cell="{ row }">
                    <UBadge
                        :label="row.original.activo ? 'Activo' : 'Inactivo'"
                        :icon="row.original.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                        :color="row.original.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puede('usuarios.asignar_empresas')"
                        label="Asignar empresas"
                        icon="i-lucide-building-2"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :aria-label="`Asignar empresas a ${row.original.nombre}`"
                        @click="abrir(row.original)"
                    />
                </template>
            </UTable>
        </div>

        <UsuarioEmpresasModal
            v-if="elegido"
            v-model:open="modalAbierto"
            :usuario="elegido"
            :empresas="repartibles"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
