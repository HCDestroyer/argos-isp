<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Reatribuye la llegada de una línea del extracto (`POST /bancos/llegadas/reatribuir`,
 * `bancos.reatribuir_llegada`): se concilió con el depósito o traslado equivocado. La API deshace la
 * conciliación, revierte esa llegada (el documento vuelve a tránsito) y registra la del documento
 * correcto con la misma línea. Se elige el documento en tránsito hacia la cuenta y el motivo.
 */
const props = defineProps<{
    linea: LineaExtracto
    /** La llegada que hoy tiene la línea (movimiento con origen `deposito` o `traslado`). */
    llegada: MovimientoConciliado
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [conciliacion: Conciliacion]
}>()

const esquema = z.object({
    documento: z.string().min(1, 'Elige el depósito o traslado que en verdad llegó'),
    motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Máximo 500 caracteres'),
})
type Datos = z.output<typeof esquema>

const estado = reactive<Datos>({ documento: '', motivo: '' })
const candidatos = shallowRef<{ clave: string, tipo: 'deposito' | 'traslado', id: number, etiqueta: string, descripcion: string, monto: string }[]>([])
const cargando = ref(false)
const problemaCarga = ref<Problem | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const items = computed(() => candidatos.value.map(c => ({ label: c.etiqueta, value: c.clave, description: `${c.descripcion} · ${formatearQuetzales(c.monto)}` })))

async function cargar() {
    cargando.value = true
    problemaCarga.value = null
    const transito = useFondosEnTransito()
    const [depositos, traslados] = await Promise.all([transito.depositos('en_transito', undefined, 200), transito.traslados('en_transito', undefined, 200)])
    cargando.value = false
    if (!depositos.ok || !traslados.ok) {
        candidatos.value = []
        problemaCarga.value = !depositos.ok ? depositos.problema : (!traslados.ok ? traslados.problema : null)
        return
    }
    candidatos.value = [
        ...depositos.data.data.filter(d => d.cuenta_id === props.linea.cuenta_id).map(d => ({ clave: `deposito-${d.id}`, tipo: 'deposito' as const, id: d.id, etiqueta: `Depósito #${d.id} · boleta ${d.boleta}`, descripcion: `${d.caja_nombre} · ${formatearFecha(d.fecha)}`, monto: d.monto })),
        ...traslados.data.data.filter(t => t.cuenta_destino_id === props.linea.cuenta_id).map(t => ({ clave: `traslado-${t.id}`, tipo: 'traslado' as const, id: t.id, etiqueta: `Traslado #${t.id} · ${t.referencia}`, descripcion: `desde ${t.cuenta_origen_codigo} · ${formatearFecha(t.fecha)}`, monto: t.monto })),
    ]
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { documento: '', motivo: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargar()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<Datos>) {
    const elegido = candidatos.value.find(c => c.clave === evento.data.documento)
    if (!elegido || (props.llegada.origen_tipo !== 'deposito' && props.llegada.origen_tipo !== 'traslado') || props.llegada.origen_id === null) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useFondosEnTransito().reatribuir({
        tipo: props.llegada.origen_tipo,
        documento_id: props.llegada.origen_id,
        nuevo_tipo: elegido.tipo,
        nuevo_documento_id: elegido.id,
        motivo: evento.data.motivo,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Reatribuir llegada"
        :description="`${formatearFecha(linea.fecha)} · ${linea.descripcion} · ${montoConSigno(linea.monto)} · hoy: ${llegada.descripcion}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-reatribuir"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-arrow-left-right"
                    description="La llegada equivocada se revierte con su asiento espejo (ese documento vuelve a tránsito) y se registra la del documento correcto con esta misma línea."
                />
                <ProblemaAlerta
                    v-if="problemaCarga"
                    :problema="problemaCarga"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <UFormField
                    v-else
                    label="Lo que en verdad llegó"
                    name="documento"
                    required
                    :help="!cargando && !candidatos.length ? 'No hay otros depósitos ni traslados en tránsito hacia esta cuenta.' : undefined"
                >
                    <USelect
                        v-model="estado.documento"
                        :items="items"
                        :loading="cargando"
                        placeholder="Elige el depósito o traslado"
                        class="w-full"
                        data-prueba="reatribuir-documento"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: la boleta era la del turno de la tarde"
                        class="w-full"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="reatribuir-error"
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
                    form="form-reatribuir"
                    label="Reatribuir llegada"
                    icon="i-lucide-arrow-left-right"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
