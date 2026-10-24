<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Alta y edición de un rol con sus permisos (A1): `POST /roles` (`roles.crear`) y `PUT /roles/:id`
 * (`roles.editar`, con `version`). El nombre no cambia después de crearlo. Los roles base
 * (`admin`, `cajero`…) definen sus permisos en código: aquí solo se edita su descripción.
 */
const props = withDefaults(defineProps<{
    rol?: Rol | null
    catalogo: readonly PermisoCatalogo[]
    soloLectura?: boolean
}>(), {
    rol: null,
    soloLectura: false,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [rol: Rol] }>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaRol>(entradaDesdeRol(null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const base = computed(() => props.rol?.base === true)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaDesdeRol(props.rol))
        problema.value = null
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<SalidaRol>) {
    enviando.value = true
    problema.value = null
    const descripcion = evento.data.descripcion === '' ? null : evento.data.descripcion
    const resultado = props.rol
        ? await useRoles().editar(props.rol.id, {
                version: props.rol.version,
                descripcion,
                ...(base.value ? {} : { permisos: comoPermisos(evento.data.permisos) }),
            })
        : await useRoles().crear({ nombre: evento.data.nombre, descripcion, permisos: comoPermisos(evento.data.permisos) })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    // 409 `rol_duplicado` (A1): es del nombre.
    if (resultado.problema.type.endsWith(':rol_duplicado')) {
        formulario.value?.setErrors([{ name: 'nombre', message: resultado.problema.detail ?? 'Ya existe un rol con ese nombre' }])
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
        :title="rol ? (soloLectura ? `Rol ${rol.nombre}` : `Editar rol ${rol.nombre}`) : 'Nuevo rol'"
        description="Un permiso es el nombre de la acción (servicios.suspender). El alcance por router, zona o caja se da al asignar el rol a un usuario."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-3xl' }"
    >
        <template #body>
            <UForm
                id="form-rol"
                ref="formulario"
                :schema="esquemaRol"
                :state="estado"
                :disabled="soloLectura"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        :help="rol ? 'El nombre no cambia después de crear el rol.' : 'Minúsculas, números y _ (ej. cobrador_zona).'"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            :disabled="rol !== null"
                            placeholder="cobrador_zona"
                            class="w-full font-mono"
                            data-prueba="rol-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                    >
                        <UInput
                            v-model="estado.descripcion"
                            placeholder="Cobra en su zona y registra promesas"
                            class="w-full"
                            data-prueba="rol-descripcion"
                        />
                    </UFormField>
                </div>

                <UAlert
                    v-if="base"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Rol base"
                    description="Sus permisos se definen en el código de ArgosIsp y se actualizan con cada versión. Para otra combinación, crea un rol propio."
                    data-prueba="rol-base"
                />

                <UFormField
                    label="Permisos"
                    name="permisos"
                >
                    <PermisosSelector
                        v-model="estado.permisos"
                        :catalogo="catalogo"
                        :disabled="soloLectura || base"
                        prueba="rol-permisos"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="rol-error"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="soloLectura ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!soloLectura"
                    type="submit"
                    form="form-rol"
                    :label="rol ? 'Guardar cambios' : 'Crear rol'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="rol-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
