<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Recibir una entrega (tablero PlanCajas, ventana «Recibir la entrega E-031»; B1): quien recibe
 * cuenta y confirma con su usuario. «Recibí Q …» (`cajas.recibir_entrega`) pasa el efectivo a su
 * custodia; si cuenta distinto, la diferencia queda a cargo de quien entregó y pide el motivo.
 * «No lo recibí» (`cajas.rechazar_entrega`) pide por qué y el efectivo sigue a nombre del cajero.
 */
const props = defineProps<{
    entrega: EntregaCaja
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [entrega: EntregaCaja]
}>()

const { puede } = usePermisos()
const toast = useToast()
const formulario = useTemplateRef('formulario')
const entregado = computed(() => new Decimal(props.entrega.monto))
const esquema = computed(() => esquemaRecibirEntrega(entregado.value))
const estado = reactive<EntradaConteo>({ contado: '', motivo: '' })
const rechazando = ref(false)
const motivoRechazo = ref('')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const contado = computed(() => (/^\d{1,12}(\.\d{1,2})?$/.test(estado.contado.trim()) ? new Decimal(estado.contado.trim()) : null))
const diferencia = computed(() => (contado.value ? contado.value.minus(entregado.value) : null))

watch(abierto, (valor) => {
    if (valor) {
        estado.contado = props.entrega.monto
        estado.motivo = ''
        rechazando.value = false
        motivoRechazo.value = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

function fallo(resultado: Problem) {
    if (resultado.status >= 400 && resultado.status < 500 && resultado.status !== 409) {
        clave = nuevaClaveIdempotencia()
    }
    formulario.value?.setErrors(erroresDeFormulario(resultado).filter(e => e.name === 'contado' || e.name === 'motivo'))
    problema.value = resultado
}

async function recibir(evento: FormSubmitEvent<EntradaConteo>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCustodia().recibir(props.entrega.id, {
        contado: new Decimal(evento.data.contado).toFixed(2),
        motivo: evento.data.motivo.trim() || null,
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        fallo(resultado.problema)
        return
    }
    abierto.value = false
    toast.add({ title: `Recibiste ${formatearQuetzales(resultado.data.contado ?? resultado.data.monto)}`, description: 'El efectivo queda a tu nombre hasta que lo deposites.', color: 'success', icon: 'i-lucide-check' })
    emit('hecho', resultado.data)
}

async function rechazar() {
    if (motivoRechazo.value.trim().length < 3) {
        problema.value = { type: 'about:blank', title: 'Escribe por qué no lo recibiste', status: 422 }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCustodia().rechazar(props.entrega.id, motivoRechazo.value.trim(), clave)
    enviando.value = false
    if (!resultado.ok) {
        fallo(resultado.problema)
        return
    }
    abierto.value = false
    toast.add({ title: 'Entrega rechazada', description: `El efectivo sigue a nombre de ${props.entrega.entregado_por_nombre ?? 'quien entregó'}.`, color: 'warning', icon: 'i-lucide-circle-x' })
    emit('hecho', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[28.75rem]', header: 'items-start', footer: 'justify-between bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                :texto="`Recibir la entrega ${numeroMovimiento('E', entrega.id)}`"
                icono="i-lucide-shield-check"
                tipo="advertencia"
            />
        </template>
        <template #description>
            <span class="ps-13">{{ entrega.caja_nombre }} · {{ formatearFechaHora(entrega.created_at) }}</span>
        </template>

        <template #body>
            <UForm
                id="form-recibir-entrega"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="recibir"
            >
                <div>
                    <p class="text-sm text-muted">
                        {{ entrega.entregado_por_nombre ?? 'El cajero' }} ({{ entrega.caja_nombre }}) dice que te entrega:
                    </p>
                    <p
                        class="mt-1 text-3xl font-bold tabular-nums text-highlighted"
                        data-prueba="recibir-monto"
                    >
                        {{ formatearQuetzales(entrega.monto) }}
                    </p>
                </div>

                <template v-if="!rechazando">
                    <UFormField
                        label="Cuánto contaste tú"
                        name="contado"
                        required
                        help="Si no es igual, la diferencia queda a cargo de quien entrega y se avisa a contabilidad."
                    >
                        <UInput
                            v-model="estado.contado"
                            inputmode="decimal"
                            aria-label="Cuánto contaste tú"
                            class="w-full"
                            :ui="{ base: 'h-12 rounded-2xl border-2 border-primary text-end text-xl font-bold tabular-nums ring-4 ring-primary/10' }"
                            data-prueba="recibir-contado"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <p
                        v-if="diferencia && !diferencia.isZero()"
                        class="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning"
                        data-prueba="recibir-diferencia"
                    >
                        <UIcon
                            name="i-lucide-triangle-alert"
                            class="size-4 shrink-0"
                        />
                        {{ diferencia.isNegative() ? 'Falta' : 'Sobra' }} {{ formatearQuetzales(diferencia.abs()) }}: queda a cargo de {{ entrega.entregado_por_nombre ?? 'quien entregó' }}.
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
                        />
                    </UFormField>
                    <p class="text-sm text-muted">
                        Al confirmar, el efectivo pasa a tu nombre hasta que lo deposites.
                    </p>
                </template>
                <UFormField
                    v-else
                    label="¿Por qué no lo recibiste?"
                    required
                    help="El efectivo sigue a nombre de quien entregó. Puede entregarlo otra vez."
                >
                    <UTextarea
                        v-model="motivoRechazo"
                        :rows="2"
                        autoresize
                        autofocus
                        class="w-full"
                        aria-label="Por qué no lo recibiste"
                        data-prueba="rechazar-motivo"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>

        <template #footer>
            <template v-if="!rechazando">
                <UButton
                    v-if="puede('cajas.rechazar_entrega')"
                    label="No lo recibí"
                    color="error"
                    variant="soft"
                    :disabled="enviando"
                    data-prueba="no-lo-recibi"
                    @click="rechazando = true"
                />
                <span v-else />
                <UButton
                    v-if="puede('cajas.recibir_entrega')"
                    type="submit"
                    form="form-recibir-entrega"
                    :label="`Recibí ${contado ? formatearQuetzales(contado) : ''}`"
                    icon="i-lucide-check"
                    class="glow-brand rounded-full"
                    :loading="enviando"
                    data-prueba="recibi"
                />
            </template>
            <template v-else>
                <UButton
                    label="Atrás"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="rechazando = false"
                />
                <UButton
                    label="Confirmar que no lo recibí"
                    color="error"
                    icon="i-lucide-circle-x"
                    class="rounded-full"
                    :loading="enviando"
                    data-prueba="confirmar-rechazo"
                    @click="rechazar"
                />
            </template>
        </template>
    </UModal>
</template>
