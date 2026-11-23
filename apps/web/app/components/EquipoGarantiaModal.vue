<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import type * as z from 'zod'

/**
 * Garantía de un equipo (A48): `enviar` lo manda al proveedor desde revisión (proveedor, RMA y
 * vencimiento, `inventario.enviar_garantia`); `resolver` cierra la garantía con lo que pasó
 * (volvió reparada, cambiada por otra con su serie o MAC, o rechazada y de vuelta a revisión;
 * `inventario.resolver_garantia`). Sin kardex ni asiento: sigue en su bodega y a su costo.
 */
const props = defineProps<{
    modo: 'enviar' | 'resolver'
    unidad: Pick<UnidadInventario, 'id' | 'serie' | 'mac' | 'producto_nombre'> | null
    /** Resultado elegido desde la tarjeta («Volvió reparada», «Cambiada por otra», «Rechazada»). */
    resultado?: 'reparada' | 'reemplazada' | 'rechazada'
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [unidad: UnidadInventario] }>()

const idFormulario = useId()
const envio = reactive({ proveedor: '', rma: '', vence_en: '' })
const resolucion = reactive<{ resultado: 'reparada' | 'reemplazada' | 'rechazada', serie: string, mac: string, nota: string }>({ resultado: 'reparada', serie: '', mac: '', nota: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        const enUnMes = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
        Object.assign(envio, { proveedor: '', rma: '', vence_en: enUnMes })
        Object.assign(resolucion, { resultado: props.resultado ?? 'reparada', serie: '', mac: '', nota: '' })
        problema.value = null
    }
})

const titulo = computed(() => (props.modo === 'enviar' ? 'Enviar a garantía' : RESULTADOS_GARANTIA[resolucion.resultado].etiqueta))

async function enviarGarantia(evento: FormSubmitEvent<z.output<typeof esquemaGarantia>>) {
    if (!props.unidad) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useUnidadesInventario().enviarGarantia(props.unidad.id, { proveedor_id: null, proveedor_nombre: evento.data.proveedor, rma: evento.data.rma, vence_en: evento.data.vence_en, nota: null })
    terminar(r)
}

async function resolverGarantia(evento: FormSubmitEvent<z.output<typeof esquemaResolverGarantia>>) {
    if (!props.unidad) {
        return
    }
    enviando.value = true
    problema.value = null
    const d = evento.data
    const r = await useUnidadesInventario().resolverGarantia(props.unidad.id, {
        resultado: d.resultado,
        serie: d.resultado === 'reemplazada' ? d.serie || null : null,
        mac: d.resultado === 'reemplazada' ? d.mac || null : null,
        nota: d.nota || null,
    })
    terminar(r)
}

function terminar(r: Resultado<UnidadInventario>) {
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
        :title="titulo"
        :description="unidad ? `${unidad.producto_nombre} · ${identificacionUnidad(unidad)}` : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="modo === 'enviar'"
                :id="idFormulario"
                :schema="esquemaGarantia"
                :state="envio"
                class="flex flex-col gap-4"
                @submit="enviarGarantia"
            >
                <UFormField
                    label="Proveedor"
                    name="proveedor"
                    required
                >
                    <UInput
                        v-model="envio.proveedor"
                        placeholder="Ej.: Distribuidora Red"
                        class="w-full"
                        data-prueba="garantia-proveedor"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Número de RMA"
                        name="rma"
                        required
                    >
                        <UInput
                            v-model="envio.rma"
                            class="w-full"
                            data-prueba="garantia-rma"
                        />
                    </UFormField>
                    <UFormField
                        label="Vence"
                        name="vence_en"
                        required
                    >
                        <UInput
                            v-model="envio.vence_en"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
            <UForm
                v-else
                :id="idFormulario"
                :schema="esquemaResolverGarantia"
                :state="resolucion"
                class="flex flex-col gap-4"
                @submit="resolverGarantia"
            >
                <p class="text-sm text-muted">
                    {{ RESULTADOS_GARANTIA[resolucion.resultado].descripcion }}.
                </p>
                <div
                    v-if="resolucion.resultado === 'reemplazada'"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        label="Serie del equipo nuevo"
                        name="serie"
                    >
                        <UInput
                            v-model="resolucion.serie"
                            class="w-full font-mono"
                            data-prueba="garantia-serie"
                        />
                    </UFormField>
                    <UFormField
                        label="MAC"
                        name="mac"
                    >
                        <UInput
                            v-model="resolucion.mac"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Nota"
                    name="nota"
                >
                    <UInput
                        v-model="resolucion.nota"
                        class="w-full"
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
                    :icon="ICONOS.cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    :label="modo === 'enviar' ? 'Enviar a garantía' : 'Guardar resultado'"
                    :icon="modo === 'enviar' ? 'i-lucide-truck' : ICONOS.guardar"
                    :color="modo === 'resolver' && resolucion.resultado === 'rechazada' ? 'error' : 'primary'"
                    :loading="enviando"
                    data-prueba="garantia-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
