<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Aprobar un cobro de equipo propuesto (A48, `POST /inventario/cobros-equipo/:id/aprobar`,
 * `inventario.cobrar_equipo`): el monto con IVA del cargo único al cliente. Lo decide una persona,
 * nunca el técnico que lo propuso.
 */
const props = defineProps<{
    cobro: CobroEquipo | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [cobro: CobroEquipo] }>()

const esquema = z.object({
    monto: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Escribe el monto a cobrar').refine(m => Number(m) > 0, 'El monto debe ser mayor que cero'),
})

const idFormulario = useId()
const estado = reactive({ monto: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.monto = props.cobro?.monto ?? ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    if (!props.cobro) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useCobrosEquipo().aprobar(props.cobro, { monto: evento.data.monto, concepto_id: null, motivo: null }, clave)
    enviando.value = false
    if (!r.ok) {
        problema.value = r.problema
        return
    }
    abierto.value = false
    emit('hecho', r.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Aprobar el cobro"
        :description="cobro ? `${cobro.producto_nombre} · ${cobro.cliente_nombre}` : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <p class="text-sm text-muted">
                    Se le cobra al cliente con una nueva factura «{{ cobro ? ORIGENES_COBRO_EQUIPO[cobro.origen] : '' }}»{{ cobro?.nota ? ` (${cobro.nota})` : '' }}.
                </p>
                <UFormField
                    label="Monto (con IVA)"
                    name="monto"
                    required
                >
                    <UInput
                        v-model="estado.monto"
                        inputmode="decimal"
                        class="w-full"
                        data-prueba="cobro-monto"
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
                    :icon="ICONOS.cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Cobrar al cliente"
                    :icon="ICONOS.cobrar"
                    color="success"
                    :loading="enviando"
                    data-prueba="cobro-aprobar-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
