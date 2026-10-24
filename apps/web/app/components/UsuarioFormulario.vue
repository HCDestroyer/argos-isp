<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de un usuario del panel (A1): datos, contraseña (al editar, vacía = no cambia),
 * activo y sus roles, cada uno con alcance opcional a un router, una zona o una caja. Los roles
 * se leen con `roles.ver`; sin él, la edición no toca los roles (no los manda). Las listas de
 * routers, zonas y cajas se leen con su permiso; sin él se escribe el id.
 */
const props = withDefaults(defineProps<{
    usuario?: UsuarioPanel | null
}>(), {
    usuario: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [usuario: UsuarioPanel] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaUsuario>(entradaUsuarioVacia())
const esquema = computed(() => esquemaUsuario(props.usuario !== null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const roles = shallowRef<Rol[]>([])
const problemaRoles = ref<Problem | null>(null)
const cargandoRoles = ref(false)
const opciones = reactive<Record<TipoAlcanceRol, SelectItem[] | null>>({ router: null, zona: null, caja: null })

async function cargarRoles() {
    if (!puede('roles.ver')) {
        problemaRoles.value = problemaSinPermiso('roles.ver')
        return
    }
    cargandoRoles.value = true
    const resultado = await useRoles().listar()
    cargandoRoles.value = false
    roles.value = resultado.ok ? resultado.data : []
    problemaRoles.value = resultado.ok ? null : resultado.problema
}

/** Routers, zonas y cajas para elegir el alcance; sin su permiso (o si falla) queda el id a mano. */
async function cargarAlcances() {
    const [routers, zonas, cajas] = await Promise.all([
        puede('routers.ver') ? useRouters().listar() : null,
        puede('zonas.ver') ? useZonas().listar() : null,
        puede('cajas.ver') ? useCajas().listar() : null,
    ])
    opciones.router = routers?.ok ? routers.data.data.map(r => ({ label: r.nombre, value: r.id })) : null
    opciones.zona = zonas?.ok ? zonas.data.map(z => ({ label: z.nombre, value: z.id })) : null
    opciones.caja = cajas?.ok ? cajas.data.map(c => ({ label: c.nombre, value: c.id })) : null
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.usuario ? entradaDesdeUsuario(props.usuario) : entradaUsuarioVacia())
        problema.value = null
        void cargarRoles()
        void cargarAlcances()
    }
}, { immediate: true })

const itemsRoles = computed<SelectItem[]>(() => roles.value.map(r => ({ label: r.nombre, description: r.descripcion ?? undefined, value: r.id })))
const itemsAlcance: SelectItem[] = [
    { label: 'Todo', value: SIN_ALCANCE, description: 'Sin restricción' },
    ...(Object.keys(ALCANCES_ROL) as TipoAlcanceRol[]).map(tipo => ({ label: ALCANCES_ROL[tipo].opcion, value: tipo, icon: ALCANCES_ROL[tipo].icono })),
]
/** Sin poder leer los roles no se pueden reemplazar: la edición no los manda. */
const puedeAsignarRoles = computed(() => problemaRoles.value === null)

function agregarRol() {
    estado.roles.push({ role_id: null, alcance_tipo: SIN_ALCANCE, alcance_id: null })
}

function quitarRol(indice: number) {
    estado.roles.splice(indice, 1)
}

function cambiarTipo(indice: number, tipo: unknown) {
    const fila = estado.roles[indice]
    if (fila && (tipo === SIN_ALCANCE || tipo === 'router' || tipo === 'zona' || tipo === 'caja')) {
        fila.alcance_tipo = tipo
        fila.alcance_id = null
    }
}

function numeroONulo(valor: unknown): number | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

function nombreRol(id: number | null): string {
    return roles.value.find(r => r.id === id)?.nombre ?? props.usuario?.roles.find(r => r.role_id === id)?.rol ?? `rol ${id}`
}

async function enviar(evento: FormSubmitEvent<SalidaUsuario>) {
    enviando.value = true
    problema.value = null
    let resultado: Resultado<UsuarioPanel>
    if (props.usuario) {
        const cambios = cambiosUsuario(evento.data, props.usuario.version)
        if (!puedeAsignarRoles.value) {
            delete cambios.roles
        }
        resultado = await useUsuarios().editar(props.usuario.id, cambios)
    }
    else {
        resultado = await useUsuarios().crear(cuerpoUsuario(evento.data))
    }
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    if (resultado.problema.type.endsWith(':email_duplicado')) {
        formulario.value?.setErrors([{ name: 'email', message: resultado.problema.detail ?? 'Ya existe un usuario con ese correo' }])
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="usuario ? `Editar ${usuario.nombre}` : 'Nuevo usuario'"
        description="Las empresas que opera se asignan aparte, con «Asignar empresas»."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-usuario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            autocomplete="off"
                            class="w-full"
                            data-prueba="usuario-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Correo"
                        name="email"
                        required
                    >
                        <UInput
                            v-model="estado.email"
                            type="email"
                            autocomplete="off"
                            class="w-full"
                            data-prueba="usuario-email"
                        />
                    </UFormField>
                    <UFormField
                        :label="usuario ? 'Nueva contraseña' : 'Contraseña'"
                        name="password"
                        :help="usuario ? 'Déjala vacía para no cambiarla.' : 'Al menos 8 caracteres.'"
                        :required="!usuario"
                    >
                        <UInput
                            v-model="estado.password"
                            type="password"
                            autocomplete="new-password"
                            class="w-full"
                            data-prueba="usuario-password"
                        />
                    </UFormField>
                    <USwitch
                        v-model="estado.activo"
                        label="Activo"
                        description="Inactivo: no puede entrar y sus tokens dejan de funcionar."
                        class="self-center"
                        data-prueba="usuario-activo"
                    />
                </div>

                <section
                    class="flex flex-col gap-3"
                    data-prueba="usuario-roles"
                >
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-sm font-medium text-highlighted">
                            Roles
                        </h3>
                        <UButton
                            v-if="puedeAsignarRoles"
                            label="Agregar rol"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :disabled="cargandoRoles"
                            data-prueba="agregar-rol"
                            @click="agregarRol"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="problemaRoles"
                        :problema="problemaRoles"
                        :reintentar="puede('roles.ver') ? cargarRoles : undefined"
                        :reintentando="cargandoRoles"
                    />
                    <div
                        v-if="!puedeAsignarRoles && usuario"
                        class="flex flex-wrap gap-1"
                    >
                        <UBadge
                            v-for="rol in usuario.roles"
                            :key="`${rol.role_id}-${rol.alcance_id}`"
                            :label="rol.rol"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                    </div>
                    <template v-if="puedeAsignarRoles">
                        <p
                            v-if="!estado.roles.length"
                            class="text-sm text-muted"
                        >
                            Sin roles no puede hacer nada en el panel.
                        </p>
                        <div
                            v-for="(fila, indice) in estado.roles"
                            :key="indice"
                            class="grid gap-3 rounded-md border border-default p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start"
                            :data-prueba="`usuario-rol-${indice}`"
                        >
                            <UFormField
                                label="Rol"
                                :name="`roles.${indice}.role_id`"
                            >
                                <USelect
                                    :model-value="fila.role_id ?? undefined"
                                    :items="itemsRoles"
                                    placeholder="Elige el rol"
                                    class="w-full"
                                    :data-prueba="`usuario-rol-${indice}-rol`"
                                    @update:model-value="v => fila.role_id = numeroONulo(v)"
                                />
                            </UFormField>
                            <UFormField
                                label="Alcance"
                                :name="`roles.${indice}.alcance_tipo`"
                            >
                                <USelect
                                    :model-value="fila.alcance_tipo"
                                    :items="itemsAlcance"
                                    class="w-full"
                                    :data-prueba="`usuario-rol-${indice}-alcance`"
                                    @update:model-value="v => cambiarTipo(indice, v)"
                                />
                            </UFormField>
                            <UFormField
                                v-if="fila.alcance_tipo !== SIN_ALCANCE"
                                :label="ALCANCES_ROL[fila.alcance_tipo].etiqueta"
                                :name="`roles.${indice}.alcance_id`"
                                :help="opciones[fila.alcance_tipo] ? undefined : 'Sin la lista: escribe el id.'"
                            >
                                <USelect
                                    v-if="opciones[fila.alcance_tipo]"
                                    :model-value="fila.alcance_id ?? undefined"
                                    :items="opciones[fila.alcance_tipo] ?? []"
                                    placeholder="Elige"
                                    class="w-full"
                                    :data-prueba="`usuario-rol-${indice}-alcance-id`"
                                    @update:model-value="v => fila.alcance_id = numeroONulo(v)"
                                />
                                <UInputNumber
                                    v-else
                                    :model-value="fila.alcance_id ?? undefined"
                                    :min="1"
                                    class="w-full"
                                    @update:model-value="v => fila.alcance_id = numeroONulo(v)"
                                />
                            </UFormField>
                            <div
                                v-else
                                class="hidden sm:block"
                            />
                            <UButton
                                icon="i-lucide-trash-2"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="justify-self-end sm:mt-6"
                                :aria-label="`Quitar ${fila.role_id ? nombreRol(fila.role_id) : 'el rol'}`"
                                @click="quitarRol(indice)"
                            />
                        </div>
                    </template>
                </section>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="usuario-error"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-usuario"
                    :label="usuario ? 'Guardar cambios' : 'Crear usuario'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="usuario-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
