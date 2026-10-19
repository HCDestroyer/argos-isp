<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Nuevo motivo de cortesía de la empresa activa (`POST /adicionales/motivos`,
 * `adicionales.crear_motivo`; 409 `motivo_duplicado` junto al código).
 */
const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [motivo: MotivoCortesia] }>()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaMotivoCortesia>({ codigo: '', nombre: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.codigo = ''
        estado.nombre = ''
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<SalidaMotivoCortesia>) {
    enviando.value = true
    problema.value = null
    const resultado = await useAdicionales().crearMotivo(cuerpoMotivoCortesia(evento.data), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    if (resultado.problema.type.endsWith(':motivo_duplicado')) {
        formulario.value?.setErrors([{ name: 'codigo', message: resultado.problema.detail ?? 'Ya existe un motivo con ese código' }])
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
        title="Nuevo motivo de cortesía"
        description="De la empresa activa."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaMotivoCortesia"
                :state="estado"
                class="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]"
                @submit="enviar"
            >
                <UFormField
                    label="Código"
                    name="codigo"
                    required
                >
                    <UInput
                        v-model="estado.codigo"
                        placeholder="EMPLEADO"
                        autocomplete="off"
                        class="w-full font-mono uppercase"
                        data-prueba="motivo-codigo"
                    />
                </UFormField>
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        placeholder="Empleado de la empresa"
                        class="w-full"
                        data-prueba="motivo-nombre"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    class="sm:col-span-2"
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
                    label="Crear motivo"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-motivo"
                />
            </div>
        </template>
    </UModal>
</template>
