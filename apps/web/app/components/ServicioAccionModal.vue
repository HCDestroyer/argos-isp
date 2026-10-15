<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Confirmación con motivo de una acción explícita del servicio (`POST /servicios/:id/suspender`…).
 * Una `Idempotency-Key` por apertura del modal: reintentar tras un error de red no duplica la
 * acción. Si la API responde 501 o 422, el error se muestra aquí y el modal sigue abierto.
 */
const props = defineProps<{
    servicio: Servicio
    accion: PresentacionAccionServicio | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [servicio: Servicio, accion: PresentacionAccionServicio]
}>()

const estado = reactive<{ motivo: string }>({ motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.motivo = ''
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
})

async function confirmar(evento: FormSubmitEvent<DatosMotivo>) {
    if (!props.accion) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useServicios().ejecutar(props.servicio.id, props.accion.accion, evento.data.motivo, claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data, props.accion)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="accion ? `${accion.confirmar}` : ''"
        :description="servicio.user_ppp"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="accion"
                id="form-accion-servicio"
                :schema="esquemaMotivo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="confirmar"
            >
                <UAlert
                    :color="accion.color === 'error' ? 'error' : 'neutral'"
                    variant="subtle"
                    :icon="accion.icono"
                    :description="accion.efecto"
                />

                <UAlert
                    v-if="accion.accion === 'suspender'"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-hand"
                    title="Es una suspensión manual"
                    description="El corte automático y los pagos no lo reactivarán: aunque el cliente pague, sigue suspendido hasta que alguien use Reactivar."
                    data-prueba="aviso-suspender-manual"
                />
                <UAlert
                    v-else-if="accion.accion === 'reactivar' && servicio.suspension_manual"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-hand"
                    title="Quita la suspensión manual"
                    :description="servicio.suspension_manual_motivo ? `Se suspendió a mano por: ${servicio.suspension_manual_motivo}` : 'Se suspendió a mano.'"
                />

                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="3"
                        autofocus
                        placeholder="Ej.: solicitud del cliente por viaje"
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
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="accion"
                    type="submit"
                    form="form-accion-servicio"
                    :label="accion.confirmar"
                    :icon="accion.icono"
                    :color="accion.color"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
