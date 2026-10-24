<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import type * as z from 'zod'

/**
 * Alta y edición de una bodega (A3): un lugar o la bodega de un técnico (su vehículo), que solo
 * mueve ese usuario o quien tenga el permiso con alcance global (tope por técnico). El tipo no
 * cambia al editar; cambiar el técnico de una bodega con existencias es 409.
 */
const props = withDefaults(defineProps<{
    bodega?: Bodega | null
}>(), {
    bodega: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [bodega: Bodega] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaBodega>({ nombre: '', tipo: 'bodega', usuario_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const usuarios = shallowRef<SelectItem[] | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, async (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, { nombre: props.bodega?.nombre ?? '', tipo: props.bodega?.tipo ?? 'bodega', usuario_id: props.bodega?.usuario_id ?? null })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    if (puede('usuarios.ver') && usuarios.value === null) {
        const resultado = await useUsuarios().listar()
        usuarios.value = resultado.ok ? resultado.data.data.filter(u => u.activo).map(u => ({ label: u.nombre, value: u.id, description: u.roles.map(r => r.rol).join(', ') })) : null
    }
}, { immediate: true })

const itemsTipo: SelectItem[] = (Object.keys(TIPOS_BODEGA) as Bodega['tipo'][]).map(t => ({ label: TIPOS_BODEGA[t].etiqueta, value: t, icon: TIPOS_BODEGA[t].icono }))

async function enviar(evento: FormSubmitEvent<z.output<typeof esquemaBodega>>) {
    enviando.value = true
    problema.value = null
    const usuarioId = evento.data.tipo === 'tecnico' ? evento.data.usuario_id : null
    const resultado = props.bodega
        ? await useBodegas().editar(props.bodega.id, { version: props.bodega.version, nombre: evento.data.nombre, ...(props.bodega.tipo === 'tecnico' ? { usuario_id: usuarioId } : {}) })
        : await useBodegas().crear({ nombre: evento.data.nombre, tipo: evento.data.tipo, usuario_id: usuarioId }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
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
        :title="bodega ? `Editar ${bodega.nombre}` : 'Nueva bodega'"
        description="Un lugar donde se guarda inventario, o el vehículo de un técnico."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-md' }"
    >
        <template #body>
            <UForm
                id="form-bodega"
                ref="formulario"
                :schema="esquemaBodega"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        class="w-full"
                        data-prueba="bodega-nombre"
                    />
                </UFormField>
                <UFormField
                    label="Tipo"
                    name="tipo"
                    :help="bodega ? 'El tipo no cambia después de crearla.' : undefined"
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        :disabled="bodega !== null"
                        class="w-full"
                        data-prueba="bodega-tipo"
                    />
                </UFormField>
                <template v-if="estado.tipo === 'tecnico'">
                    <UFormField
                        label="Técnico"
                        name="usuario_id"
                        :help="usuarios ? 'Solo este usuario la mueve (o quien tenga alcance global).' : 'Sin la lista de usuarios: escribe su número.'"
                        required
                    >
                        <USelectMenu
                            v-if="usuarios"
                            :model-value="estado.usuario_id ?? undefined"
                            :items="usuarios"
                            value-key="value"
                            placeholder="Elige el técnico"
                            class="w-full"
                            data-prueba="bodega-tecnico"
                            @update:model-value="v => estado.usuario_id = typeof v === 'number' ? v : null"
                        />
                        <UInputNumber
                            v-else
                            :model-value="estado.usuario_id ?? undefined"
                            :min="1"
                            class="w-full"
                            @update:model-value="v => estado.usuario_id = typeof v === 'number' ? v : null"
                        />
                    </UFormField>
                </template>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
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
                    form="form-bodega"
                    :label="bodega ? 'Guardar cambios' : 'Crear bodega'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="bodega-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
