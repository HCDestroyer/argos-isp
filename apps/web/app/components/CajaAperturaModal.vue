<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Abrir caja (tablero NuevoAbrirCaja, `POST /cajas/:id/abrir`, `cajas.abrir`): la caja, quién
 * la abre y el fondo inicial destacado. Debajo, lo que quedó en el cierre anterior (el
 * `fondo_siguiente` del último turno) y si coincide; montos rápidos («Igual que ayer») y «Contar
 * billetes y monedas». Con `opciones` (el cobro, sin caja elegida) se elige cuál abrir.
 */
const props = withDefaults(defineProps<{
    caja?: Caja | null
    opciones?: Caja[]
}>(), {
    caja: null,
    opciones: () => [],
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [turno: TurnoCaja]
}>()

const usuario = useUsuarioActual()
const { puede } = usePermisos()
const estado = reactive<DatosApertura>({ fondo_inicial: '' })
const elegida = ref<number | undefined>(undefined)
const caja = computed<Caja | null>(() => props.caja ?? props.opciones.find(c => c.id === elegida.value) ?? null)
const itemsCaja = computed(() => (props.caja ? [props.caja] : props.opciones).map(c => ({ label: c.nombre, value: c.id })))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/** Lo que quedó en la caja al cerrar el turno anterior (`fondo_siguiente`), si se registró. */
const anterior = shallowRef<TurnoCaja | null>(null)
const quedo = computed(() => anterior.value?.fondo_siguiente ?? null)
const contando = ref(false)
const conteo = ref<ConteoEfectivo>({})

const fondo = computed(() => (/^\d{1,12}(\.\d{1,2})?$/.test(estado.fondo_inicial.trim()) ? new Decimal(estado.fondo_inicial.trim()) : null))
const coincide = computed(() => (quedo.value && fondo.value ? fondo.value.equals(quedo.value) : null))

const RAPIDOS = ['300', '1000']

async function cargarAnterior() {
    anterior.value = null
    const id = caja.value?.id
    if (!id || !puede('cajas.ver')) {
        return
    }
    const resultado = await useCajas().turnos(id)
    if (resultado.ok && caja.value?.id === id) {
        anterior.value = resultado.data.data.find(t => t.cerrado_en !== null) ?? null
    }
}

watch(abierto, (valor) => {
    if (valor) {
        elegida.value = props.opciones.length === 1 ? props.opciones[0]?.id : props.caja?.id
        estado.fondo_inicial = ''
        contando.value = false
        conteo.value = {}
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarAnterior()
    }
}, { immediate: true })

watch(() => caja.value?.id, () => {
    if (abierto.value) {
        void cargarAnterior()
    }
})

watch(conteo, (valor) => {
    if (contando.value) {
        estado.fondo_inicial = totalConteo(valor).toFixed(2)
    }
}, { deep: true })

function rapido(valor: string) {
    contando.value = false
    estado.fondo_inicial = new Decimal(valor).toFixed(2)
}

async function enviar(evento: FormSubmitEvent<DatosApertura>) {
    if (!caja.value) {
        problema.value = { type: 'about:blank', title: 'Elige la caja que vas a abrir', status: 422 }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().abrir(caja.value.id, new Decimal(evento.data.fondo_inicial).toFixed(2), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        void useMiCaja().refrescar()
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[32.5rem]', header: 'items-start', footer: 'bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                texto="Abrir caja"
                icono="i-lucide-wallet"
            />
        </template>
        <template #description>
            <span class="ps-13">Para cobrar necesitas tu caja abierta</span>
        </template>
        <template #actions>
            <span class="me-8 flex">
                <AyudaBoton solo-icono />
            </span>
        </template>

        <template #body>
            <UForm
                id="form-apertura-caja"
                :schema="esquemaApertura"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid grid-cols-2 gap-3">
                    <UFormField
                        label="Caja"
                        required
                    >
                        <USelect
                            v-model="elegida"
                            :items="itemsCaja"
                            :disabled="Boolean(props.caja) || itemsCaja.length < 2"
                            placeholder="Elige la caja"
                            class="w-full"
                            data-prueba="apertura-caja"
                        />
                    </UFormField>
                    <UFormField label="Cajero">
                        <UInput
                            :model-value="usuario ? `${usuario.nombre} (tú)` : ''"
                            disabled
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <UFormField
                    label="Fondo inicial"
                    name="fondo_inicial"
                    required
                    :ui="{ help: 'w-full' }"
                >
                    <UInput
                        v-model="estado.fondo_inicial"
                        inputmode="decimal"
                        placeholder="0.00"
                        autofocus
                        aria-label="Fondo inicial"
                        class="w-full"
                        :readonly="contando"
                        :ui="{ base: 'h-14 rounded-2xl border-2 border-primary ps-24 text-end text-3xl font-bold tabular-nums ring-4 ring-primary/10', leading: 'ps-4' }"
                    >
                        <template #leading>
                            <span class="text-sm font-semibold text-primary">Cuento</span>
                        </template>
                    </UInput>
                    <template #help>
                        <span
                            v-if="quedo"
                            class="flex w-full items-center justify-between gap-2"
                            data-prueba="apertura-anterior"
                        >
                            <span>Quedó en el cierre anterior: <strong class="tabular-nums">{{ formatearQuetzales(quedo) }}</strong></span>
                            <span
                                v-if="coincide !== null"
                                class="flex items-center gap-1 font-semibold"
                                :class="coincide ? 'text-success' : 'text-warning'"
                            >
                                <UIcon
                                    :name="coincide ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                                    class="size-4"
                                />
                                {{ coincide ? 'Coincide' : 'No coincide' }}
                            </span>
                        </span>
                        <span v-else>Efectivo con el que empieza la caja, para dar vuelto.</span>
                    </template>
                </UFormField>

                <div class="grid grid-cols-3 gap-2">
                    <UButton
                        label="Igual que ayer"
                        color="primary"
                        variant="soft"
                        class="justify-center rounded-xl py-2.5 font-bold"
                        :disabled="!quedo"
                        @click="quedo && rapido(quedo)"
                    />
                    <UButton
                        v-for="valor in RAPIDOS"
                        :key="valor"
                        :label="formatearQuetzales(valor).replace('.00', '')"
                        color="primary"
                        variant="soft"
                        class="justify-center rounded-xl py-2.5 font-bold"
                        @click="rapido(valor)"
                    />
                </div>

                <UButton
                    :label="contando ? 'Escribir el total' : 'Contar billetes y monedas'"
                    :icon="contando ? 'i-lucide-pencil' : 'i-lucide-banknote'"
                    color="primary"
                    variant="link"
                    class="self-start px-0"
                    :aria-expanded="contando"
                    data-prueba="apertura-contar"
                    @click="contando = !contando"
                />
                <div
                    v-if="contando"
                    class="max-h-72 overflow-y-auto rounded-xl bg-(--ax-panel) p-3"
                >
                    <CajaConteo
                        v-model="conteo"
                        :columnas="1"
                    />
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full items-center justify-between gap-2">
                <UButton
                    label="Ahora no"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-apertura-caja"
                    :label="fondo ? `Abrir caja con ${formatearQuetzales(fondo)}` : 'Abrir caja'"
                    icon="i-lucide-check"
                    color="success"
                    class="rounded-full px-5"
                    :loading="enviando"
                    data-prueba="confirmar-apertura"
                />
            </div>
        </template>
    </UModal>
</template>
