<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Registrar depósito (tablero NuevoCajas, panel lateral; `POST /cajas/:id/depositar`,
 * `cajas.depositar`): el efectivo de una caja abierta va al banco con su boleta y queda en
 * tránsito hasta conciliar el estado de cuenta. Se elige la caja (con el efectivo que tiene según
 * el resumen del turno), la cuenta, la boleta, la fecha y el monto; abajo, si el monto coincide.
 *
 * La API deposita el efectivo de un turno abierto, uno por boleta: el tablero junta varios
 * cierres en una boleta, eso queda anotado como pendiente de la API.
 */
const props = defineProps<{
    /** Cajas abiertas que se pueden depositar, con su efectivo (`null` si no se pudo leer). */
    opciones: { caja: Caja, efectivo: Decimal | null }[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [deposito: Deposito]
}>()

const usuario = useUsuarioActual()
const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const elegida = ref<number | null>(null)
const opcion = computed(() => props.opciones.find(o => o.caja.id === elegida.value) ?? null)
const esquema = computed(() => esquemaDeposito(hoy, opcion.value?.efectivo ?? null))
const estado = reactive<EntradaDeposito>({ monto: '', boleta: '', fecha: hoy, cuenta_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const monto = computed(() => (/^\d{1,12}(\.\d{1,2})?$/.test(estado.monto.trim()) ? new Decimal(estado.monto.trim()) : null))
const coincide = computed(() => (monto.value && opcion.value?.efectivo ? monto.value.equals(opcion.value.efectivo) : null))

function elegir(id: number) {
    elegida.value = id
    const efectivo = opcion.value?.efectivo
    estado.monto = efectivo?.gt(0) ? efectivo.toFixed(2) : ''
}

watch(abierto, (valor) => {
    if (valor) {
        const primera = props.opciones[0]
        Object.assign(estado, { monto: '', boleta: '', fecha: hoy, cuenta_id: estado.cuenta_id })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        if (primera) {
            elegir(primera.caja.id)
        }
    }
})

async function enviar(evento: FormSubmitEvent<SalidaDeposito>) {
    if (!opcion.value) {
        problema.value = { type: 'about:blank', title: 'Elige la caja que deposita', status: 422 }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().depositar(opcion.value.caja.id, cuerpoDeposito(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
        clave = nuevaClaveIdempotencia()
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name))
    formulario.value?.setErrors(errores)
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[28.75rem] sm:m-4 sm:rounded-[1.375rem] sm:h-[calc(100dvh-2rem)]', footer: 'justify-between' }"
    >
        <template #title>
            <ModalTitulo
                texto="Registrar depósito"
                icono="i-lucide-landmark"
            />
        </template>
        <template #description>
            <span class="ps-13">Efectivo de la caja al banco</span>
        </template>

        <template #body>
            <UForm
                id="form-deposito-caja"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Caja que deposita"
                    required
                >
                    <ul
                        v-if="opciones.length"
                        class="overflow-hidden rounded-2xl border border-(--ax-borde)"
                        role="radiogroup"
                        aria-label="Caja que deposita"
                    >
                        <li
                            v-for="o in opciones"
                            :key="o.caja.id"
                            class="border-b border-(--ax-borde) last:border-b-0"
                        >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                block
                                role="radio"
                                :aria-checked="elegida === o.caja.id"
                                class="justify-start gap-3 rounded-none px-3 py-3 text-start"
                                :class="elegida === o.caja.id ? 'bg-primary/5' : ''"
                                :data-deposito-caja="o.caja.id"
                                @click="elegir(o.caja.id)"
                            >
                                <UIcon
                                    :name="elegida === o.caja.id ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                                    class="size-5 shrink-0"
                                    :class="elegida === o.caja.id ? 'text-primary' : 'text-dimmed'"
                                />
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="font-semibold text-highlighted">{{ o.caja.nombre }}</span>
                                    <span class="text-xs text-muted">{{ o.caja.turno_abierto_por_nombre ?? o.caja.cajero_nombre ?? 'Turno abierto' }}</span>
                                </span>
                                <span class="font-bold tabular-nums text-highlighted">{{ o.efectivo ? formatearQuetzales(o.efectivo) : '—' }}</span>
                            </UButton>
                        </li>
                    </ul>
                    <p
                        v-else
                        class="text-sm text-muted"
                    >
                        No hay cajas abiertas: el efectivo se deposita mientras el turno está abierto.
                    </p>
                </UFormField>

                <UFormField
                    label="Cuenta bancaria"
                    name="cuenta_id"
                    required
                >
                    <CuentaBancoSelect v-model="estado.cuenta_id" />
                </UFormField>
                <div class="grid grid-cols-2 gap-3">
                    <UFormField
                        label="Número de boleta"
                        name="boleta"
                        required
                    >
                        <UInput
                            v-model="estado.boleta"
                            placeholder="impreso en la boleta"
                            class="w-full"
                            data-prueba="deposito-boleta"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha del depósito"
                        name="fecha"
                        required
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Monto de la boleta"
                        name="monto"
                        required
                        help="Debe coincidir con el efectivo de la caja"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                            data-prueba="deposito-monto"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField label="Depositó">
                        <UInput
                            :model-value="usuario?.nombre ?? ''"
                            disabled
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <p
                    v-if="coincide !== null && opcion?.efectivo"
                    class="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
                    :class="coincide ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'"
                    data-prueba="deposito-efectivo"
                >
                    <UIcon
                        :name="coincide ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                        class="size-4"
                    />
                    {{ coincide ? `Monto igual al efectivo de la caja: ${formatearQuetzales(opcion.efectivo)}` : `El efectivo de la caja es ${formatearQuetzales(opcion.efectivo)}: el resto se queda en la caja` }}
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
                form="form-deposito-caja"
                label="Registrar depósito"
                icon="i-lucide-check"
                class="glow-brand rounded-full"
                :loading="enviando"
                :disabled="!opciones.length"
            />
        </template>
    </USlideover>
</template>
