<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Revisar una declaración (`POST /declaraciones/:id/revisar`, `declaraciones.revisar`). Pide una
 * confirmación escrita porque, según el impuesto, revisar **registra la liquidación** y **bloquea los
 * impuestos del mes** (IVA y PC), solo bloquea (retenciones), solo liquida (ISR e ISO) o fija el ISR
 * que tomará el cierre anual (ISR anual). Los errores dicen qué hacer: NCRE sin certificar, checks de
 * impuestos en anomalía, datos que cambiaron, el mes en curso o un mes posterior que no se puede
 * rectificar (409 `cascada_bloqueada`). Una sustitutiva avisa que puede rectificar los meses posteriores
 * ya revisados (H34): la respuesta trae `cascada[]` y la ficha la muestra.
 */
const props = defineProps<{
    declaracion: Declaracion
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [declaracion: DeclaracionRevisada], checklist: [], recalcular: [] }>()

const { puede } = usePermisos()
const confirmo = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const mes = computed(() => etiquetaPeriodoDeclaracion(props.declaracion))
const ivaOPc = computed(() => esIvaOPc(props.declaracion.impuesto))
const efecto = computed(() => efectoRevision(props.declaracion.impuesto, mes.value))
const confirmacion = computed(() => (ivaOPc.value
    ? `Entiendo que se registra la liquidación y se bloquean los impuestos de ${mes.value}`
    : `Entiendo lo que hace revisar ${etiquetaImpuestoDeclaracion(props.declaracion.impuesto)} de ${mes.value}`))
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
                    :title="efecto.titulo"
                    data-prueba="revisar-aviso"
                >
                    <template #description>
                        <ul
                            v-if="ivaOPc"
                            class="mt-1 list-disc space-y-1 ps-4"
                        >
                            <li>Asiento de liquidación en el diario de impuestos {{ fechaLiquidacion }}.</li>
                            <li>Bloqueo de impuestos hasta el {{ formatearFecha(declaracion.periodo_hasta) }}: ningún asiento con impuesto podrá caer en {{ mes }} ni antes.</li>
                            <li>Antes verifica que el IVA de los libros cuadre con este borrador y que no haya NCRE sin certificar.</li>
                        </ul>
                        <ul
                            v-else
                            class="mt-1 list-disc space-y-1 ps-4"
                        >
                            <li
                                v-for="(punto, i) in efecto.puntos"
                                :key="i"
                            >
                                {{ punto }}
                            </li>
                        </ul>
                    </template>
                </UAlert>
                <UAlert
                    v-if="declaracion.sustitutiva && ivaOPc"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-git-branch"
                    title="Puede rectificar meses posteriores"
                    description="Si esta sustitutiva cambia el remanente que deja, en la misma operación se rectifican los meses siguientes ya revisados (una versión sustitutiva revisada de cada uno). Los que estaban presentados quedan por presentar como rectificativa. Si alguno no se puede rectificar, no se guarda nada."
                    data-prueba="revisar-cascada"
                />
                <UCheckbox
                    v-model="confirmo"
                    :label="confirmacion"
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
                    :label="sinAsiento(declaracion.impuesto) ? 'Revisar' : 'Revisar y liquidar'"
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
