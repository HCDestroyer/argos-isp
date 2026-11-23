<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Aprobar un correo externo para los reportes contables programados (A3, decisión 6 del PM): un
 * contador o un socio. Si ya estaba retirado, vuelve a quedar aprobado.
 */
const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [correo: CorreoExternoReportes] }>()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<DatosFormCorreoExterno>({ correo: '', nombre: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { correo: '', nombre: '' })
        problema.value = null
    }
})

async function enviar(evento: FormSubmitEvent<DatosFormCorreoExterno>) {
    enviando.value = true
    problema.value = null
    const r = await useCorreosExternos().aprobar(evento.data)
    enviando.value = false
    if (!r.ok) {
        problema.value = r.problema
        if (r.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    abierto.value = false
    emit('hecho', r.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                texto="Aprobar un correo"
                icono="i-lucide-mail-check"
            />
        </template>
        <template #description>
            Recibirá solo reportes contables, sin datos personales de clientes.
        </template>
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaCorreoExterno"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Correo"
                    name="correo"
                    required
                >
                    <UInput
                        v-model="estado.correo"
                        type="email"
                        autofocus
                        placeholder="contador@despacho.gt"
                        class="w-full"
                        data-prueba="correo-externo-correo"
                    />
                </UFormField>
                <UFormField
                    label="De quién es"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        placeholder="Ej.: Despacho contable"
                        class="w-full"
                        data-prueba="correo-externo-nombre"
                    />
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
                    :icon="ICONOS.cancelar"
                    color="neutral"
                    variant="outline"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Aprobar"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="correo-externo-aprobar"
                />
            </div>
        </template>
    </UModal>
</template>
