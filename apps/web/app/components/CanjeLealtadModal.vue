<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Canjear puntos por un premio desde el panel (`POST /lealtad/canjes`, `lealtad.canjear`): cliente,
 * uno de sus servicios (`servicios.ver`) y un premio activo; un descuento se puede aplicar a una
 * factura ya emitida (nota de crédito). El saldo del cliente se lee con `lealtad.ver`; la API decide
 * si alcanza (422 `saldo_insuficiente`) y deja el canje reservado o aplicado.
 */
const props = defineProps<{
    premios: readonly PremioLealtad[]
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ canjeado: [canje: CanjeLealtad] }>()

const { puede } = usePermisos()
const { empresaId } = useEmpresaActiva()

/** Espejo de `canjearValidator`: cliente, servicio y premio obligatorios; factura opcional. */
const esquema = z.object({
    cliente_id: z.number().int().min(1, 'Elige el cliente'),
    servicio_id: z.number({ message: 'Elige el servicio' }).int().min(1, 'Elige el servicio').nullable().refine(v => v !== null, 'Elige el servicio'),
    premio_id: z.number({ message: 'Elige el premio' }).int().min(1, 'Elige el premio').nullable().refine(v => v !== null, 'Elige el premio'),
    factura_id: z.number().int().min(1, 'Elige una factura de la lista').nullable(),
})
type Entrada = z.input<typeof esquema>
const estado = reactive<Entrada>({ cliente_id: 0, servicio_id: null, premio_id: null, factura_id: null })
const formulario = useTemplateRef('formulario')
const cliente = shallowRef<Cliente | null>(null)
const servicios = shallowRef<{ label: string, value: number }[]>([])
const saldo = ref<number | null>(null)
const problemaSaldo = ref<Problem | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { cliente_id: 0, servicio_id: null, premio_id: null, factura_id: null })
        cliente.value = null
        servicios.value = []
        saldo.value = null
        problemaSaldo.value = null
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function alElegirCliente(elegido: Cliente) {
    cliente.value = elegido
    estado.servicio_id = null
    const [lista, puntos] = await Promise.all([
        puede('servicios.ver') ? useServicios().listar({ cliente_id: elegido.id }) : null,
        usePuntosLealtad().deCliente(elegido.id),
    ])
    servicios.value = lista?.ok
        ? lista.data.data.filter(s => s.estado !== 'retirado').map(s => ({ label: `${s.user_ppp ?? `Servicio #${s.id}`} · ${s.plan_nombre ?? ''}`, value: s.id }))
        : []
    if (servicios.value.length === 1) {
        estado.servicio_id = servicios.value[0]?.value ?? null
    }
    if (puntos.ok) {
        const deEmpresa = puntos.data.saldos.find(s => s.empresa_id === empresaId.value) ?? puntos.data.saldos[0]
        saldo.value = deEmpresa?.saldo ?? 0
        problemaSaldo.value = null
    }
    else {
        saldo.value = null
        problemaSaldo.value = puntos.problema
    }
}

const itemsPremios = computed<SelectItem[]>(() => props.premios.filter(p => p.activo).map(p => ({
    label: `${p.nombre} · ${formatearPuntos(p.costo_puntos)}`,
    description: resumenPremio(p),
    value: p.id,
    disabled: saldo.value !== null && saldo.value < p.costo_puntos,
})))
const premio = computed(() => props.premios.find(p => p.id === estado.premio_id) ?? null)

function numeroONulo(valor: unknown): number | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const resultado = await useCanjesLealtad().crear({
        cliente_id: d.cliente_id,
        servicio_id: d.servicio_id as number,
        premio_id: d.premio_id as number,
        ...(d.factura_id && premio.value?.tipo === 'descuento_factura' ? { factura_id: d.factura_id } : {}),
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('canjeado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="Canjear puntos"
        description="Los puntos se descuentan al confirmar; un canje reservado se puede revertir."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-canje"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Cliente"
                    name="cliente_id"
                    required
                >
                    <ClienteSelector
                        v-model="estado.cliente_id"
                        :seleccionado="cliente"
                        class="w-full"
                        data-prueba="canje-cliente"
                        @elegido="alElegirCliente"
                    />
                </UFormField>
                <p
                    v-if="saldo !== null"
                    class="text-sm"
                    data-prueba="canje-saldo"
                >
                    Saldo: <span class="font-medium text-highlighted">{{ formatearPuntos(saldo) }}</span>
                </p>
                <ProblemaAlerta
                    v-if="problemaSaldo"
                    :problema="problemaSaldo"
                />
                <UFormField
                    label="Servicio"
                    name="servicio_id"
                    required
                >
                    <USelect
                        :model-value="estado.servicio_id ?? undefined"
                        :items="servicios"
                        :disabled="!cliente"
                        placeholder="Elige el servicio"
                        class="w-full"
                        data-prueba="canje-servicio"
                        @update:model-value="v => estado.servicio_id = numeroONulo(v)"
                    />
                </UFormField>
                <UFormField
                    label="Premio"
                    name="premio_id"
                    required
                >
                    <USelect
                        :model-value="estado.premio_id ?? undefined"
                        :items="itemsPremios"
                        :disabled="!cliente"
                        placeholder="Elige el premio"
                        class="w-full"
                        data-prueba="canje-premio"
                        @update:model-value="v => estado.premio_id = numeroONulo(v)"
                    />
                </UFormField>
                <UFormField
                    v-if="premio?.tipo === 'descuento_factura'"
                    label="Aplicar a una factura ya emitida"
                    name="factura_id"
                    help="Vacío = se descuenta de la próxima factura. Con número: nota de crédito sobre esa factura."
                >
                    <UInputNumber
                        :model-value="estado.factura_id ?? undefined"
                        :min="1"
                        placeholder="Próxima factura"
                        class="w-full"
                        @update:model-value="v => estado.factura_id = numeroONulo(v)"
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
                    form="form-canje"
                    label="Canjear"
                    icon="i-lucide-gift"
                    :loading="enviando"
                    data-prueba="canje-confirmar"
                />
            </div>
        </template>
    </USlideover>
</template>
