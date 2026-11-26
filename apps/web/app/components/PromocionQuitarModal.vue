<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «¿Quitar …?» (tableros PendPromociones y OperServicioFicha, ventana `qprom`): el servicio vuelve
 * ahora a la velocidad de su plan, sin cortar la sesión.
 * `POST /promociones-velocidad/:id/servicios/:servicioId/quitar` (`promociones_velocidad.quitar`)
 * con motivo opcional. Una `Idempotency-Key` por apertura.
 */
const props = defineProps<{
    promocionId: number
    promocionNombre: string
    servicioId: number
    /** «S-000412» o lo que identifique al servicio en el texto. */
    servicioEtiqueta: string
    /** Plan del servicio, para decir a qué velocidad vuelve (si se conoce). */
    planNombre?: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [promocion: PromocionVelocidad]
}>()

const motivo = ref('')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        motivo.value = ''
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
})

async function quitar() {
    enviando.value = true
    problema.value = null
    const texto = motivo.value.trim()
    const resultado = await usePromocionesVelocidad().quitar(props.promocionId, props.servicioId, texto || null, claveIdempotencia)
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
        :title="`¿Quitar «${promocionNombre}»?`"
        :description="`De ${servicioEtiqueta}`"
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                :texto="`¿Quitar «${promocionNombre}»?`"
                icono="i-lucide-x"
                tipo="advertencia"
            />
        </template>
        <template #body>
            <div class="flex flex-col gap-4">
                <p class="text-sm text-muted">
                    {{ servicioEtiqueta }} vuelve ahora a la velocidad {{ planNombre ? `de ${planNombre}` : 'de su plan' }}, sin cortar la sesión.
                </p>
                <UFormField
                    label="Motivo"
                    hint="Opcional"
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UInput
                        v-model="motivo"
                        placeholder="Ej.: el cliente la pidió quitar"
                        class="w-full"
                        :maxlength="500"
                        autofocus
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="No"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    label="Quitar"
                    icon="i-lucide-x"
                    color="error"
                    class="rounded-full"
                    :loading="enviando"
                    data-prueba="confirmar-quitar-promocion"
                    @click="quitar"
                />
            </div>
        </template>
    </UModal>
</template>
