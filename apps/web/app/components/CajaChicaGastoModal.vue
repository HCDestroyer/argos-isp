<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Gasto de caja chica (tablero PlanCajas, ventana «Gasto»; B9, `POST /cajas/:id/gastos`,
 * `caja_chica.registrar_gasto`): monto, tipo de gasto, en qué se gastó y el comprobante
 * obligatorio (foto del ticket, factura o recibo firmado). Sin tope por gasto (decisión del PM del
 * 26 nov): el único límite es el efectivo de la caja. Con factura a nombre de la empresa, después
 * se registra como compra para no perder el IVA («Registrar la compra»).
 */
const props = defineProps<{
    caja: EstadoCajaChica
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [gasto: GastoCajaChica]
}>()

const toast = useToast()
const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const efectivo = computed(() => new Decimal(props.caja.efectivo))
const esquema = computed(() => esquemaGastoCajaChica(efectivo.value))
const estado = reactive<EntradaGastoCajaChica>({ monto: '', categoria: 'otros', descripcion: '', con_factura: false, archivo: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsCategoria = (['vehiculos', 'otros', 'energia', 'transito', 'alquileres', 'nomina'] as const).map(c => ({ label: CATEGORIAS_EGRESO[c], value: c }))
const itemsFactura = [
    { label: 'No, es un ticket o recibo', value: 'no' },
    { label: 'Sí, con NIT de la empresa', value: 'si' },
]
const factura = computed({
    get: () => (estado.con_factura ? 'si' : 'no'),
    set: (valor: string | number) => {
        estado.con_factura = valor === 'si'
    },
})

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { monto: '', categoria: 'otros', descripcion: '', con_factura: false, archivo: null })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<EntradaGastoCajaChica>) {
    const archivo = evento.data.archivo
    if (!archivo) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCajaChica().registrarGasto(props.caja.caja_id, {
        monto: new Decimal(evento.data.monto).toFixed(2),
        categoria: evento.data.categoria,
        descripcion: evento.data.descripcion.trim(),
        con_factura: evento.data.con_factura,
    }, archivo, clave)
    enviando.value = false
    if (!resultado.ok) {
        if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
            clave = nuevaClaveIdempotencia()
        }
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name)))
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    const { egreso, pasar_a_compras: aCompras } = resultado.data
    toast.add({
        title: `Gasto ${numeroMovimiento('G', egreso.id)} registrado`,
        description: aCompras ? 'Tiene factura: regístralo como compra para aprovechar el IVA.' : `Quedan ${formatearQuetzales(resultado.data.caja_chica.efectivo)} en la caja chica.`,
        color: 'success',
        icon: 'i-lucide-receipt',
        actions: aCompras && puede('compras.registrar') ? [{ label: 'Registrar la compra', to: `/compras/nueva?egreso=${egreso.id}` }] : undefined,
    })
    emit('hecho', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[33.75rem]', header: 'items-start', footer: 'justify-end bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                texto="Gasto de caja chica"
                icono="i-lucide-file-text"
            />
        </template>
        <template #description>
            <span class="ps-13">{{ caja.nombre }} · hay {{ formatearQuetzales(caja.efectivo) }}</span>
        </template>

        <template #body>
            <UForm
                id="form-gasto-caja-chica"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                        :help="`Sin tope por gasto: hasta ${formatearQuetzales(caja.efectivo)}`"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="0.00"
                            autofocus
                            class="w-full"
                            data-prueba="gasto-monto"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Tipo de gasto"
                        name="categoria"
                        required
                    >
                        <USelect
                            v-model="estado.categoria"
                            :items="itemsCategoria"
                            class="w-full"
                            data-prueba="gasto-categoria"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="En qué se gastó"
                    name="descripcion"
                    required
                >
                    <UInput
                        v-model="estado.descripcion"
                        placeholder="Combustible moto 2"
                        class="w-full"
                        data-prueba="gasto-descripcion"
                    />
                </UFormField>
                <UFormField
                    label="Comprobante"
                    name="archivo"
                    required
                    help="Obligatorio: foto del ticket, factura o recibo firmado (JPG, PNG, WebP o PDF, hasta 5 MB)"
                >
                    <UFileUpload
                        v-model="estado.archivo"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        label="Tomar o subir foto"
                        icon="i-lucide-image"
                        layout="list"
                        class="w-full"
                        data-prueba="gasto-comprobante"
                    />
                </UFormField>
                <UFormField label="¿Tiene factura a nombre de la empresa?">
                    <UTabs
                        v-model="factura"
                        :items="itemsFactura"
                        :content="false"
                        color="neutral"
                        variant="pill"
                        class="w-full"
                        aria-label="¿Tiene factura a nombre de la empresa?"
                        :ui="{ list: 'rounded-xl bg-(--ax-panel) p-1', trigger: 'flex-1 rounded-lg px-3 data-[state=active]:bg-(--ax-tarjeta) data-[state=active]:text-primary data-[state=active]:shadow-sm' }"
                    />
                    <template #help>
                        Con factura se registra como compra pagada con caja chica, para aprovechar el IVA.
                    </template>
                </UFormField>
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
                form="form-gasto-caja-chica"
                label="Registrar gasto"
                icon="i-lucide-check"
                class="glow-brand rounded-full"
                :loading="enviando"
                data-prueba="gasto-registrar"
            />
        </template>
    </UModal>
</template>
