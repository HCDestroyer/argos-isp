<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/** Abre el turno de una caja con su fondo inicial (`POST /cajas/:id/abrir`, `cajas.abrir`). */
const props = defineProps<{
    caja: Caja
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [turno: TurnoCaja]
}>()

const estado = reactive<DatosApertura>({ fondo_inicial: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.fondo_inicial = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<DatosApertura>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().abrir(props.caja.id, evento.data.fondo_inicial, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Abrir turno"
        :description="caja.nombre"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-apertura-caja"
                :schema="esquemaApertura"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Fondo inicial"
                    name="fondo_inicial"
                    required
                    help="Efectivo con el que empieza la caja (para dar vuelto)."
                >
                    <UInput
                        v-model="estado.fondo_inicial"
                        inputmode="decimal"
                        placeholder="500.00"
                        autofocus
                        class="w-full"
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
                    form="form-apertura-caja"
                    label="Abrir turno"
                    icon="i-lucide-lock-open"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
