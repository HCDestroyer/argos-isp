<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * «Reabrir un mes cerrado» (tablero ContaCierres): el mes, el motivo y el aviso de que un libro
 * emitido con folio deja de coincidir. Queda en la bitácora con quien lo hizo y el motivo. Bajo el
 * bloqueo duro ningún mes se reabre: la API lo rechaza y el error se ve con su título. Solo en
 * escritorio (decisión 9 del PM): la página no ofrece el botón en el teléfono.
 */
const props = defineProps<{
    /** Meses cerrados (AAAA-MM), el más reciente primero. */
    cerrados: string[]
    /** Hasta dónde llega el bloqueo duro (AAAA-MM-DD), para decirlo. */
    duroHasta: string | null
}>()

const abierto = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
    hecho: [cierre: CierrePeriodo]
}>()

const { puede } = usePermisos()
const mes = ref<string | undefined>(undefined)
const motivo = ref('')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const items = computed<SelectItem[]>(() => props.cerrados.map((m, i) => ({ label: `${capitalizarConta(etiquetaPeriodo(m))}${i === 0 ? ' (el último cerrado)' : ''}`, value: m })))
const nombreMes = computed(() => (mes.value ? etiquetaPeriodo(mes.value).split(' ')[0] : 'el mes'))

watch(abierto, (valor) => {
    if (valor) {
        mes.value = props.cerrados[0]
        motivo.value = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

watch(mes, () => {
    clave = nuevaClaveIdempotencia()
    problema.value = null
})

async function reabrir() {
    if (!mes.value || motivo.value.trim().length < 5 || !puede('libro.reabrir_periodo')) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useLibro().reabrirPeriodo(mes.value, motivo.value.trim(), clave)
    enviando.value = false
    if (!r.ok) {
        problema.value = problemaBloqueoLegible(r.problema)
        return
    }
    abierto.value = false
    emit('hecho', r.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :ui="{ footer: 'justify-end' }"
    >
        <template #title>
            <ModalTitulo
                texto="Reabrir un mes cerrado"
                icono="i-lucide-rotate-ccw"
                tipo="advertencia"
            />
        </template>
        <template #description>
            Queda en la bitácora con tu nombre y el motivo
        </template>
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField
                    label="Mes"
                    :description="duroHasta ? `Hasta el ${formatearFecha(duroHasta)} hay bloqueo duro: esos meses no se pueden reabrir.` : undefined"
                >
                    <USelect
                        v-model="mes"
                        :items="items"
                        class="w-full"
                        data-prueba="reabrir-mes"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    required
                >
                    <UTextarea
                        v-model="motivo"
                        :rows="2"
                        autoresize
                        placeholder="Por ejemplo: faltó registrar una compra del mes"
                        class="w-full"
                        data-prueba="reabrir-motivo"
                    />
                </UFormField>
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :description="`Al reabrir, el libro de ${nombreMes} emitido con folio deja de coincidir. Tendrás que volver a cerrarlo y emitirlo.`"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>
        <template #footer>
            <UButton
                label="Cancelar"
                color="neutral"
                variant="ghost"
                @click="abierto = false"
            />
            <UButton
                :label="`Reabrir ${nombreMes}`"
                icon="i-lucide-rotate-ccw"
                color="warning"
                class="rounded-full"
                :loading="enviando"
                :disabled="!mes || motivo.trim().length < 5"
                data-prueba="confirmar-reabrir"
                @click="reabrir"
            />
        </template>
    </UModal>
</template>
