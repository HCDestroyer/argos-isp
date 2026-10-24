<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Roles y permisos (A1, tarea 9): los roles con sus permisos, alta (`roles.crear`) y edición
 * (`roles.editar`); y el catálogo de permisos (`GET /permisos`) con qué roles tiene cada uno.
 * El alcance por router, zona o caja se da al asignar un rol a un usuario.
 */
definePageMeta({ permiso: 'roles.ver' })

useHead({ title: 'Roles y permisos · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const roles = shallowRef<Rol[]>([])
const catalogo = shallowRef<PermisoCatalogo[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const [listaRoles, listaPermisos] = await Promise.all([useRoles().listar(), useCatalogoPermisos().listar()])
    cargando.value = false
    roles.value = listaRoles.ok ? listaRoles.data : []
    catalogo.value = listaPermisos.ok ? listaPermisos.data : []
    problema.value = !listaRoles.ok ? listaRoles.problema : !listaPermisos.ok ? listaPermisos.problema : null
}

onMounted(cargar)

const editando = shallowRef<Rol | null>(null)
const formularioAbierto = ref(false)

function abrir(rol: Rol | null) {
    editando.value = rol
    formularioAbierto.value = true
}

function alGuardar(rol: Rol) {
    toast.add({ title: editando.value ? `Rol ${rol.nombre} actualizado` : `Rol ${rol.nombre} creado`, description: `${rol.permisos.length} permisos`, icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
}

const columnasRoles: TableColumn<Rol>[] = [
    { accessorKey: 'nombre', header: 'Rol', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'permisos', header: 'Permisos', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

/* Catálogo: cada permiso con los roles que lo tienen. */
const filtro = ref('')
interface FilaPermiso { nombre: string, descripcion: string | null, modulo: string, roles: string[] }
const filasPermisos = computed<FilaPermiso[]>(() => {
    const texto = filtro.value.trim().toLowerCase()
    return catalogo.value
        .map(p => ({
            nombre: p.nombre,
            descripcion: p.descripcion,
            modulo: etiquetaModulo(p.nombre.split('.')[0] ?? ''),
            roles: roles.value.filter(r => r.permisos.includes(p.nombre)).map(r => r.nombre),
        }))
        .filter(p => !texto || `${p.nombre} ${p.descripcion ?? ''} ${p.modulo} ${p.roles.join(' ')}`.toLowerCase().includes(texto))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
})
const columnasPermisos: TableColumn<FilaPermiso>[] = [
    { accessorKey: 'nombre', header: 'Permiso', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'roles', header: 'Roles', meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell whitespace-normal' } } },
]
</script>

<template>
    <PanelPagina
        id="roles"
        titulo="Roles y permisos"
        icono="i-lucide-shield"
    >
        <template #acciones>
            <UButton
                v-if="puede('roles.crear')"
                label="Nuevo rol"
                icon="i-lucide-plus"
                :disabled="!catalogo.length"
                data-prueba="nuevo-rol"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-6">
            <UsuariosNavegacion />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else>
                <section class="flex flex-col gap-3">
                    <p class="text-sm text-muted">
                        Un rol agrupa permisos; un usuario puede tener varios, cada uno con alcance a un router, una zona o una caja. Los roles base vienen con ArgosIsp y sus permisos no se cambian aquí.
                    </p>
                    <UTable
                        :data="roles"
                        :columns="columnasRoles"
                        :loading="cargando"
                        :ui="{ td: 'py-3' }"
                        data-prueba="tabla-roles"
                    >
                        <template #nombre-cell="{ row }">
                            <div
                                class="flex min-w-0 flex-col gap-0.5"
                                :data-rol="row.original.nombre"
                            >
                                <span class="flex flex-wrap items-center gap-1.5">
                                    <span class="font-mono text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                                    <UBadge
                                        v-if="row.original.base"
                                        label="Base"
                                        icon="i-lucide-lock"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                    />
                                </span>
                                <span
                                    v-if="row.original.descripcion"
                                    class="text-xs text-muted"
                                >{{ row.original.descripcion }}</span>
                            </div>
                        </template>
                        <template #permisos-cell="{ row }">
                            <span class="tabular-nums text-sm">{{ row.original.permisos.length }}</span>
                        </template>
                        <template #acciones-cell="{ row }">
                            <UButton
                                :icon="puede('roles.editar') ? 'i-lucide-pencil' : 'i-lucide-eye'"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`${puede('roles.editar') ? 'Editar' : 'Ver'} el rol ${row.original.nombre}`"
                                :data-prueba="`editar-rol-${row.original.nombre}`"
                                @click="abrir(row.original)"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-shield"
                                title="No hay roles"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </section>

                <section
                    class="flex flex-col gap-3"
                    data-prueba="catalogo-permisos"
                >
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h2 class="text-base font-semibold text-highlighted">
                            Catálogo de permisos
                        </h2>
                        <UInput
                            v-model="filtro"
                            icon="i-lucide-search"
                            placeholder="Permiso, módulo o rol"
                            aria-label="Buscar en el catálogo de permisos"
                            class="w-full sm:w-72"
                            data-prueba="buscar-permiso"
                        />
                    </div>
                    <UTable
                        :data="filasPermisos"
                        :columns="columnasPermisos"
                        :loading="cargando"
                        :ui="{ td: 'py-2' }"
                        class="max-h-[32rem]"
                        sticky
                    >
                        <template #nombre-cell="{ row }">
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <span class="font-mono text-xs text-highlighted">{{ row.original.nombre }}</span>
                                <span class="text-xs text-muted">{{ row.original.modulo }}<template v-if="row.original.descripcion"> · {{ row.original.descripcion }}</template></span>
                                <span class="text-xs text-muted md:hidden">{{ row.original.roles.join(', ') || 'Ningún rol' }}</span>
                            </div>
                        </template>
                        <template #roles-cell="{ row }">
                            <div class="flex flex-wrap gap-1">
                                <UBadge
                                    v-for="nombre in row.original.roles"
                                    :key="nombre"
                                    :label="nombre"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span
                                    v-if="!row.original.roles.length"
                                    class="text-xs text-dimmed"
                                >Ningún rol</span>
                            </div>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-search-x"
                                :title="filtro ? `Ningún permiso coincide con «${filtro}»` : 'El catálogo está vacío'"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </section>
            </template>
        </div>

        <RolFormulario
            v-model:open="formularioAbierto"
            :rol="editando"
            :catalogo="catalogo"
            :solo-lectura="editando !== null && !puede('roles.editar')"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
