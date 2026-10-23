<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Registra el pago de una declaración revisada o presentada (`POST /declaraciones/:id/registrar-pago`,
 * `declaraciones.pagar`): de una caja, un banco del libro o una cuenta bancaria propia de la misma
 * empresa. El monto lo pone la API (lo a pagar menos lo pagado por versiones anteriores); si se paga
 * después del vencimiento suma mora y, si se presentó tarde, la multa. El resultado se ve en la ficha.
 */
const props = defineProps<{
    declaracion: Declaracion
    /** Ya pagado por versiones anteriores del periodo (impuesto, sin mora ni multa). */
    pagadoAntes: string
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [declaracion: Declaracion] }>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const esquema = esquemaPagoDeclaracion(hoy)
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const vacio = (): EntradaPagoDeclaracion => ({ metodo: 'banco', caja_id: null, banco_id: null, cuenta_bancaria_id: null, fecha: '', boleta: '' })
const estado = reactive<EntradaPagoDeclaracion>(vacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const cajas = shallowRef<Caja[]>([])
const cuentas = shallowRef<CuentaBancaria[]>([])
const bancosLibro = shallowRef<BancoLibro[]>([])
const problemaCatalogos = ref<Problem | null>(null)

const empresa = computed(() => props.declaracion.empresa_id)
const itemsMetodo: SelectItem[] = Object.entries(METODOS_PAGO_DECLARACION).map(([value, label]) => ({ label, value }))
const itemsCaja = computed<SelectItem[]>(() => cajas.value.filter(c => c.activa && (c.empresa_id ?? 1) === empresa.value).map(c => ({ label: c.nombre, value: c.id })))
const itemsBanco = computed<SelectItem[]>(() => bancosLibro.value.filter(b => b.empresa_id === empresa.value).map(b => ({ label: b.nombre, value: b.id, description: `${b.cuenta_codigo} · ${b.cuenta_nombre}` })))
const itemsCuenta = computed<SelectItem[]>(() => cuentas.value.filter(c => c.activa && c.moneda === 'GTQ' && c.empresa_id === empresa.value).map(c => ({ label: `${c.banco_nombre} · ${c.alias}`, value: c.id, description: c.numero })))

const pendiente = computed(() => {
    const aPagar = totalDe(props.declaracion, 'a_pagar')
    return aPagar === null ? null : formatearQuetzales(new Decimal(aPagar).minus(props.pagadoAntes))
})
const fechaPago = computed(() => estado.fecha || hoy)
const tardio = computed(() => fechaPago.value > props.declaracion.vence_en)

async function cargarCatalogos() {
    problemaCatalogos.value = null
    const [rCajas, rCuentas, rBancos] = await Promise.all([
        puede('cajas.ver') ? useCajas().listar() : null,
        puede('cuentas_bancarias.ver') ? useCuentasBancarias().listar({ activa: true }) : null,
        puede('egresos.ver') ? useLibro().bancos() : null,
    ])
    cajas.value = rCajas?.ok ? rCajas.data : []
    cuentas.value = rCuentas?.ok ? rCuentas.data : []
    bancosLibro.value = rBancos?.ok ? rBancos.data : []
    problemaCatalogos.value = (rCajas && !rCajas.ok ? rCajas.problema : null)
        ?? (rCuentas && !rCuentas.ok ? rCuentas.problema : null)
        ?? (rBancos && !rBancos.ok ? rBancos.problema : null)
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, vacio())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
        void cargarCatalogos()
    }
})

async function enviar(evento: FormSubmitEvent<CuerpoPagoDeclaracion>) {
    enviando.value = true
    problema.value = null
    const resultado = await useDeclaraciones().registrarPago(props.declaracion.id, evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length) {
        formulario.value?.setErrors(errores)
        if (errores.every(e => e.name && e.name in estado)) {
            return
        }
    }
    problema.value = problemaDeclaracionLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar pago"
        :description="`${etiquetaImpuestoDeclaracion(declaracion.impuesto)} de ${etiquetaPeriodo(periodoDeclaracion(declaracion))} · versión ${declaracion.version}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="flex flex-col gap-1 rounded-lg border border-default p-3">
                    <span class="text-xs font-medium text-muted">Impuesto por pagar</span>
                    <span
                        class="text-lg font-semibold tabular-nums text-highlighted"
                        data-prueba="pago-pendiente"
                    >{{ pendiente ?? '—' }}</span>
                    <span class="text-xs text-muted">
                        Vence el {{ formatearFecha(declaracion.vence_en) }}.
                        <template v-if="tardio">Pagado el {{ formatearFecha(fechaPago) }} suma mora por cada día de atraso<template v-if="declaracion.fecha_presentacion && declaracion.fecha_presentacion > declaracion.vence_en"> y la multa por presentación tardía</template>: la API la calcula y queda en el pago.</template>
                    </span>
                </div>
                <ProblemaAlerta
                    v-if="problemaCatalogos"
                    :problema="problemaCatalogos"
                    :reintentar="cargarCatalogos"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Pagado con"
                        name="metodo"
                        required
                    >
                        <USelect
                            v-model="estado.metodo"
                            :items="itemsMetodo"
                            class="w-full"
                            data-prueba="pago-metodo"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha del pago"
                        name="fecha"
                        help="Vacía: hoy."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                            data-prueba="pago-fecha"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'caja'"
                        label="Caja"
                        name="caja_id"
                        required
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.caja_id"
                            :items="itemsCaja"
                            placeholder="Elige la caja"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'banco'"
                        label="Banco"
                        name="banco_id"
                        class="sm:col-span-2"
                        help="Sin elegir: el banco principal."
                    >
                        <USelect
                            v-model="estado.banco_id"
                            :items="itemsBanco"
                            placeholder="Banco principal"
                            class="w-full"
                            data-prueba="pago-banco"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'cuenta_bancaria'"
                        label="Cuenta bancaria"
                        name="cuenta_bancaria_id"
                        required
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.cuenta_bancaria_id"
                            :items="itemsCuenta"
                            placeholder="Elige la cuenta"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Boleta SAT"
                        name="boleta"
                        hint="Opcional"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.boleta"
                            class="w-full"
                            data-prueba="pago-boleta"
                        />
                    </UFormField>
                </div>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="pago-problema"
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
                    label="Registrar pago"
                    icon="i-lucide-banknote"
                    :disabled="!puede('declaraciones.pagar')"
                    :loading="enviando"
                    data-prueba="pago-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
