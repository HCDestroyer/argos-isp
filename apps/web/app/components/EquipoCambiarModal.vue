<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import type * as z from 'zod'

/**
 * «Cambiar equipo» en un solo paso (tablero NuevoInventario, A48 `POST /servicios/:id/equipos/cambiar`):
 * por qué se cambia, el que sale y el que entra (escaneado o buscado entre los disponibles), qué
 * pasa con el que sale y, si fue por mal uso, la propuesta de cobrarlo al cliente. El cobro solo se
 * **propone**: lo aprueba o rechaza una persona con `inventario.cobrar_equipo` en la cola de cobros.
 * Un equipo dañado o en garantía nunca vuelve como «funciona».
 */
const props = defineProps<{
    /** El que sale: en comodato en un servicio. */
    unidad: Pick<UnidadInventario, 'id' | 'producto_id' | 'producto_nombre' | 'serie' | 'mac' | 'servicio_id' | 'cliente_id'> | null
    /** Texto del servicio para el subtítulo («S-000412 · José López»). */
    contexto?: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [cambio: CambioEquipo] }>()

const idFormulario = useId()
const estado = reactive<Omit<EntradaCambioEquipo, 'entra'> & { entra: number | undefined }>({ motivo: 'danado', entra: undefined, destino: 'revision', cobrar: false, nota: '' })
const busqueda = ref('')
const disponibles = shallowRef<UnidadInventario[]>([])
const buscando = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const entra = computed(() => disponibles.value.find(u => u.id === estado.entra) ?? null)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { motivo: 'danado', entra: undefined, destino: DESTINO_SUGERIDO.danado, cobrar: false, nota: '' })
        busqueda.value = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void buscar()
    }
})

watch(() => estado.motivo, (motivo) => {
    if (!destinoPermitido(motivo, estado.destino)) {
        estado.destino = DESTINO_SUGERIDO[motivo]
    }
})

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void buscar(), 250)
})
onBeforeUnmount(() => clearTimeout(espera))

/** Disponibles del mismo producto (o de cualquiera si se escribe una serie o MAC). */
async function buscar() {
    if (!props.unidad) {
        return
    }
    buscando.value = true
    const q = busqueda.value.trim()
    const r = await useUnidadesInventario().listar({ estado: 'disponible', ...(q ? { q } : { producto_id: props.unidad.producto_id }), limit: 20 })
    buscando.value = false
    disponibles.value = r.ok ? r.data.data : []
    if (!r.ok) {
        problema.value = r.problema
    }
    else if (q && r.data.data.length === 1) {
        estado.entra = r.data.data[0]!.id
    }
}

const itemsEntra = computed(() => disponibles.value.map(u => ({ label: `${u.producto_nombre} · ${identificacionUnidad(u)}`, value: u.id, description: u.bodega_nombre ? `de ${u.bodega_nombre}` : undefined })))
const motivos = Object.entries(MOTIVOS_CAMBIO) as [MotivoCambio, string][]
const destinos = Object.entries(DESTINOS_SALE) as [DestinoSale, { etiqueta: string, descripcion: string }][]

async function enviar(evento: FormSubmitEvent<z.output<typeof esquemaCambioEquipo>>) {
    if (!props.unidad?.servicio_id) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useEquiposServicio().cambiar(props.unidad.servicio_id, cuerpoCambioEquipo(props.unidad.id, evento.data), clave)
    enviando.value = false
    if (!r.ok) {
        problema.value = r.problema
        return
    }
    abierto.value = false
    emit('hecho', r.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #title>
            <span class="flex items-center gap-3">
                <span class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl">
                    <UIcon
                        name="i-lucide-barcode"
                        class="size-5"
                    />
                </span>
                <span class="flex min-w-0 flex-col">
                    <span>Cambiar equipo</span>
                    <span
                        v-if="contexto"
                        class="truncate text-sm font-normal text-muted"
                    >{{ contexto }}</span>
                </span>
            </span>
        </template>
        <template #description>
            <span class="sr-only">Sale un equipo del servicio y entra otro en un solo paso.</span>
        </template>
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquemaCambioEquipo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="¿Por qué se cambia?"
                    name="motivo"
                    required
                >
                    <div
                        class="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label="Por qué se cambia"
                    >
                        <UButton
                            v-for="[valor, etiqueta] in motivos"
                            :key="valor"
                            :label="etiqueta"
                            :color="estado.motivo === valor ? 'primary' : 'neutral'"
                            :variant="estado.motivo === valor ? 'solid' : 'outline'"
                            role="radio"
                            :aria-checked="estado.motivo === valor"
                            class="rounded-full"
                            :data-motivo="valor"
                            @click="estado.motivo = valor"
                        />
                    </div>
                </UFormField>

                <div class="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <div class="rounded-xl border border-error/40 bg-error/5 p-3">
                        <p class="text-xs font-bold uppercase tracking-wide text-error">
                            Sale
                        </p>
                        <p class="font-semibold text-highlighted">
                            {{ unidad?.producto_nombre }}
                        </p>
                        <p class="font-mono text-xs text-muted">
                            {{ unidad ? identificacionUnidad(unidad) : '' }}
                        </p>
                    </div>
                    <UIcon
                        name="i-lucide-arrow-right"
                        class="mx-auto size-5 rotate-90 text-primary sm:rotate-0"
                    />
                    <div
                        class="rounded-xl border p-3"
                        :class="entra ? 'border-success/40 bg-success/5' : 'border-dashed border-(--ax-borde)'"
                        data-prueba="cambio-entra"
                    >
                        <p
                            class="text-xs font-bold uppercase tracking-wide"
                            :class="entra ? 'text-success' : 'text-muted'"
                        >
                            Entra
                        </p>
                        <template v-if="entra">
                            <p class="font-semibold text-highlighted">
                                {{ entra.producto_nombre }}
                            </p>
                            <p class="font-mono text-xs text-muted">
                                {{ identificacionUnidad(entra) }}{{ entra.bodega_nombre ? ` · de ${entra.bodega_nombre}` : '' }}
                            </p>
                        </template>
                        <p
                            v-else
                            class="text-sm text-muted"
                        >
                            Escanea o elige el equipo que entra
                        </p>
                    </div>
                </div>

                <UFormField
                    name="entra"
                    label="Equipo que entra"
                    required
                    :ui="{ label: 'sr-only' }"
                >
                    <div class="flex flex-col gap-2">
                        <UInput
                            v-model="busqueda"
                            icon="i-lucide-search"
                            placeholder="Escanear o buscar el equipo que entra"
                            aria-label="Escanear o buscar el equipo que entra por serie o MAC"
                            :loading="buscando"
                            class="w-full"
                            data-prueba="cambio-buscar"
                        >
                            <template #trailing>
                                <UIcon
                                    name="i-lucide-scan-barcode"
                                    class="size-4 text-muted"
                                />
                            </template>
                        </UInput>
                        <USelectMenu
                            v-model="estado.entra"
                            :items="itemsEntra"
                            value-key="value"
                            :search-input="false"
                            placeholder="O elige uno disponible"
                            class="w-full"
                            data-prueba="cambio-entra-elegir"
                        />
                    </div>
                </UFormField>

                <UFormField
                    label="¿Qué pasa con el que sale?"
                    name="destino"
                    required
                >
                    <URadioGroup
                        v-model="estado.destino"
                        :items="destinos.map(([valor, d]) => ({ value: valor, label: d.etiqueta, description: d.descripcion, disabled: !destinoPermitido(estado.motivo, valor) }))"
                        variant="card"
                        :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                        data-prueba="cambio-destino"
                    />
                </UFormField>

                <USwitch
                    v-model="estado.cobrar"
                    label="Cobrar al cliente (daño por mal uso)"
                    description="Solo se propone: lo aprueba quien decide los cobros de equipo."
                    data-prueba="cambio-cobrar"
                />

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs text-muted">
                    Queda en el historial de los dos equipos y en la bitácora del servicio
                </p>
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Cambiar equipo"
                    :icon="ICONOS.guardar"
                    :loading="enviando"
                    class="justify-center rounded-full"
                    data-prueba="cambio-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
