<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/** Aprueba una promesa pendiente (`POST /promesas/:id/aprobar`, `promesas.aprobar`) con nota opcional. */
const props = defineProps<{
    promesa: Promesa | null
    nombreCliente?: string
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    aprobada: [promesa: Promesa]
}>()

const nota = ref('')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        nota.value = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function aprobar() {
    if (!props.promesa) {
        return
    }
    if (nota.value.length > 500) {
        problema.value = { type: 'about:blank', title: 'Nota demasiado larga', status: 422, detail: 'Máximo 500 caracteres.' }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await usePromesas().aprobar(props.promesa.id, nota.value.trim() || null, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('aprobada', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Aprobar promesa"
        :description="promesa ? `Promesa #${promesa.id}${nombreCliente ? ` · ${nombreCliente}` : ''}` : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <div
                v-if="promesa"
                class="flex flex-col gap-4"
            >
                <p class="text-sm">
                    {{ formatearQuetzales(promesa.monto) }} para el {{ formatearFechaHora(promesa.vence_en) }}. Al aprobarla el servicio queda con
                    promesa activa y la API vuelve a evaluar su estado (si estaba cortado por deuda, se reactiva).
                </p>
                <EvaluacionPromesa :promesa="promesa" />
                <UFormField
                    label="Nota"
                    help="Opcional. Queda en la bitácora."
                >
                    <UTextarea
                        v-model="nota"
                        :rows="2"
                        :maxlength="500"
                        placeholder="Ej.: cliente con buen historial, lo autorizo"
                        class="w-full"
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
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    label="Aprobar"
                    icon="i-lucide-check"
                    color="success"
                    :loading="enviando"
                    @click="aprobar"
                />
            </div>
        </template>
    </UModal>
</template>
