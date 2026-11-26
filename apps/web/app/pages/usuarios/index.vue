<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Usuarios del panel (tablero OperUsuarios, `usuarios.ver`): pestañas Activos y Desactivados con
 * buscador y filtro por rol; a la derecha la persona abierta con sus roles y alcance, empresas, lo
 * último que hizo (bitácora) y sus acciones. Alta (`usuarios.crear`), edición y contraseña
 * (`usuarios.editar`, panel lateral), desactivar o reactivar y empresas que opera
 * (`usuarios.asignar_empresas`). Roles y permisos, y tokens de API, en sus pantallas.
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
    detalleMovil.value = false
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
    detalleMovil.value = false
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
    detalleMovil.value = false
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
    { id: 'roles', header: 'Rol', meta: SOLO_ANCHO },
    { id: 'alcance', header: 'Alcance', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activo', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'w-0 text-right', th: 'w-0' } } },
]

/* Pestañas, buscador y rol: la API da hasta 200 usuarios por página; se filtra aquí. */
const pestana = ref<'activos' | 'desactivados'>('activos')
const busqueda = ref('')
const TODOS = 'todos'
const rolFiltro = ref(TODOS)
const cuantos = computed(() => ({
    activos: lista.filas.value.filter(u => u.activo).length,
    desactivados: lista.filas.value.filter(u => !u.activo).length,
}))
const pestanas = computed<TabsItem[]>(() => [
    { label: 'Activos', value: 'activos', badge: lista.cargando.value ? undefined : cuantos.value.activos },
    { label: 'Desactivados', value: 'desactivados', badge: lista.cargando.value ? undefined : cuantos.value.desactivados },
])
const itemsRol = computed<SelectItem[]>(() => [
    { label: 'Rol: todos', value: TODOS },
    ...[...new Set(lista.filas.value.flatMap(u => u.roles.map(r => r.rol)))].sort().map(rol => ({ label: rol, value: rol })),
])
const visibles = computed(() => {
    const texto = busqueda.value.trim().toLocaleLowerCase('es')
    return lista.filas.value.filter(u => (pestana.value === 'activos' ? u.activo : !u.activo)
        && (rolFiltro.value === TODOS || u.roles.some(r => r.rol === rolFiltro.value))
        && (!texto || u.nombre.toLocaleLowerCase('es').includes(texto) || u.email.toLocaleLowerCase('es').includes(texto)))
})

/* Persona abierta a la derecha (en el teléfono, panel a pantalla completa). */
const abiertoId = ref(0)
const detalleMovil = ref(false)
const abierto = computed(() => lista.filas.value.find(u => u.id === abiertoId.value) ?? null)
const metaTabla = metaFilaElegida<UsuarioPanel>(fila => fila.id === abiertoId.value)

function verUsuario(usuario: UsuarioPanel) {
    abiertoId.value = usuario.id
    detalleMovil.value = !esEscritorio()
}

watch(visibles, (filas) => {
    if (esEscritorio() && !filas.some(u => u.id === abiertoId.value)) {
        abiertoId.value = filas[0]?.id ?? 0
    }
})

/** Lo último que hizo (`GET /bitacora/acciones?actor_id=`, `bitacora.ver`). */
const ultimas = shallowRef<AccionAuditoria[] | null>(null)
const problemaUltimas = ref<Problem | null>(null)

async function cargarUltimas() {
    ultimas.value = null
    problemaUltimas.value = null
    if (!abiertoId.value || !puede('bitacora.ver')) {
        return
    }
    const resultado = await useBitacora().acciones({ actor_id: abiertoId.value, limit: 3 })
    ultimas.value = resultado.ok ? resultado.data.data : null
    problemaUltimas.value = resultado.ok ? null : resultado.problema
}

watch(abiertoId, cargarUltimas)

function textoAlcance(rol: AsignacionRol): string {
    return rol.alcance_tipo ? `${ALCANCES_ROL[rol.alcance_tipo].etiqueta} ${rol.alcance_id}` : 'Toda la empresa'
}

function alcanceUsuario(usuario: UsuarioPanel): string {
    const alcances = [...new Set(usuario.roles.map(textoAlcance))]
    const base = alcances.length ? alcances.join(' · ') : '—'
    if (usuario.alcance_global) {
        return `${base} · todas las empresas`
    }
    const empresas = usuario.empresas?.length ?? 0
    return empresas > 1 ? `${base} · ${empresas} empresas` : base
}

function accionesUsuario(usuario: UsuarioPanel): AccionFila[] {
    const acciones: AccionFila[] = [
        { etiqueta: 'Ver', icono: ICONOS.ver, alElegir: () => verUsuario(usuario), soloMenu: true, grupo: 'Ver' },
    ]
    if (puede('bitacora.ver')) {
        acciones.push({ etiqueta: 'Su bitácora', icono: 'i-lucide-scroll-text', to: `/bitacora?actor=${usuario.id}`, soloMenu: true, grupo: 'Ver' })
    }
    if (puede('usuarios.editar')) {
        acciones.push({ etiqueta: 'Editar', icono: ICONOS.editar, alElegir: () => abrir(usuario), soloMenu: true, grupo: 'Cambiar' })
    }
    if (puede('usuarios.asignar_empresas')) {
        acciones.push({ etiqueta: 'Empresas que opera', icono: 'i-lucide-building-2', alElegir: () => abrirEmpresas(usuario), soloMenu: true, grupo: 'Cambiar' })
    }
    if (puede('usuarios.editar') && !esYo(usuario)) {
        acciones.push({ etiqueta: usuario.activo ? 'Desactivar' : 'Reactivar', icono: usuario.activo ? 'i-lucide-user-x' : 'i-lucide-user-check', alElegir: () => pedirCambioActivo(usuario), soloMenu: true, color: usuario.activo ? 'error' : undefined })
    }
    return acciones
}

const menuFila = useMenuFila(accionesUsuario)
</script>

<template>
    <PanelPagina
        id="usuarios"
        titulo="Usuarios"
        icono="i-lucide-user-cog"
        descripcion="Las personas que entran al panel, con su rol y hasta dónde llega"
    >
        <template #acciones>
            <UButton
                v-if="puede('roles.ver')"
                to="/usuarios/roles"
                label="Roles y permisos"
                icon="i-lucide-shield"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
            />
            <UButton
                v-if="puede('tokens.ver')"
                to="/usuarios/tokens"
                label="Tokens de API"
                icon="i-lucide-key-round"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
            />
        </template>

        <template #accion-principal>
            <UButton
                v-if="puede('usuarios.crear')"
                label="Nuevo usuario"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand px-5"
                data-prueba="nuevo-usuario"
                @click="abrir(null)"
            />
        </template>

        <div class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]">
                <div class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4">
                    <OperPestanas
                        v-model="pestana"
                        :items="pestanas"
                        etiqueta="Usuarios por estado"
                    />
                    <div class="flex flex-wrap items-center gap-2">
                        <UInput
                            v-model="busqueda"
                            icon="i-lucide-search"
                            placeholder="Nombre o correo…"
                            aria-label="Buscar usuarios por nombre o correo"
                            class="w-full min-w-0 sm:flex-1"
                        />
                        <USelect
                            v-model="rolFiltro"
                            :items="itemsRol"
                            icon="i-lucide-shield"
                            aria-label="Filtrar por rol"
                            class="w-full sm:w-44"
                        />
                    </div>
                </div>

                <div
                    v-if="lista.problema.value"
                    class="p-4"
                >
                    <ProblemaAlerta
                        :problema="lista.problema.value"
                        :reintentar="lista.recargar"
                        :reintentando="lista.cargando.value"
                    />
                </div>
                <template v-else>
                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <UContextMenu :items="menuFila.items.value">
                            <UTable
                                :data="visibles"
                                :columns="columnas"
                                :loading="lista.cargando.value"
                                :meta="metaTabla"
                                sticky
                                :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3' }"
                                data-prueba="tabla-usuarios"
                                data-menu-contextual
                                @select="(_evento, fila) => verUsuario(fila.original)"
                                @contextmenu="menuFila.alContextmenu"
                            >
                                <template #nombre-cell="{ row }">
                                    <div
                                        class="flex min-w-44 items-center gap-3"
                                        :data-usuario="row.original.id"
                                    >
                                        <AvatarIniciales :nombre="row.original.nombre" />
                                        <div class="flex min-w-0 flex-col">
                                            <span class="font-semibold text-highlighted">{{ row.original.nombre }}<span
                                                v-if="esYo(row.original)"
                                                class="font-normal text-muted"
                                            > (tú)</span></span>
                                            <span class="truncate text-xs text-muted">{{ row.original.email }}</span>
                                            <span class="text-xs text-muted capitalize sm:hidden">{{ row.original.roles.map(r => r.rol).join(' · ') }}</span>
                                        </div>
                                    </div>
                                </template>
                                <template #roles-cell="{ row }">
                                    <span class="text-sm capitalize">{{ row.original.roles.map(r => r.rol).join(' · ') || 'Sin roles' }}</span>
                                </template>
                                <template #alcance-cell="{ row }">
                                    <span
                                        class="block max-w-56 truncate text-sm text-muted"
                                        :data-prueba="`empresas-${row.original.id}`"
                                    >{{ alcanceUsuario(row.original) }}</span>
                                </template>
                                <template #activo-cell="{ row }">
                                    <UBadge
                                        :label="row.original.activo ? 'Activo' : 'Desactivado'"
                                        :icon="row.original.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                                        :color="row.original.activo ? 'success' : 'neutral'"
                                        variant="subtle"
                                        size="sm"
                                        :data-prueba="`estado-usuario-${row.original.id}`"
                                    />
                                </template>
                                <template #acciones-cell="{ row }">
                                    <UDropdownMenu
                                        :items="menuFila.itemsDe(row.original)"
                                        :content="{ align: 'end' }"
                                    >
                                        <UButton
                                            icon="i-lucide-ellipsis"
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            :aria-label="`Más acciones: ${row.original.nombre}`"
                                            @click.stop
                                        />
                                    </UDropdownMenu>
                                </template>
                                <template #empty>
                                    <UEmpty
                                        icon="i-lucide-users"
                                        :title="busqueda || rolFiltro !== TODOS ? 'Ningún usuario coincide' : pestana === 'activos' ? 'No hay usuarios activos' : 'No hay usuarios desactivados'"
                                        variant="naked"
                                    />
                                </template>
                            </UTable>
                        </UContextMenu>
                    </div>
                    <div
                        v-if="lista.hayAnterior.value || lista.haySiguiente.value"
                        class="border-t border-(--ax-borde) px-4 py-2"
                    >
                        <PaginacionCursor
                            :pagina="lista.pagina.value"
                            :hay-anterior="lista.hayAnterior.value"
                            :hay-siguiente="lista.haySiguiente.value"
                            :cargando="lista.cargando.value"
                            :filas="lista.filas.value.length"
                            @anterior="lista.anterior"
                            @siguiente="lista.siguiente"
                        />
                    </div>
                </template>
            </section>

            <UsuarioDetalle
                v-if="abierto"
                :usuario="abierto"
                :nombre-empresa="nombreDe"
                :ultimas="ultimas"
                :problema-ultimas="problemaUltimas"
                :es-yo="esYo(abierto)"
                class="hidden lg:flex lg:max-h-[calc(100dvh-11rem)]"
                @editar="abrir"
                @activo="pedirCambioActivo"
                @empresas="abrirEmpresas"
                @reintentar="cargarUltimas"
            />
            <div
                v-else
                class="surface-card hidden items-center justify-center rounded-[1.375rem] p-6 lg:flex"
            >
                <UEmpty
                    icon="i-lucide-mouse-pointer-click"
                    title="Elige una persona"
                    description="Aquí ves sus roles, empresas y lo último que hizo."
                    variant="naked"
                />
            </div>
        </div>

        <USlideover
            v-model:open="detalleMovil"
            :title="abierto?.nombre ?? 'Usuario'"
            :description="abierto?.email"
            :ui="{ body: 'p-0 sm:p-0' }"
        >
            <template #body>
                <UsuarioDetalle
                    v-if="abierto"
                    :usuario="abierto"
                    :nombre-empresa="nombreDe"
                    :ultimas="ultimas"
                    :problema-ultimas="problemaUltimas"
                    :es-yo="esYo(abierto)"
                    sin-encabezado
                    class="h-full rounded-none border-0 shadow-none"
                    @editar="abrir"
                    @activo="pedirCambioActivo"
                    @empresas="abrirEmpresas"
                    @reintentar="cargarUltimas"
                />
            </template>
        </USlideover>

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
