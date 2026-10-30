<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Abre la caja (su turno) con el fondo inicial (`POST /cajas/:id/abrir`, `cajas.abrir`). Con
 * `opciones` (el cobro, sin caja elegida) se elige cuál abrir; con una sola, queda elegida.
 */
const props = withDefaults(defineProps<{
    caja?: Caja | null
    opciones?: Caja[]
}>(), {
    caja: null,
    opciones: () => [],
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [turno: TurnoCaja]
}>()

const estado = reactive<DatosApertura>({ fondo_inicial: '' })
const elegida = ref<number | undefined>(undefined)
const caja = computed<Caja | null>(() => props.caja ?? props.opciones.find(c => c.id === elegida.value) ?? null)
const itemsCaja = computed(() => props.opciones.map(c => ({ label: c.nombre, value: c.id, description: c.cajero_nombre ?? undefined })))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        elegida.value = props.opciones.length === 1 ? props.opciones[0]?.id : undefined
        estado.fondo_inicial = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<DatosApertura>) {
    if (!caja.value) {
        problema.value = { type: 'about:blank', title: 'Elige la caja que vas a abrir', status: 422 }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().abrir(caja.value.id, evento.data.fondo_inicial, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        void useMiCaja().refrescar()
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Abrir caja"
        :description="caja ? `${caja.nombre}: empieza el turno con el efectivo que hay en la gaveta.` : 'Elige la caja y el efectivo con el que empiezas.'"
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
                    v-if="!props.caja && opciones.length > 1"
                    label="Caja"
                    required
                    help="El efectivo que cobres en este turno queda en esta caja."
                >
                    <USelect
                        v-model="elegida"
                        :items="itemsCaja"
                        placeholder="Elige la caja"
                        class="w-full"
                        data-prueba="apertura-caja"
                    />
                </UFormField>
                <UFormField
                    label="Fondo inicial"
                    name="fondo_inicial"
                    required
                    help="Efectivo con el que empieza la caja, para dar vuelto. Al cerrar se compara con lo contado."
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
                    label="Abrir caja"
                    icon="i-lucide-lock-open"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
