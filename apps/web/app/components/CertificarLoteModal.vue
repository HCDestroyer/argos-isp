<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Certificar en lote (`POST /fel/lotes`, `fel.certificar`): pide la certificación de las facturas
 * emitidas en un rango de fechas (Guatemala) de una empresa (la activa; con «Todas», se elige). Cada una queda en la cola de DTE;
 * las que no se pudieron pedir (anuladas, sin receptor…) se listan con su motivo.
 */
const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [lote: LoteCertificacion] }>()

const { empresas, empresaId } = useEmpresaActiva()

const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Espejo del validador: `desde`/`hasta` AAAA-MM-DD; aquí siempre el rango (la lista de ids es para la API). */
const esquema = z.object({
    empresa_id: z.number({ message: 'Elige la empresa' }).int().min(1, 'Elige la empresa').nullable().refine(v => v !== null, 'Elige la empresa'),
    desde: z.string().regex(FECHA, 'Elige la fecha'),
    hasta: z.string().regex(FECHA, 'Elige la fecha'),
}).refine(d => d.desde <= d.hasta, { path: ['hasta'], message: 'Debe ser igual o posterior a «desde»' })
const estado = reactive<z.input<typeof esquema>>({ empresa_id: null, desde: '', hasta: '' })
const itemsEmpresas = computed(() => empresas.value.map(e => ({ label: e.nombre_comercial, value: e.id })))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const lote = shallowRef<LoteCertificacion | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { empresa_id: empresaId.value ?? (empresas.value.length === 1 ? empresas.value[0]?.id ?? null : null), desde: '', hasta: '' })
        problema.value = null
        lote.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useDte().certificarLote({ empresa_id: evento.data.empresa_id, desde: evento.data.desde, hasta: evento.data.hasta }, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    lote.value = resultado.data
    emit('hecho', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Certificar en lote"
        description="Facturas emitidas en el rango, de una empresa."
        :dismissible="!enviando"
    >
        <template #body>
            <div
                v-if="lote"
                class="flex flex-col gap-3"
                data-prueba="resultado-lote"
            >
                <UAlert
                    :color="lote.errores.length ? 'warning' : 'success'"
                    variant="subtle"
                    :icon="lote.errores.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
                    :title="`${lote.solicitadas.length} ${lote.solicitadas.length === 1 ? 'factura enviada' : 'facturas enviadas'} a certificar`"
                    :description="lote.errores.length ? `${lote.errores.length} no se pudieron pedir:` : 'Quedan en la cola de DTE.'"
                />
                <ul
                    v-if="lote.errores.length"
                    class="flex flex-col gap-1 text-sm"
                >
                    <li
                        v-for="e in lote.errores"
                        :key="e.factura_id"
                    >
                        <span class="font-medium text-highlighted">Factura #{{ e.factura_id }}</span> · {{ e.detalle }}
                    </li>
                </ul>
            </div>
            <UForm
                v-else
                id="form-lote"
                :schema="esquema"
                :state="estado"
                class="grid gap-4 sm:grid-cols-2"
                @submit="enviar"
            >
                <UFormField
                    v-if="empresas.length > 1"
                    label="Empresa"
                    name="empresa_id"
                    required
                    class="sm:col-span-2"
                >
                    <USelect
                        :model-value="estado.empresa_id ?? undefined"
                        :items="itemsEmpresas"
                        placeholder="Elige la empresa"
                        class="w-full"
                        data-prueba="lote-empresa"
                        @update:model-value="v => estado.empresa_id = typeof v === 'number' ? v : null"
                    />
                </UFormField>
                <UFormField
                    label="Desde"
                    name="desde"
                    required
                >
                    <UInput
                        v-model="estado.desde"
                        type="date"
                        class="w-full"
                        data-prueba="lote-desde"
                    />
                </UFormField>
                <UFormField
                    label="Hasta"
                    name="hasta"
                    required
                >
                    <UInput
                        v-model="estado.hasta"
                        type="date"
                        class="w-full"
                        data-prueba="lote-hasta"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    class="sm:col-span-2"
                />
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="lote ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!lote"
                    type="submit"
                    form="form-lote"
                    label="Certificar"
                    icon="i-lucide-badge-check"
                    :loading="enviando"
                    data-prueba="lote-certificar"
                />
            </div>
        </template>
    </UModal>
</template>
