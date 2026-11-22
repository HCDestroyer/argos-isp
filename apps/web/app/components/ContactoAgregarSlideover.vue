<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Agregar un contacto al cliente (`contactos.gestionar`): quien también puede escribirnos por sus
 * servicios. Panel lateral (más de 3 campos): nombre, relación, número con WhatsApp y permisos
 * (de fábrica, todos encendidos). Aplica a todos sus servicios.
 */
const props = defineProps<{
    clienteId: number
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
    creado: [contacto: ContactoCliente]
}>()

const toast = useToast()

function vacio(): EntradaContacto {
    return { nombre: '', relacion: 'familiar', numero: '', whatsapp: true, consultar: true, reportar: true, pagar: true, avisos: true }
}

const estado = reactive<EntradaContacto>(vacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()
const formulario = useTemplateRef<{ setErrors: (errores: ReturnType<typeof erroresDeFormulario>) => void }>('formulario')

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, vacio())
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function alEnviar(evento: FormSubmitEvent<EntradaContacto>) {
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const resultado = await useContactos().crear(props.clienteId, {
        nombre: datos.nombre,
        relacion: datos.relacion,
        telefonos: [{ numero: datos.numero, whatsapp: datos.whatsapp, principal: true }],
        permisos: { consultar: datos.consultar, reportar: datos.reportar, pagar: datos.pagar, avisos: datos.avisos },
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema).map(error => ({
                ...error,
                name: error.name?.startsWith('telefonos') ? 'numero' : error.name,
            })))
        }
        return
    }
    toast.add({ title: 'Contacto agregado', description: resultado.data.nombre, icon: 'i-lucide-user-plus', color: 'success' })
    emit('creado', resultado.data)
    abierto.value = false
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="Agregar contacto"
        description="Quien también puede escribirnos por los servicios de este cliente."
    >
        <template #body>
            <UForm
                id="formulario-contacto"
                ref="formulario"
                :schema="esquemaContacto"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="alEnviar"
            >
                <ProblemaAlerta
                    v-if="problema && problema.status !== 422"
                    :problema="problema"
                />
                <UFormField
                    name="nombre"
                    label="Nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        icon="i-lucide-user"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    name="relacion"
                    label="Relación"
                    required
                >
                    <USelect
                        v-model="estado.relacion"
                        :items="RELACIONES_CONTACTO"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    name="numero"
                    label="Teléfono"
                    required
                    help="8 dígitos de Guatemala o +código del país"
                >
                    <UInput
                        v-model="estado.numero"
                        icon="i-lucide-phone"
                        inputmode="tel"
                        class="w-full"
                    />
                </UFormField>
                <UFormField name="whatsapp">
                    <UCheckbox
                        v-model="estado.whatsapp"
                        label="Tiene WhatsApp"
                    />
                </UFormField>
                <fieldset class="flex flex-col gap-3">
                    <legend class="mb-2 text-sm font-medium text-highlighted">
                        Qué puede hacer
                    </legend>
                    <USwitch
                        v-for="permiso in PERMISOS_CONTACTO"
                        :key="permiso.clave"
                        v-model="estado[permiso.clave]"
                        :label="permiso.etiqueta"
                        :description="permiso.detalle"
                    />
                </fieldset>
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="outline"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="formulario-contacto"
                    label="Agregar contacto"
                    icon="i-lucide-user-plus"
                    :loading="enviando"
                />
            </div>
        </template>
    </USlideover>
</template>
