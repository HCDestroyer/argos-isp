<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Estimación de incobrables (`POST /cartera/provisionar`, `cartera.provisionar`): la API registra lo
 * que falta para llegar al tope (`reserva_incobrables_max` de los saldos deudores al corte;
 * `5.3.02 / 1.1.12`) o una fila en cero. Pide escribir la frase porque mueve el libro.
 */
const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [provision: ProvisionCartera]
}>()

const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const anioActual = Number(hoy.slice(0, 4))
const esquema = esquemaProvision(hoy)
const estado = reactive<EntradaProvision>({ anio: anioActual, fecha: '', confirmacion: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsAnio: SelectItem[] = [anioActual, anioActual - 1, anioActual - 2].map(a => ({ label: String(a), value: a }))
const frase = computed(() => fraseProvision(estado.anio))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { anio: anioActual, fecha: '', confirmacion: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaProvision>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCartera().provisionar(evento.data.fecha ? { anio: evento.data.anio, fecha: evento.data.fecha } : { anio: evento.data.anio }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    formulario.value?.setErrors(erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name)))
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Provisionar incobrables"
        description="Registra la estimación hasta el tope legal (3 % de los saldos deudores al corte). Si ya se llegó al tope, queda una fila en cero."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-provision"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Año"
                        name="anio"
                        required
                    >
                        <USelect
                            v-model="estado.anio"
                            :items="itemsAnio"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Corte de los saldos"
                        name="fecha"
                        :help="estado.anio === anioActual ? 'Vacío: hoy.' : 'Vacío: 31 de diciembre.'"
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-shield-alert"
                    :description="`Escribe ${frase} para confirmar. El asiento queda en el libro; no se deshace desde el panel.`"
                />
                <UFormField
                    label="Confirmación"
                    name="confirmacion"
                    required
                >
                    <UInput
                        v-model="estado.confirmacion"
                        :placeholder="frase"
                        autocomplete="off"
                        class="w-full"
                        data-prueba="provision-confirmacion"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="provision-error"
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
                    form="form-provision"
                    label="Provisionar"
                    icon="i-lucide-shield-alert"
                    color="warning"
                    :loading="enviando"
                    data-prueba="provision-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
