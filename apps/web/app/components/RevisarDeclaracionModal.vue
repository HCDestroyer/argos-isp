<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Revisar una declaración (`POST /declaraciones/:id/revisar`, `declaraciones.revisar`). Pide una
 * confirmación escrita porque revisar **registra la liquidación** (asiento en el diario de impuestos) y
 * **bloquea los impuestos del mes**. Los errores dicen qué hacer: NCRE sin certificar, checks de
 * impuestos en anomalía, datos que cambiaron o el mes en curso.
 */
const props = defineProps<{
    declaracion: Declaracion
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [declaracion: Declaracion], checklist: [], recalcular: [] }>()

const { puede } = usePermisos()
const confirmo = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const mes = computed(() => etiquetaPeriodo(periodoDeclaracion(props.declaracion)))
const fechaLiquidacion = computed(() => (props.declaracion.sustitutiva ? 'con fecha de hoy, por la diferencia con lo ya liquidado' : `con fecha ${formatearFecha(props.declaracion.periodo_hasta)}`))

watch(abierto, (valor) => {
    if (valor) {
        confirmo.value = false
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function revisar() {
    enviando.value = true
    problema.value = null
    const resultado = await useDeclaraciones().revisar(props.declaracion.id, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
    clave = nuevaClaveIdempotencia()
}

function aChecklist() {
    abierto.value = false
    emit('checklist')
}

function aRecalcular() {
    abierto.value = false
    emit('recalcular')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Revisar ${etiquetaImpuestoDeclaracion(declaracion.impuesto)} de ${mes}`"
        :description="`Versión ${declaracion.version}${declaracion.sustitutiva ? ' (sustitutiva)' : ''}`"
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Revisar registra la liquidación y bloquea los impuestos del mes"
                    data-prueba="revisar-aviso"
                >
                    <template #description>
                        <ul class="mt-1 list-disc space-y-1 ps-4">
                            <li>Asiento de liquidación en el diario de impuestos {{ fechaLiquidacion }}.</li>
                            <li>Bloqueo de impuestos hasta el {{ formatearFecha(declaracion.periodo_hasta) }}: ningún asiento con impuesto podrá caer en {{ mes }} ni antes.</li>
                            <li>Antes verifica que el IVA de los libros cuadre con este borrador y que no haya NCRE sin certificar.</li>
                        </ul>
                    </template>
                </UAlert>
                <UCheckbox
                    v-model="confirmo"
                    :label="`Entiendo que se registra la liquidación y se bloquean los impuestos de ${mes}`"
                    data-prueba="revisar-confirmo"
                />
                <ProblemaDeclaracion
                    v-if="problema"
                    :problema="problema"
                    puede-recalcular
                    @checklist="aChecklist"
                    @recalcular="aRecalcular"
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
                    label="Revisar y liquidar"
                    icon="i-lucide-file-check"
                    :disabled="!confirmo || !puede('declaraciones.revisar')"
                    :loading="enviando"
                    data-prueba="revisar-confirmar"
                    @click="revisar"
                />
            </div>
        </template>
    </UModal>
</template>
