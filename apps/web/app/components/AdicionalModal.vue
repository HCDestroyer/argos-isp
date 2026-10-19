<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Alta (`POST /adicionales`, `adicionales.crear`) o edición (`PUT /adicionales/:id`,
 * `adicionales.editar`, con `version`) de un adicional del catálogo de la empresa activa. El código
 * se guarda en mayúsculas y es único en la empresa (409 `adicional_duplicado`, junto al campo).
 */
const props = defineProps<{
    adicional: Adicional | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [adicional: Adicional, nuevo: boolean] }>()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaAdicional>(entradaAdicional(null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaAdicional(props.adicional))
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<SalidaAdicional>) {
    enviando.value = true
    problema.value = null
    const resultado = props.adicional
        ? await useAdicionales().editar(props.adicional.id, cambiosAdicional(evento.data, props.adicional.version))
        : await useAdicionales().crear(cuerpoAdicional(evento.data), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data, props.adicional === null)
        return
    }
    if (resultado.problema.type.endsWith(':adicional_duplicado')) {
        formulario.value?.setErrors([{ name: 'codigo', message: resultado.problema.detail ?? 'Ya existe un adicional con ese código en la empresa' }])
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
    <UModal
        v-model:open="abierto"
        :title="adicional ? `Editar ${adicional.nombre}` : 'Nuevo adicional'"
        :description="adicional ? `Versión ${adicional.version}` : 'Del catálogo de la empresa activa.'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaAdicional"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <UFormField
                        label="Código"
                        name="codigo"
                        required
                    >
                        <UInput
                            v-model="estado.codigo"
                            placeholder="STREAM"
                            autocomplete="off"
                            class="w-full font-mono uppercase"
                            data-prueba="adicional-codigo"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Cuenta de streaming"
                            class="w-full"
                            data-prueba="adicional-nombre"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Descripción"
                    name="descripcion"
                >
                    <UTextarea
                        v-model="estado.descripcion"
                        :rows="2"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Precio sugerido"
                    name="precio_sugerido"
                    help="Se propone al asignarlo cobrado; cada servicio puede llevar otro precio."
                >
                    <UInput
                        v-model="estado.precio_sugerido"
                        inputmode="decimal"
                        placeholder="45.00"
                        class="w-full sm:w-48"
                        data-prueba="adicional-precio"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>
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
                    :form="idFormulario"
                    :label="adicional ? 'Guardar' : 'Crear adicional'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-adicional"
                />
            </div>
        </template>
    </UModal>
</template>
