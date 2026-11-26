<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Declarar un equipo no recuperado (A48, `POST /inventario/unidades/:id/declarar-no-recuperada`,
 * `inventario.cobrar_equipo`). Lo decide una persona, nunca el técnico: exige intentos de técnicos
 * distintos o un contacto con el cliente (la API responde 422 `intentos_insuficientes` si no). Lo da
 * de baja como pérdida y, con monto, cobra al cliente el cargo «Equipo no devuelto».
 */
const props = defineProps<{
    unidad: Pick<UnidadInventario, 'id' | 'serie' | 'mac' | 'producto_nombre' | 'costo'> | null
    /** Intentos, técnicos distintos y contactos (de `pendientes-declarar`), si se conocen. */
    pendiente?: Pick<PendienteNoRecuperado, 'intentos' | 'tecnicos_distintos' | 'contactos'> | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [unidad: UnidadNoRecuperada] }>()

const esquema = z.object({
    motivo: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(500),
    cobrar: z.boolean(),
    monto: z.string().trim(),
}).refine(d => !d.cobrar || /^\d{1,12}(\.\d{1,2})?$/.test(d.monto), { path: ['monto'], message: 'Escribe el monto a cobrar' })

const idFormulario = useId()
const estado = reactive({ motivo: '', cobrar: true, monto: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { motivo: '', cobrar: true, monto: props.unidad?.costo ?? '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

const falta = computed(() => (props.pendiente ? faltaParaDeclarar(props.pendiente) : null))

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    if (!props.unidad) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useUnidadesInventario().declararNoRecuperada(props.unidad.id, {
        motivo: evento.data.motivo,
        monto: evento.data.cobrar ? evento.data.monto : null,
        concepto_id: null,
        fecha: null,
    }, clave)
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
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                texto="Declarar no recuperado"
                icono="i-lucide-circle-x"
                tipo="peligro"
            />
        </template>
        <template #description>
            {{ unidad ? `${unidad.producto_nombre} · ${identificacionUnidad(unidad)}` : '' }}
        </template>
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Se da de baja como pérdida"
                    :description="falta ?? `${pendiente ? `${pendiente.intentos} intentos de ${pendiente.tecnicos_distintos} técnicos y ${pendiente.contactos} contactos. ` : ''}No se deshace.`"
                    data-prueba="no-recuperado-aviso"
                />
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: el cliente se mudó y no responde"
                        class="w-full"
                        data-prueba="no-recuperado-motivo"
                    />
                </UFormField>
                <USwitch
                    v-model="estado.cobrar"
                    label="Cobrar al cliente «Equipo no devuelto»"
                    description="Se factura en la cuenta del cliente del servicio."
                />
                <UFormField
                    v-if="estado.cobrar"
                    label="Monto (con IVA)"
                    name="monto"
                    required
                >
                    <UInput
                        v-model="estado.monto"
                        inputmode="decimal"
                        class="w-full"
                        data-prueba="no-recuperado-monto"
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
                    label="Declarar no recuperado"
                    icon="i-lucide-circle-x"
                    color="error"
                    :loading="enviando"
                    data-prueba="no-recuperado-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
