<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Guardar o reemplazar las credenciales del certificador de un ambiente
 * (`PUT /fel/credenciales/:ambiente`, `fel.configurar`). Son de solo escritura: se guardan
 * cifradas y la API nunca las devuelve (solo los campos visibles, como el usuario). Los campos
 * secretos empiezan vacíos siempre: reemplazar es escribirlas de nuevo.
 */
const props = defineProps<{
    empresaId: number
    ambiente: AmbienteFel
    proveedor: ProveedorFel
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [credenciales: CredencialesFel]
}>()

const campos = computed(() => PROVEEDORES_FEL[props.proveedor].campos)

/** Espejo de `credencialesFelValidator` y de los obligatorios del proveedor (A3): texto de hasta 500. */
const esquema = computed(() => z.object(Object.fromEntries(campos.value.map(campo => [
    campo.clave,
    campo.obligatorio
        ? z.string().trim().min(1, 'Obligatorio').max(500, 'Máximo 500 caracteres')
        : z.string().trim().max(500, 'Máximo 500 caracteres'),
]))))

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = ref<Record<string, string>>({})
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.value = Object.fromEntries(campos.value.map(campo => [campo.clave, '']))
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<Record<string, string>>) {
    const credenciales = Object.fromEntries(Object.entries(evento.data).filter(([, valor]) => typeof valor === 'string' && valor.trim() !== ''))
    enviando.value = true
    problema.value = null
    const resultado = await useFel().guardarCredenciales(props.ambiente, { empresa_id: props.empresaId, proveedor: props.proveedor, credenciales }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    // `credenciales.llave_api` de la API → el campo `llave_api`.
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.replace(/^credenciales\./, '') }))
    if (errores.some(e => e.name && campos.value.some(c => c.clave === e.name))) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaFelLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Credenciales de ${AMBIENTES_FEL[ambiente].toLowerCase()}`"
        :description="PROVEEDORES_FEL[proveedor].etiqueta"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                autocomplete="off"
                @submit="enviar"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-lock"
                    description="Se guardan cifradas y nunca vuelven a mostrarse. Para cambiarlas, escríbelas de nuevo completas."
                />
                <UFormField
                    v-for="campo in campos"
                    :key="campo.clave"
                    :label="campo.etiqueta"
                    :name="campo.clave"
                    :required="campo.obligatorio"
                    :help="campo.secreto ? 'Secreto: no se mostrará después de guardar.' : undefined"
                >
                    <UInput
                        v-model="estado[campo.clave]"
                        :type="campo.secreto ? 'password' : 'text'"
                        :autocomplete="campo.secreto ? 'new-password' : 'off'"
                        class="w-full"
                        :data-prueba="`credencial-${campo.clave}`"
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
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Guardar credenciales"
                    icon="i-lucide-key-round"
                    :loading="enviando"
                    data-prueba="credenciales-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
