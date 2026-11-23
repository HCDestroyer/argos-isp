<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Decidir un intento de recuperación anterior a la verificación con Iris (tablero
 * PendIntentosRecuperacion, A3 `POST /inventario/intentos-recuperacion/:id/decidir`): «Aceptar:
 * cuenta» o «Descartar: no cuenta», con motivo. 409 `intento_ya_decidido` si alguien ya lo decidió.
 */
const props = defineProps<{
    intento: IntentoRecuperacionVerificado | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [decision: DecisionIntentoRecuperacion] }>()

const idFormulario = useId()
const estado = reactive<DatosDecisionIntento>({ aceptar: true, motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { aceptar: true, motivo: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

const opcion = computed({
    get: () => (estado.aceptar ? 'aceptar' : 'descartar'),
    set: (v: string | number) => {
        estado.aceptar = v === 'aceptar'
    },
})
const opciones = [
    { label: 'Aceptar: cuenta', value: 'aceptar', icon: 'i-lucide-check' },
    { label: 'Descartar: no cuenta', value: 'descartar', icon: 'i-lucide-circle-x' },
]

async function enviar(evento: FormSubmitEvent<DatosDecisionIntento>) {
    if (!props.intento) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useIntentosRecuperacion().decidir(props.intento.id, evento.data.aceptar, evento.data.motivo, clave)
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
                :texto="`Decidir el intento #${intento?.intento_n ?? ''}`"
                icono="i-lucide-info"
            />
        </template>
        <template #description>
            {{ intento?.actor_tecnico_nombre ?? 'El técnico' }} lo registró antes de que Iris verificara los intentos. Revisa la foto y la ubicación en Iris y decide.
        </template>
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquemaDecisionIntento"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UTabs
                    v-model="opcion"
                    :items="opciones"
                    :content="false"
                    variant="pill"
                    color="neutral"
                    class="w-full"
                    :ui="{
                        list: 'w-full rounded-xl bg-(--ax-panel) p-1',
                        indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                        trigger: 'flex-1 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                        leadingIcon: 'size-4',
                    }"
                    data-prueba="decision-opcion"
                />
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UInput
                        v-model="estado.motivo"
                        autofocus
                        placeholder="Ej.: la foto muestra la casa del cliente"
                        class="w-full"
                        data-prueba="decision-motivo"
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
                    type="submit"
                    :form="idFormulario"
                    label="Guardar decisión"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="decision-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
