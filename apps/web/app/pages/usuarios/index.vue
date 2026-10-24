<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Usuarios del panel (`usuarios.ver`, tarea 9): alta (`usuarios.crear`), edición con roles y su
 * alcance (`usuarios.editar`), desactivar y reactivar (`PUT` con `activo`, `usuarios.editar`) y
 * empresas que opera (`usuarios.asignar_empresas`). Roles y permisos, y tokens de API, en sus
 * pantallas (`UsuariosNavegacion`).
 */
definePageMeta({ permiso: 'usuarios.ver' })

useHead({ title: 'Usuarios · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const usuarioActual = useUsuarioActual()
const { empresas: mias, nombre: nombreEmpresa } = useEmpresaActiva()

const lista = usePaginacionCursor(cursor => useUsuarios().listar(cursor))

/** Empresas que se pueden repartir: las activas del alcance de quien asigna. */
const repartibles = shallowRef<{ id: number, nombre_comercial: string, nit: string | null }[]>([])

async function cargarEmpresas() {
    if (puede('empresas.ver')) {
        const resultado = await useEmpresas().listar(true)
        repartibles.value = resultado.ok ? resultado.data : mias.value
        return
    }
    repartibles.value = mias.value
}

onMounted(() => {
    void lista.recargar()
    void cargarEmpresas()
})

function nombreDe(id: number): string {
    return repartibles.value.find(e => e.id === id)?.nombre_comercial ?? nombreEmpresa(id)
}

/* Empresas */
const elegido = shallowRef<UsuarioPanel | null>(null)
const empresasAbierto = ref(false)

function abrirEmpresas(usuario: UsuarioPanel) {
    elegido.value = usuario
    empresasAbierto.value = true
}

function alGuardarEmpresas(usuario: UsuarioPanel) {
    reemplazar(usuario)
    toast.add({ title: 'Empresas guardadas', description: usuario.nombre, color: 'success', icon: 'i-lucide-circle-check' })
}

function reemplazar(usuario: UsuarioPanel) {
    lista.filas.value = lista.filas.value.map(u => (u.id === usuario.id ? usuario : u))
}

/* Alta y edición */
const editando = shallowRef<UsuarioPanel | null>(null)
const formularioAbierto = ref(false)

function abrir(usuario: UsuarioPanel | null) {
    editando.value = usuario
    formularioAbierto.value = true
}

function alGuardar(usuario: UsuarioPanel) {
    toast.add({ title: editando.value ? `${usuario.nombre} actualizado` : `${usuario.nombre} creado`, description: usuario.roles.map(r => r.rol).join(', ') || 'Sin roles', color: 'success', icon: 'i-lucide-circle-check' })
    if (editando.value) {
        reemplazar(usuario)
        return
    }
    void lista.recargar()
}

/* Desactivar / reactivar */
const cambiandoActivo = shallowRef<UsuarioPanel | null>(null)
const activoAbierto = ref(false)

function pedirCambioActivo(usuario: UsuarioPanel) {
    cambiandoActivo.value = usuario
    activoAbierto.value = true
}

function cambiarActivo(): Promise<Resultado<UsuarioPanel>> {
    const usuario = cambiandoActivo.value
    if (!usuario) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un usuario', status: 400 } })
    }
    return useUsuarios().editar(usuario.id, { version: usuario.version, activo: !usuario.activo })
}

function alCambiarActivo(usuario: UsuarioPanel) {
    reemplazar(usuario)
    toast.add({ title: usuario.activo ? `${usuario.nombre} reactivado` : `${usuario.nombre} desactivado`, color: 'success', icon: 'i-lucide-circle-check' })
}

function esYo(usuario: UsuarioPanel): boolean {
    return usuarioActual.value?.id === usuario.id
}

const columnas: TableColumn<UsuarioPanel>[] = [
    { accessorKey: 'nombre', header: 'Usuario' },
    { id: 'roles', header: 'Roles', meta: SOLO_ANCHO },
    { id: 'empresas', header: 'Empresas', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activo', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right' } } },
]

function etiquetaRol(rol: AsignacionRol): string {
    return rol.alcance_tipo ? `${rol.rol} · ${ALCANCES_ROL[rol.alcance_tipo].etiqueta.toLowerCase()} ${rol.alcance_id}` : rol.rol
}
</script>

<template>
    <PanelPagina
        id="usuarios"
        titulo="Usuarios"
        icono="i-lucide-user-cog"
    >
        <template #acciones>
            <UButton
                v-if="puede('usuarios.crear')"
                label="Nuevo usuario"
                icon="i-lucide-user-plus"
                data-prueba="nuevo-usuario"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <UsuariosNavegacion />

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-usuarios"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-40 flex-col"
                            :data-usuario="row.original.id"
                        >
                            <span class="font-medium text-highlighted">{{ row.original.nombre }}<span
                                v-if="esYo(row.original)"
                                class="font-normal text-muted"
                            > (tú)</span></span>
                            <span class="truncate text-xs text-muted">{{ row.original.email }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ row.original.roles.map(etiquetaRol).join(', ') }}<template v-if="!row.original.activo"> · Inactivo</template></span>
                        </div>
                    </template>
                    <template #roles-cell="{ row }">
                        <div class="flex flex-wrap gap-1">
                            <UBadge
                                v-for="rol in row.original.roles"
                                :key="`${rol.role_id}-${rol.alcance_tipo}-${rol.alcance_id}`"
                                :label="etiquetaRol(rol)"
                                :icon="rol.alcance_tipo ? ALCANCES_ROL[rol.alcance_tipo].icono : undefined"
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
                            :data-prueba="`estado-usuario-${row.original.id}`"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex flex-wrap justify-end gap-1">
                            <UButton
                                v-if="puede('usuarios.asignar_empresas')"
                                icon="i-lucide-building-2"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Asignar empresas a ${row.original.nombre}`"
                                @click="abrirEmpresas(row.original)"
                            />
                            <UButton
                                v-if="puede('usuarios.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar ${row.original.nombre}`"
                                :data-prueba="`editar-usuario-${row.original.id}`"
                                @click="abrir(row.original)"
                            />
                            <UButton
                                v-if="puede('usuarios.editar') && !esYo(row.original)"
                                :icon="row.original.activo ? 'i-lucide-user-x' : 'i-lucide-user-check'"
                                :color="row.original.activo ? 'error' : 'neutral'"
                                variant="ghost"
                                size="sm"
                                :aria-label="`${row.original.activo ? 'Desactivar' : 'Reactivar'} a ${row.original.nombre}`"
                                :data-prueba="`activo-usuario-${row.original.id}`"
                                @click="pedirCambioActivo(row.original)"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-users"
                            title="No hay usuarios"
                            variant="naked"
                        />
                    </template>
                </UTable>

                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <UsuarioEmpresasModal
            v-if="elegido"
            v-model:open="empresasAbierto"
            :usuario="elegido"
            :empresas="repartibles"
            @guardado="alGuardarEmpresas"
        />
        <UsuarioFormulario
            v-model:open="formularioAbierto"
            :usuario="editando"
            @guardado="alGuardar"
        />
        <ConfirmacionModal
            v-model:open="activoAbierto"
            :titulo="cambiandoActivo?.activo ? `Desactivar a ${cambiandoActivo?.nombre ?? ''}` : `Reactivar a ${cambiandoActivo?.nombre ?? ''}`"
            :efecto="cambiandoActivo?.activo ? 'No podrá entrar al panel y sus tokens de API dejan de funcionar. Su historial en la bitácora se conserva.' : 'Podrá volver a entrar con su contraseña y sus roles actuales.'"
            :confirmar="cambiandoActivo?.activo ? 'Desactivar' : 'Reactivar'"
            :icono="cambiandoActivo?.activo ? 'i-lucide-user-x' : 'i-lucide-user-check'"
            :color="cambiandoActivo?.activo ? 'error' : 'primary'"
            :ejecutar="cambiarActivo"
            @hecho="alCambiarActivo"
        />
    </PanelPagina>
</template>
