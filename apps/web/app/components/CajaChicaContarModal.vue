<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Contar la caja chica (tablero PlanCajas, ventana «Contar»; B9, `POST /cajas/:id/contar`,
 * `caja_chica.contar`): conteo sorpresa que puede pedir contabilidad sin aviso. Muestra si el
 * efectivo contado más los comprobantes da el fondo fijo; si falta o sobra, el motivo es
 * obligatorio y la diferencia queda a cargo del encargado.
 */
const props = defineProps<{
    caja: EstadoCajaChica
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [conteo: ConteoCaja]
}>()

const toast = useToast()
const formulario = useTemplateRef('formulario')
const esperado = computed(() => new Decimal(props.caja.efectivo))
const esquema = computed(() => esquemaContarCaja(esperado.value))
const estado = reactive<EntradaConteo>({ contado: '', motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const contado = computed(() => (/^\d{1,12}(\.\d{1,2})?$/.test(estado.contado.trim()) ? new Decimal(estado.contado.trim()) : null))
const diferencia = computed(() => (contado.value ? contado.value.minus(esperado.value) : null))
const total = computed(() => (contado.value ? contado.value.plus(props.caja.comprobantes.monto) : null))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { contado: '', motivo: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<EntradaConteo>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCajaChica().contar(props.caja.caja_id, {
        contado: new Decimal(evento.data.contado).toFixed(2),
        motivo: evento.data.motivo.trim() || null,
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
            clave = nuevaClaveIdempotencia()
        }
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).filter(e => e.name === 'contado' || e.name === 'motivo'))
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    const dif = new Decimal(resultado.data.diferencia)
    toast.add({
        title: dif.isZero() ? 'Conteo guardado: cuadra' : `Conteo guardado: ${dif.isNegative() ? 'falta' : 'sobra'} ${formatearQuetzales(dif.abs())}`,
        description: dif.isZero() ? undefined : `Queda a cargo de ${resultado.data.responsable_nombre ?? 'la persona encargada'}.`,
        color: dif.isZero() ? 'success' : 'warning',
        icon: dif.isZero() ? 'i-lucide-check' : 'i-lucide-triangle-alert',
    })
    emit('hecho', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[31.25rem]', header: 'items-start', footer: 'justify-end bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                texto="Contar la caja chica"
                icono="i-lucide-calculator"
            />
        </template>
        <template #description>
            <span class="ps-13">{{ caja.nombre }} · encargada {{ caja.encargado_nombre ?? 'sin asignar' }}</span>
        </template>

        <template #body>
            <UForm
                id="form-contar-caja-chica"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Efectivo que contaste"
                        name="contado"
                        required
                    >
                        <UInput
                            v-model="estado.contado"
                            inputmode="decimal"
                            placeholder="0.00"
                            autofocus
                            class="w-full"
                            data-prueba="contar-contado"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField label="Comprobantes en la caja">
                        <UInput
                            :model-value="formatearQuetzales(caja.comprobantes.monto)"
                            disabled
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <p
                    v-if="total && diferencia"
                    class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
                    :class="diferencia.isZero() ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'"
                    data-prueba="contar-resultado"
                >
                    <UIcon
                        :name="diferencia.isZero() ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                        class="size-4 shrink-0"
                    />
                    <span v-if="diferencia.isZero()">{{ formatearQuetzales(contado) }} + {{ formatearQuetzales(caja.comprobantes.monto) }} = {{ formatearQuetzales(total) }} · cuadra con el fondo.</span>
                    <span v-else>{{ diferencia.isNegative() ? 'Falta' : 'Sobra' }} {{ formatearQuetzales(diferencia.abs()) }}: debía haber {{ formatearQuetzales(caja.efectivo) }} en efectivo.</span>
                </p>
                <UFormField
                    v-if="diferencia && !diferencia.isZero()"
                    label="Motivo de la diferencia"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        autoresize
                        class="w-full"
                        aria-label="Motivo de la diferencia"
                        data-prueba="contar-motivo"
                    />
                </UFormField>
                <p class="text-sm text-muted">
                    Lo puede pedir contabilidad sin aviso. Si falta o sobra, queda a cargo de la persona encargada con su motivo.
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>

        <template #footer>
            <UButton
                label="Cancelar"
                color="neutral"
                variant="ghost"
                :disabled="enviando"
                @click="abierto = false"
            />
            <UButton
                type="submit"
                form="form-contar-caja-chica"
                label="Guardar conteo"
                icon="i-lucide-check"
                class="glow-brand rounded-full"
                :loading="enviando"
                data-prueba="contar-guardar"
            />
        </template>
    </UModal>
</template>
