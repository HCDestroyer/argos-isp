<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import type * as z from 'zod'

/**
 * Diferir una línea ya registrada de una compra (`POST /diferimientos`, `libro.registrar_asiento`): pasa
 * de su gasto a 1.1.13 y se amortiza en N meses desde el mes elegido. Lo abre la ficha de la compra, que
 * comprueba el permiso.
 */
const props = defineProps<{
    compra: Compra
    /** Líneas que todavía no se difieren (ni son activo fijo). */
    lineas: LineaCompra[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [diferimiento: Diferimiento]
}>()

type Entrada = z.input<typeof esquemaDiferirLinea>

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>({ compra_linea_id: 0, meses: 12, inicio: '', descripcion: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const items = computed<SelectItem[]>(() => props.lineas.map(l => ({ label: l.descripcion, value: l.id, description: `${TIPOS_LINEA_COMPRA[l.tipo]} · base ${formatearQuetzales(l.base)}` })))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { compra_linea_id: props.lineas[0]?.id ?? 0, meses: 12, inicio: '', descripcion: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<Entrada>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const resultado = await useDiferimientos().registrar({
        origen: 'compra',
        compra_linea_id: d.compra_linea_id,
        meses: d.meses,
        ...(d.inicio ? { inicio: `${d.inicio}-01` } : {}),
        ...(d.descripcion.trim() ? { descripcion: d.descripcion.trim() } : {}),
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length && errores.every(e => e.name && e.name in estado)) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaCompraLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Diferir una línea"
        :description="`${documentoCompra(compra)}: el gasto pagado por anticipado pasa a 1.1.13 y se amortiza cada mes.`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-diferir"
                ref="formulario"
                :schema="esquemaDiferirLinea"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Línea"
                    name="compra_linea_id"
                    required
                >
                    <USelect
                        v-model="estado.compra_linea_id"
                        :items="items"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Meses"
                        name="meses"
                        required
                    >
                        <UInputNumber
                            v-model="estado.meses"
                            :min="2"
                            :max="120"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Primera cuota"
                        name="inicio"
                        help="Vacío: el mes de la compra."
                    >
                        <UInput
                            v-model="estado.inicio"
                            type="month"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Descripción"
                    name="descripcion"
                >
                    <UInput
                        v-model="estado.descripcion"
                        placeholder="La de la línea"
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
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-diferir"
                    label="Diferir"
                    icon="i-lucide-calendar-range"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
