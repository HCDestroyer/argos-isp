<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Traslado entre cuentas bancarias propias de la misma empresa (`POST /bancos/trasladar`,
 * `bancos.trasladar`): sale del origen a fondos en tránsito (1.1.11) y llega al destino cuando se
 * concilia la línea del extracto del banco destino.
 */
const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [traslado: Traslado]
}>()

const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const esquema = esquemaTraslado(hoy)
const estado = reactive<EntradaTraslado>({ monto: '', referencia: '', fecha: '', origen: null, destino: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { monto: '', referencia: '', fecha: '', origen: null, destino: null })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaTraslado>) {
    enviando.value = true
    problema.value = null
    const resultado = await useFondosEnTransito().trasladar(cuerpoTraslado(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    // Los errores de la cuenta vienen como `origen.cuenta_id` / `destino.cuenta_id`.
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.split('.')[0] }))
    formulario.value?.setErrors(errores.filter(e => e.name && Object.hasOwn(estado, e.name)))
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Trasladar entre bancos"
        description="El dinero sale hoy de la cuenta de origen y queda en tránsito hasta que el extracto del destino lo acredite."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-traslado"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Sale de"
                        name="origen"
                        required
                        class="sm:col-span-2"
                    >
                        <CuentaBancoSelect v-model="estado.origen" />
                    </UFormField>
                    <UFormField
                        label="Llega a"
                        name="destino"
                        required
                        class="sm:col-span-2"
                    >
                        <CuentaBancoSelect
                            v-model="estado.destino"
                            :excepto="estado.origen"
                        />
                    </UFormField>
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="1000.00"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Referencia"
                        name="referencia"
                        required
                    >
                        <UInput
                            v-model="estado.referencia"
                            placeholder="TR-001"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha"
                        name="fecha"
                        help="Vacía: hoy."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                </div>
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
                    form="form-traslado"
                    label="Trasladar"
                    icon="i-lucide-arrow-right-left"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
