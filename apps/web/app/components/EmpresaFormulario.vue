<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Alta o edición de una empresa (NIT) en un panel lateral: datos fiscales (NIT, razón social,
 * régimen de ISR, establecimiento) y de contacto. La edición manda la `version` leída (409 si otra
 * persona la cambió); el NIT repetido es 409 `nit_duplicado` y va junto al campo.
 */
const props = defineProps<{
    empresa: EmpresaGrupo | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardada: [empresa: EmpresaGrupo] }>()

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaEmpresaGrupo>(entradaEmpresaGrupo(props.empresa))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const conflicto = ref(false)
let clave = nuevaClaveIdempotencia()

const editando = computed(() => props.empresa !== null)
const itemsRegimen = [
    { label: 'Sin indicar', value: SIN_REGIMEN },
    ...Object.entries(REGIMENES_ISR).map(([value, label]) => ({ label, value })),
]

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaEmpresaGrupo(props.empresa))
        problema.value = null
        conflicto.value = false
        clave = nuevaClaveIdempotencia()
    }
})

async function alEnviar(evento: FormSubmitEvent<SalidaEmpresaGrupo>) {
    enviando.value = true
    problema.value = null
    conflicto.value = false
    const empresas = useEmpresas()
    const resultado = props.empresa
        ? await empresas.editar(props.empresa.id, { ...evento.data, version: props.empresa.version })
        : await empresas.crear(evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardada', resultado.data)
        return
    }
    if (resultado.problema.type.endsWith(':nit_duplicado')) {
        formulario.value?.setErrors([{ name: 'nit', message: resultado.problema.detail ?? 'Ya existe una empresa activa con ese NIT' }])
        return
    }
    if (resultado.problema.status === 409) {
        conflicto.value = true
        return
    }
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
    }
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="editando ? `Editar ${empresa?.nombre_comercial}` : 'Nueva empresa'"
        description="Datos fiscales y de contacto. Salen en las facturas, el portal y los avisos."
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaEmpresaGrupo"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="alEnviar"
            >
                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más editó esta empresa"
                    description="Tus cambios no se guardaron. Cierra, vuelve a abrirla y aplica los cambios otra vez."
                />
                <ProblemaAlerta
                    v-else-if="problema && problema.status !== 422"
                    :problema="problema"
                />

                <fieldset class="grid gap-4 sm:grid-cols-2">
                    <legend class="mb-3 text-sm font-semibold text-highlighted">
                        Datos fiscales
                    </legend>
                    <UFormField
                        name="nit"
                        label="NIT"
                        required
                    >
                        <UInput
                            v-model="estado.nit"
                            placeholder="1234567-8"
                            class="w-full font-mono"
                            autocomplete="off"
                        />
                    </UFormField>
                    <UFormField
                        name="codigo_establecimiento"
                        label="Establecimiento (SAT)"
                        hint="Para FEL"
                    >
                        <UInput
                            v-model="estado.codigo_establecimiento"
                            inputmode="numeric"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        name="razon_social"
                        label="Razón social"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.razon_social"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="nombre_comercial"
                        label="Nombre comercial"
                        required
                        description="El que ven los clientes y el selector de empresa"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre_comercial"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="regimen_isr"
                        label="Régimen de ISR"
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.regimen_isr"
                            :items="itemsRegimen"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="direccion_fiscal"
                        label="Dirección fiscal"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.direccion_fiscal"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="municipio"
                        label="Municipio"
                    >
                        <UInput
                            v-model="estado.municipio"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="departamento"
                        label="Departamento"
                    >
                        <UInput
                            v-model="estado.departamento"
                            class="w-full"
                        />
                    </UFormField>
                </fieldset>

                <fieldset class="grid gap-4 sm:grid-cols-2">
                    <legend class="mb-3 text-sm font-semibold text-highlighted">
                        Contacto
                    </legend>
                    <UFormField
                        name="telefono"
                        label="Teléfono"
                    >
                        <UInput
                            v-model="estado.telefono"
                            type="tel"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="whatsapp"
                        label="WhatsApp"
                    >
                        <UInput
                            v-model="estado.whatsapp"
                            type="tel"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="correo"
                        label="Correo"
                    >
                        <UInput
                            v-model="estado.correo"
                            type="email"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="sitio_web"
                        label="Sitio web"
                    >
                        <UInput
                            v-model="estado.sitio_web"
                            type="url"
                            placeholder="https://"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="horario"
                        label="Horario de atención"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.horario"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="color_marca"
                        label="Color de marca"
                        description="Solo para el PDF y el correo; el panel y el portal usan el teal de ArgosIsp"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.color_marca"
                            placeholder="#0F766E"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </fieldset>
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    class="justify-center"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    :label="editando ? 'Guardar cambios' : 'Crear empresa'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    class="glow-brand justify-center"
                />
            </div>
        </template>
    </USlideover>
</template>
