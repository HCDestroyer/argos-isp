<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Recibir de vuelta un equipo en comodato o por recuperar (`POST /servicios/:id/equipos/:unidadId/devolver`,
 * `inventario.devolver_comodato`): la bodega que lo recibe y si entra a revisión. Vuelve usado a su
 * valor en libros; el activo se da de baja sin resultado.
 */
const props = defineProps<{
    unidad: Pick<UnidadInventario, 'id' | 'serie' | 'mac' | 'servicio_id' | 'empresa_id'> | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [unidad: UnidadInventario] }>()

const esquema = z.object({
    bodega_id: z.number({ message: 'Elige la bodega' }).int().positive('Elige la bodega'),
    en_reparacion: z.boolean(),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
})

const idFormulario = useId()
const estado = reactive<{ bodega_id: number | undefined, en_reparacion: boolean, motivo: string }>({ bodega_id: undefined, en_reparacion: false, motivo: '' })
const bodegas = shallowRef<SelectItem[]>([])
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, async (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, { bodega_id: undefined, en_reparacion: false, motivo: '' })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    const r = await useBodegas().activas()
    bodegas.value = r.ok ? r.data.filter(b => b.empresa_id === props.unidad?.empresa_id && !esBodegaTransito(b)).map(b => ({ label: b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono })) : []
    if (!r.ok) {
        problema.value = r.problema
    }
})

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    if (!props.unidad?.servicio_id) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useEquiposServicio().devolver(props.unidad.servicio_id, props.unidad.id, {
        bodega_id: evento.data.bodega_id,
        condicion: 'usado',
        en_reparacion: evento.data.en_reparacion,
        fecha: null,
        motivo: evento.data.motivo || null,
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
        :title="unidad ? `Recibir ${identificacionUnidad(unidad)}` : 'Recibir equipo'"
        description="Vuelve usado a la bodega a su valor en libros."
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
                <UFormField
                    label="Bodega que lo recibe"
                    name="bodega_id"
                    required
                >
                    <USelect
                        :model-value="estado.bodega_id"
                        :items="bodegas"
                        placeholder="Elige la bodega"
                        class="w-full"
                        data-prueba="recibir-bodega"
                        @update:model-value="v => estado.bodega_id = typeof v === 'number' ? v : undefined"
                    />
                </UFormField>
                <USwitch
                    v-model="estado.en_reparacion"
                    label="Entra a revisión"
                    description="Se prueba en bodega antes de volver a prestarlo."
                />
                <UFormField
                    label="Nota"
                    name="motivo"
                >
                    <UInput
                        v-model="estado.motivo"
                        class="w-full"
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
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Recibir en bodega"
                    icon="i-lucide-package-check"
                    :loading="enviando"
                    data-prueba="recibir-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
