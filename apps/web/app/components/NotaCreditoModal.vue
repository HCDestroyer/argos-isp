<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Nota de crédito sobre el saldo de una factura (`POST /facturas/:id/notas-credito`,
 * `facturas.nota_credito`), con `Idempotency-Key` por apertura: por monto (en proporción a toda la
 * factura) o por línea (`lineas[] { linea_id, monto }`, un concepto concreto con su IVA). Con DTE
 * certificado sale como NCRE referida a la factura (su DTE queda en cola); sobre un aviso sin DTE
 * es una nota interna. Si deja al servicio sin deuda vencida, la API lo reactiva (`servicios[]`).
 */
const props = defineProps<{
    factura: FacturaDetalle
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [nota: NotaCreditoEmitida]
}>()

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const saldo = computed(() => new Decimal(props.factura.total).minus(props.factura.pagado))
const conNcre = computed(() => props.factura.fel_estado === 'certificado')

const modos: TabsItem[] = [
    { label: 'Por monto', value: 'monto', icon: 'i-lucide-percent' },
    { label: 'Por línea', value: 'lineas', icon: 'i-lucide-list' },
]

function montoValido(valor: string): boolean {
    return MONTO.test(valor.trim())
}

/**
 * Espejo de `notaCreditoValidator` (A3) + el saldo: motivo de 3 a 500; por monto, > 0 y hasta el
 * saldo; por línea, al menos una con monto > 0, cada una hasta su total y la suma hasta el saldo.
 */
const esquema = computed(() => z.object({
    modo: z.enum(['monto', 'lineas']),
    monto: z.string(),
    lineas: z.record(z.string(), z.string()),
    motivo: z.string().trim().min(3, 'Al menos 3 caracteres').max(500, 'Máximo 500 caracteres'),
}).superRefine((datos, ctx) => {
    if (datos.modo === 'monto') {
        const monto = datos.monto.trim()
        if (!montoValido(monto)) {
            ctx.addIssue({ code: 'custom', path: ['monto'], message: 'Escribe un monto con hasta 2 decimales, sin comas (ej. 150.00)' })
        }
        else if (!new Decimal(monto).gt(0)) {
            ctx.addIssue({ code: 'custom', path: ['monto'], message: 'El monto debe ser mayor que cero' })
        }
        else if (new Decimal(monto).gt(saldo.value)) {
            ctx.addIssue({ code: 'custom', path: ['monto'], message: `No puede pasar del saldo (${formatearQuetzales(saldo.value)})` })
        }
        return
    }
    let suma = new Decimal(0)
    let alguna = false
    for (const linea of props.factura.lineas) {
        const valor = (datos.lineas[String(linea.id)] ?? '').trim()
        if (!valor) {
            continue
        }
        const ruta = ['lineas', String(linea.id)]
        if (!montoValido(valor)) {
            ctx.addIssue({ code: 'custom', path: ruta, message: 'Monto con hasta 2 decimales' })
            continue
        }
        if (!new Decimal(valor).gt(0)) {
            ctx.addIssue({ code: 'custom', path: ruta, message: 'Mayor que cero' })
            continue
        }
        if (new Decimal(valor).gt(linea.total)) {
            ctx.addIssue({ code: 'custom', path: ruta, message: `Hasta ${formatearQuetzales(linea.total)}` })
            continue
        }
        alguna = true
        suma = suma.plus(valor)
    }
    if (!alguna) {
        ctx.addIssue({ code: 'custom', path: ['lineas'], message: 'Escribe el monto de al menos una línea' })
    }
    else if (suma.gt(saldo.value)) {
        ctx.addIssue({ code: 'custom', path: ['lineas'], message: `La suma (${formatearQuetzales(suma)}) pasa del saldo (${formatearQuetzales(saldo.value)})` })
    }
}))
type Datos = z.output<typeof esquema.value>

const formulario = useTemplateRef('formulario')
const estado = reactive<Datos>({ modo: 'monto', monto: '', lineas: {}, motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/** Suma de las líneas escritas (solo las válidas), para mostrar junto al saldo. */
const sumaLineas = computed(() => Object.values(estado.lineas)
    .filter(valor => montoValido(valor))
    .reduce((suma, valor) => suma.plus(valor.trim()), new Decimal(0)))

watch(abierto, (valor) => {
    if (valor) {
        estado.modo = 'monto'
        estado.monto = saldo.value.gt(0) ? saldo.value.toFixed(2) : ''
        estado.lineas = Object.fromEntries(props.factura.lineas.map(l => [String(l.id), '']))
        estado.motivo = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

watch(() => estado.modo, () => {
    // Otro modo es otra nota: otra clave.
    clave = nuevaClaveIdempotencia()
    problema.value = null
})

function cuerpoDe(datos: Datos): DatosNotaCredito {
    if (datos.modo === 'monto') {
        return { monto: new Decimal(datos.monto.trim()).toFixed(2), motivo: datos.motivo }
    }
    const lineas = props.factura.lineas
        .map(l => ({ linea_id: l.id, monto: (datos.lineas[String(l.id)] ?? '').trim() }))
        .filter(l => l.monto !== '')
        .map(l => ({ ...l, monto: new Decimal(l.monto).toFixed(2) }))
    return { lineas, motivo: datos.motivo }
}

async function enviar(evento: FormSubmitEvent<Datos>) {
    enviando.value = true
    problema.value = null
    const resultado = await useFacturas().notaCredito(props.factura.id, cuerpoDe(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    // `lineas.0.monto` de la API → el campo de esa línea.
    const errores = erroresDeFormulario(resultado.problema).map((e) => {
        const indice = /^lineas\.(\d+)\./.exec(e.name ?? '')?.[1]
        const linea = indice === undefined ? undefined : cuerpoDe(estado).lineas?.[Number(indice)]
        return linea ? { ...e, name: `lineas.${linea.linea_id}` } : e
    })
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = errores.length ? null : problemaFelLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="conNcre ? 'Nota de crédito (NCRE)' : 'Nota de crédito'"
        :description="`Factura #${factura.id} · saldo ${formatearQuetzales(saldo)}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-nota-credito"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UTabs
                    v-model="estado.modo"
                    :items="modos"
                    :content="false"
                    size="sm"
                    class="w-full"
                    data-prueba="nota-modo"
                />

                <UFormField
                    v-if="estado.modo === 'monto'"
                    label="Monto"
                    name="monto"
                    required
                    help="Por defecto, todo el saldo. Puede ser parcial; se reparte en proporción entre ingresos e IVA."
                >
                    <UInput
                        v-model="estado.monto"
                        inputmode="decimal"
                        class="w-full"
                        data-prueba="nota-monto"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>

                <UFormField
                    v-else
                    label="Montos por línea"
                    name="lineas"
                    help="Acredita conceptos concretos, cada uno con su IVA. Deja vacías las que no se acreditan."
                    data-prueba="nota-lineas"
                >
                    <ul class="flex flex-col divide-y divide-default rounded-lg border border-default">
                        <li
                            v-for="linea in factura.lineas"
                            :key="linea.id"
                            class="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                        >
                            <div class="flex min-w-0 flex-col">
                                <span class="text-sm text-highlighted">{{ linea.concepto }}</span>
                                <span class="text-xs text-muted">Total {{ formatearQuetzales(linea.total) }} · IVA {{ formatearQuetzales(linea.iva) }}{{ linea.gravable ? '' : ' · exenta' }}</span>
                            </div>
                            <UFormField
                                :name="`lineas.${linea.id}`"
                                class="sm:w-36"
                            >
                                <UInput
                                    v-model="estado.lineas[String(linea.id)]"
                                    inputmode="decimal"
                                    placeholder="0.00"
                                    class="w-full"
                                    :aria-label="`Monto a acreditar de ${linea.concepto}`"
                                    :data-prueba="`nota-linea-${linea.id}`"
                                >
                                    <template #leading>
                                        <span class="text-sm text-muted">Q</span>
                                    </template>
                                </UInput>
                            </UFormField>
                        </li>
                    </ul>
                    <p class="mt-2 text-xs text-muted tabular-nums">
                        Suma {{ formatearQuetzales(sumaLineas) }} de un saldo de {{ formatearQuetzales(saldo) }}
                    </p>
                </UFormField>

                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Días sin servicio por falla en la zona"
                        class="w-full"
                        data-prueba="nota-motivo"
                    />
                </UFormField>
                <p
                    class="text-xs text-muted"
                    data-prueba="nota-fel"
                >
                    <template v-if="conNcre">
                        La factura tiene DTE certificado ({{ factura.fel_serie ?? '—' }} · {{ factura.fel_numero ?? '—' }}): la nota sale como NCRE referida a ella. El asiento se registra ya y la NCRE queda en cola para el certificador.
                    </template>
                    <template v-else>
                        La factura no tiene DTE certificado: es una nota interna (sin NCRE) que baja el saldo y la cuenta del cliente con su asiento.
                    </template>
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="nota-error"
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
                    form="form-nota-credito"
                    label="Emitir nota de crédito"
                    icon="i-lucide-file-minus"
                    :loading="enviando"
                    data-prueba="nota-emitir"
                />
            </div>
        </template>
    </UModal>
</template>
