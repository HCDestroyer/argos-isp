<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem } from '@nuxt/ui'

/**
 * Roles y permisos (tablero OperRoles): a la izquierda los roles; en medio los permisos del rol
 * abierto agrupados por módulo, con interruptores, el nombre técnico debajo, búsqueda y «Todos» por
 * grupo (`PUT /roles/:id`, `roles.editar`, con `version`); a la derecha el alcance: dónde vale el rol
 * para cada persona que lo tiene. Los roles base definen sus permisos en código: se ven, no se
 * cambian. «Nuevo rol» y «Duplicar rol» abren el formulario en un panel lateral (`roles.crear`).
 */
definePageMeta({ permiso: 'roles.ver' })

useHead({ title: 'Roles y permisos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const toast = useToast()

const roles = shallowRef<Rol[]>([])
const catalogo = shallowRef<PermisoCatalogo[]>([])
const usuarios = shallowRef<UsuarioPanel[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const rolId = ref(Number(route.query.rol) || 0)
const rol = computed(() => roles.value.find(r => r.id === rolId.value) ?? null)

async function cargar() {
    cargando.value = true
    const [listaRoles, listaPermisos, listaUsuarios] = await Promise.all([
        useRoles().listar(),
        useCatalogoPermisos().listar(),
        puede('usuarios.ver') ? useUsuarios().listar() : Promise.resolve(null),
    ])
    cargando.value = false
    roles.value = listaRoles.ok ? listaRoles.data : []
    catalogo.value = listaPermisos.ok ? listaPermisos.data : []
    usuarios.value = listaUsuarios?.ok ? listaUsuarios.data.data : []
    problema.value = !listaRoles.ok ? listaRoles.problema : !listaPermisos.ok ? listaPermisos.problema : null
    if (!rol.value) {
        rolId.value = roles.value[0]?.id ?? 0
    }
}

onMounted(cargar)

/* Personas por rol (con `usuarios.ver`). */
function usuariosDe(nombre: string): UsuarioPanel[] {
    return usuarios.value.filter(u => u.roles.some(r => r.rol === nombre))
}

function resumenRol(r: Rol): string {
    const partes = [r.descripcion?.split('.')[0] ?? null]
    if (puede('usuarios.ver')) {
        const cuantos = usuariosDe(r.nombre).length
        partes.push(`${cuantos} ${cuantos === 1 ? 'usuario' : 'usuarios'}`)
    }
    return partes.filter(Boolean).join(' · ')
}

/* Permisos del rol abierto: copia editable; «Guardar rol» la manda con la `version` leída. */
const elegidos = ref<string[]>([])
const filtro = ref('')
const guardando = ref(false)
const problemaGuardar = ref<Problem | null>(null)

watch(rol, (actual) => {
    elegidos.value = actual ? [...actual.permisos] : []
    problemaGuardar.value = null
}, { immediate: true })

watch(rolId, (id) => {
    if (id && String(id) !== route.query.rol) {
        void router.replace({ query: { ...route.query, rol: String(id) } })
    }
})

const editable = computed(() => rol.value !== null && !rol.value.base && puede('roles.editar'))
const elegidosSet = computed(() => new Set(elegidos.value))
const grupos = computed(() => agruparPermisos(catalogo.value, filtro.value))
const cambiado = computed(() => rol.value !== null && comoPermisos(elegidos.value).join() !== comoPermisos(rol.value.permisos).join())

function cambiar(nombre: string, valor: boolean) {
    const nuevos = new Set(elegidos.value)
    if (valor) {
        nuevos.add(nombre)
    }
    else {
        nuevos.delete(nombre)
    }
    elegidos.value = [...nuevos].sort()
}

function cuantosDe(grupo: GrupoPermisos): number {
    return grupo.permisos.filter(p => elegidosSet.value.has(p.nombre)).length
}

function todosGrupo(grupo: GrupoPermisos) {
    const marcar = cuantosDe(grupo) < grupo.permisos.length
    const nuevos = new Set(elegidos.value)
    for (const permiso of grupo.permisos) {
        if (marcar) {
            nuevos.add(permiso.nombre)
        }
        else {
            nuevos.delete(permiso.nombre)
        }
    }
    elegidos.value = [...nuevos].sort()
}

function descartar() {
    elegidos.value = rol.value ? [...rol.value.permisos] : []
}

async function guardar() {
    const actual = rol.value
    if (!actual) {
        return
    }
    guardando.value = true
    problemaGuardar.value = null
    const resultado = await useRoles().editar(actual.id, { version: actual.version, descripcion: actual.descripcion, permisos: comoPermisos(elegidos.value) })
    guardando.value = false
    if (!resultado.ok) {
        problemaGuardar.value = resultado.problema
        return
    }
    roles.value = roles.value.map(r => (r.id === resultado.data.id ? resultado.data : r))
    toast.add({ title: `Rol ${resultado.data.nombre} guardado`, description: `${resultado.data.permisos.length} permisos`, icon: 'i-lucide-circle-check', color: 'success' })
}

/* Alcance: para cada persona con el rol, dónde vale. */
type TipoAlcance = 'todo' | 'router' | 'zona' | 'caja'
const alcance = ref<TipoAlcance>('todo')
const itemsAlcance: TabsItem[] = [
    { label: 'Todo', value: 'todo' },
    { label: 'Router', value: 'router' },
    { label: 'Zona', value: 'zona' },
    { label: 'Caja', value: 'caja' },
]
const EXPLICACION_ALCANCE: Record<TipoAlcance, string> = {
    todo: 'Sin alcance, el rol vale en toda la empresa activa.',
    router: 'Por router: un técnico o soporte solo ve y toca los clientes y equipos de ese router.',
    zona: 'Por zona: solo los clientes, servicios y equipos de esa zona.',
    caja: 'Por caja: un cajero solo cobra y cierra su caja.',
}
const personas = computed(() => (rol.value
    ? usuariosDe(rol.value.nombre).map(u => ({
            usuario: u,
            asignaciones: u.roles.filter(r => r.rol === rol.value?.nombre),
        }))
    : []))

/* Nuevo y duplicar: el formulario en panel lateral. */
const editando = shallowRef<Rol | null>(null)
const copiaDe = shallowRef<Rol | null>(null)
const formularioAbierto = ref(false)

function abrirNuevo(copia: Rol | null = null) {
    editando.value = null
    copiaDe.value = copia
    formularioAbierto.value = true
}

function abrirDescripcion() {
    editando.value = rol.value
    copiaDe.value = null
    formularioAbierto.value = true
}

function alGuardar(guardado: Rol) {
    toast.add({ title: editando.value ? `Rol ${guardado.nombre} actualizado` : `Rol ${guardado.nombre} creado`, description: `${guardado.permisos.length} permisos`, icon: 'i-lucide-circle-check', color: 'success' })
    rolId.value = guardado.id
    void cargar()
}
</script>

<template>
    <ConfiguracionMarco
        id="roles"
        descripcion="Un rol agrupa lo que una persona puede hacer. El alcance dice dónde puede hacerlo."
        sin-tarjeta
    >
        <template #acciones>
            <UButton
                v-if="puede('roles.crear') && rol"
                label="Duplicar rol"
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
                :disabled="!catalogo.length"
                data-prueba="duplicar-rol"
                @click="abrirNuevo(rol)"
            />
        </template>

        <template #accion-principal>
            <UButton
                v-if="puede('roles.crear')"
                label="Nuevo rol"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand px-5"
                :disabled="!catalogo.length"
                data-prueba="nuevo-rol"
                @click="abrirNuevo()"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else
            class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,18rem)]"
        >
            <!-- Roles. -->
            <section
                class="surface-card flex min-h-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]"
                aria-label="Roles"
                data-prueba="tabla-roles"
            >
                <USkeleton
                    v-if="cargando && !roles.length"
                    class="m-4 h-40"
                />
                <ul class="flex min-h-0 flex-col divide-y divide-(--ax-borde) overflow-y-auto">
                    <li
                        v-for="r in roles"
                        :key="r.id"
                    >
                        <UButton
                            color="neutral"
                            variant="ghost"
                            class="w-full items-start gap-2 rounded-none px-4 py-3 text-start"
                            :class="r.id === rolId ? CLASE_FILA_ELEGIDA : ''"
                            :aria-pressed="r.id === rolId"
                            :data-rol="r.nombre"
                            :data-prueba="`editar-rol-${r.nombre}`"
                            @click="rolId = r.id"
                        >
                            <span class="flex min-w-0 flex-1 flex-col">
                                <span class="font-semibold text-highlighted capitalize">{{ r.nombre.replaceAll('_', ' ') }}</span>
                                <span class="line-clamp-2 text-xs font-normal text-muted">{{ resumenRol(r) }}</span>
                            </span>
                            <UBadge
                                :label="r.base ? 'Base' : 'Propio'"
                                :color="r.base ? 'neutral' : 'secondary'"
                                variant="subtle"
                                size="sm"
                            />
                        </UButton>
                    </li>
                </ul>
            </section>

            <!-- Permisos del rol abierto. -->
            <section
                v-if="rol"
                class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]"
                aria-labelledby="titulo-rol"
                data-prueba="catalogo-permisos"
            >
                <header class="flex flex-wrap items-center gap-3 border-b border-(--ax-borde) p-4">
                    <div class="flex min-w-0 flex-1 flex-col">
                        <h2
                            id="titulo-rol"
                            class="flex items-center gap-2 text-lg font-bold text-highlighted capitalize"
                        >
                            {{ rol.nombre.replaceAll('_', ' ') }}
                            <UBadge
                                :label="rol.base ? 'Rol base' : 'Rol propio'"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                            />
                        </h2>
                        <p class="text-[0.8125rem] text-muted">
                            <template v-if="puede('usuarios.ver')">
                                {{ usuariosDe(rol.nombre).length }} usuarios ·
                            </template>
                            {{ elegidos.length }} de {{ catalogo.length }} permisos
                        </p>
                    </div>
                    <UInput
                        v-model="filtro"
                        icon="i-lucide-search"
                        placeholder="Buscar permiso…"
                        aria-label="Buscar permiso"
                        class="w-full sm:w-64"
                        data-prueba="buscar-permiso"
                    />
                </header>

                <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 [&>*]:shrink-0">
                    <UAlert
                        v-if="rol.base"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-lock"
                        title="Rol base de ArgosIsp"
                        description="Sus permisos vienen con el sistema y no se cambian aquí. Si necesitas otro juego, duplícalo."
                        :actions="puede('roles.editar') ? [{ label: 'Editar la descripción', icon: ICONOS.editar, color: 'neutral', variant: 'outline', onClick: abrirDescripcion }] : undefined"
                    />
                    <section
                        v-for="grupo in grupos"
                        :key="grupo.modulo"
                        class="overflow-hidden rounded-2xl border border-(--ax-borde)"
                        :data-modulo="grupo.modulo"
                    >
                        <header class="flex items-center gap-3 bg-(--ax-panel) px-4 py-2.5">
                            <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                <UIcon
                                    name="i-lucide-shield-check"
                                    class="size-4"
                                />
                            </span>
                            <h3 class="flex-1 font-semibold text-highlighted">
                                {{ grupo.etiqueta }}
                            </h3>
                            <span class="text-xs text-muted tabular-nums">{{ cuantosDe(grupo) }} de {{ grupo.permisos.length }}</span>
                            <UButton
                                v-if="editable"
                                :label="cuantosDe(grupo) < grupo.permisos.length ? 'Todos' : 'Ninguno'"
                                color="primary"
                                variant="link"
                                size="sm"
                                @click="todosGrupo(grupo)"
                            />
                        </header>
                        <ul class="flex flex-col divide-y divide-(--ax-borde)">
                            <li
                                v-for="permiso in grupo.permisos"
                                :key="permiso.nombre"
                                class="flex items-center justify-between gap-3 px-4 py-2.5"
                            >
                                <div class="flex min-w-0 flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ permiso.descripcion ?? permiso.nombre }}</span>
                                    <span class="font-mono text-xs text-muted">{{ permiso.nombre }}</span>
                                </div>
                                <USwitch
                                    :model-value="elegidosSet.has(permiso.nombre)"
                                    :disabled="!editable"
                                    size="lg"
                                    :aria-label="`${permiso.descripcion ?? permiso.nombre} (${permiso.nombre})`"
                                    :data-permiso="permiso.nombre"
                                    @update:model-value="cambiar(permiso.nombre, $event === true)"
                                />
                            </li>
                        </ul>
                    </section>
                    <UEmpty
                        v-if="!grupos.length"
                        icon="i-lucide-search-x"
                        :title="filtro ? `Ningún permiso coincide con «${filtro}»` : 'El catálogo está vacío'"
                        variant="naked"
                    />
                    <ProblemaAlerta
                        v-if="problemaGuardar"
                        :problema="problemaGuardar"
                    />
                </div>

                <footer class="flex flex-wrap items-center gap-3 border-t border-(--ax-borde) p-4">
                    <p class="min-w-0 flex-1 text-xs text-muted">
                        Cada permiso es una acción del sistema; lo que no está encendido ni siquiera aparece en el menú.
                    </p>
                    <template v-if="editable">
                        <UButton
                            label="Descartar"
                            color="neutral"
                            variant="ghost"
                            :disabled="!cambiado || guardando"
                            @click="descartar"
                        />
                        <UButton
                            label="Guardar rol"
                            :icon="ICONOS.guardar"
                            :loading="guardando"
                            :disabled="!cambiado"
                            data-prueba="guardar-rol"
                            @click="guardar"
                        />
                    </template>
                </footer>
            </section>

            <!-- Alcance. -->
            <section
                v-if="rol"
                class="surface-card flex min-h-0 flex-col overflow-hidden rounded-[1.375rem] lg:col-span-2 xl:col-span-1 xl:max-h-[calc(100dvh-11rem)]"
                aria-labelledby="titulo-alcance"
            >
                <header class="flex items-start gap-3 border-b border-(--ax-borde) p-4">
                    <UIcon
                        name="i-lucide-map-pin"
                        class="mt-1 size-5 text-highlighted"
                    />
                    <div>
                        <h2
                            id="titulo-alcance"
                            class="text-lg font-bold text-highlighted"
                        >
                            Alcance
                        </h2>
                        <p class="text-[0.8125rem] text-muted">
                            Dónde vale este rol para cada persona
                        </p>
                    </div>
                </header>
                <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 [&>*]:shrink-0">
                    <OperPestanas
                        v-model="alcance"
                        :items="itemsAlcance"
                        etiqueta="Tipo de alcance"
                    />
                    <p class="text-[0.8125rem] text-muted">
                        {{ EXPLICACION_ALCANCE[alcance] }} Se elige al dar el rol a cada usuario.
                    </p>
                    <ul
                        v-if="puede('usuarios.ver')"
                        class="flex flex-col divide-y divide-(--ax-borde)"
                    >
                        <li
                            v-for="persona in personas"
                            :key="persona.usuario.id"
                            class="flex items-center justify-between gap-3 py-2.5"
                        >
                            <span class="truncate text-sm font-semibold text-highlighted">{{ persona.usuario.nombre }}</span>
                            <span class="flex flex-wrap justify-end gap-1">
                                <UBadge
                                    v-for="asignacion in persona.asignaciones"
                                    :key="`${asignacion.alcance_tipo}-${asignacion.alcance_id}`"
                                    :label="asignacion.alcance_tipo ? `${ALCANCES_ROL[asignacion.alcance_tipo].etiqueta} ${asignacion.alcance_id}` : 'Toda la empresa'"
                                    :icon="asignacion.alcance_tipo ? ALCANCES_ROL[asignacion.alcance_tipo].icono : undefined"
                                    :color="asignacion.alcance_tipo ? 'primary' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                        </li>
                        <li
                            v-if="!personas.length"
                            class="py-2 text-sm text-muted"
                        >
                            Nadie tiene este rol todavía.
                        </li>
                    </ul>
                    <UAlert
                        color="primary"
                        variant="subtle"
                        icon="i-lucide-info"
                        description="Un token de API o un asistente de IA usa el mismo sistema: un usuario con su rol y su alcance."
                    />
                </div>
            </section>
        </div>

        <RolFormulario
            v-model:open="formularioAbierto"
            :rol="editando"
            :copia-de="copiaDe"
            :catalogo="catalogo"
            :solo-lectura="editando !== null && !puede('roles.editar')"
            @guardado="alGuardar"
        />
    </ConfiguracionMarco>
</template>
