<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Certificación FEL de un documento (factura, mora o nota de crédito): lee su DTE vigente
 * (`GET /dte/:id` con `dte_id`, o `GET /dte?documento_tipo&documento_id`) y lo muestra con
 * `DteFicha`. Sin DTE ofrece "Certificar" (`fel.certificar`) en una factura. Mientras el DTE está
 * en cola o con la anulación pendiente se relee cada pocos segundos; cuando cambia de estado
 * avisa (`cambiado`) para que la ficha relea el documento.
 */
const props = withDefaults(defineProps<{
    tipo: 'factura' | 'nota_credito'
    documentoId: number
    /** `dte_id` de la factura o la nota: el DTE vigente (o el último rechazado); `null` = sin DTE; sin él se busca por documento. */
    dteId?: number | null
    /** La factura admite pedir su certificación (no anulada). */
    certificable?: boolean
    /** Cambia cuando el documento cambió (versión, estado FEL): se relee el DTE. */
    refrescar?: string | number | null
}>(), {
    dteId: undefined,
    certificable: false,
    refrescar: null,
})

const emit = defineEmits<{
    /** El DTE cambió de estado (certificado, reintentado, anulado…). */
    cambiado: [dte: Dte | null]
    /** Cada lectura correcta, con el DTE vigente o `null`. */
    cargado: [dte: Dte | null]
}>()

const RELECTURA_MS = 3000
const EN_COLA: readonly EstadoDte[] = ['pendiente', 'enviando', 'anulacion_pendiente']

const { puede } = usePermisos()
const toast = useToast()

/** Quien la abre ya comprueba `fel.ver`; sin él no se pide nada. */
const visible = computed(() => puede('fel.ver'))
const dte = shallowRef<Dte | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
let temporizador: ReturnType<typeof setTimeout> | null = null

function detener() {
    if (temporizador) {
        clearTimeout(temporizador)
        temporizador = null
    }
}

async function leer(): Promise<Resultado<Dte | null>> {
    if (props.dteId) {
        return useDte().ver(props.dteId)
    }
    if (props.dteId === null) {
        return { ok: true, data: null }
    }
    return useDte().deDocumento(props.tipo, props.documentoId)
}

async function cargar(silencioso = false) {
    detener()
    if (!visible.value) {
        return
    }
    if (!silencioso) {
        cargando.value = true
    }
    const antes = dte.value?.estado ?? null
    const resultado = await leer()
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        if (!silencioso) {
            dte.value = null
        }
        return
    }
    problema.value = null
    dte.value = resultado.data
    emit('cargado', resultado.data)
    if (silencioso && resultado.data && resultado.data.estado !== antes) {
        emit('cambiado', resultado.data)
    }
    if (resultado.data && EN_COLA.includes(resultado.data.estado)) {
        temporizador = setTimeout(() => void cargar(true), RELECTURA_MS)
    }
}

/* Certificar a mano (opcional, o un aviso que se quiere certificar antes del pago). */
const certificando = ref(false)
const problemaCertificar = ref<Problem | null>(null)
let claveCertificar = nuevaClaveIdempotencia()

async function certificar() {
    certificando.value = true
    problemaCertificar.value = null
    const resultado = await useDte().certificarFactura(props.documentoId, claveCertificar)
    certificando.value = false
    if (!resultado.ok) {
        problemaCertificar.value = problemaFelLegible(resultado.problema)
        return
    }
    claveCertificar = nuevaClaveIdempotencia()
    toast.add({
        title: resultado.data.creado ? 'Certificación pedida' : 'La factura ya tenía DTE',
        description: resultado.data.motivo ?? (resultado.data.dte?.estado === 'contingencia' ? 'En contingencia: se transmite al levantarla.' : 'El worker la enviará al certificador.'),
        icon: 'i-lucide-badge-check',
        color: 'success',
    })
    dte.value = resultado.data.dte
    emit('cargado', resultado.data.dte)
    emit('cambiado', resultado.data.dte)
    if (resultado.data.dte && EN_COLA.includes(resultado.data.dte.estado)) {
        temporizador = setTimeout(() => void cargar(true), RELECTURA_MS)
    }
}

function alActualizar(nuevo: Dte) {
    dte.value = nuevo
    emit('cargado', nuevo)
    emit('cambiado', nuevo)
    if (EN_COLA.includes(nuevo.estado)) {
        detener()
        temporizador = setTimeout(() => void cargar(true), RELECTURA_MS)
    }
}

watch(() => [props.dteId, props.documentoId, props.refrescar], () => void cargar())
onMounted(() => void cargar())
onBeforeUnmount(detener)
</script>

<template>
    <div
        v-if="visible"
        class="flex flex-col gap-3"
        data-prueba="dte-documento"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="() => void cargar()"
            :reintentando="cargando"
            data-prueba="dte-documento-error"
        />
        <USkeleton
            v-else-if="cargando && !dte"
            class="h-28 w-full"
        />
        <DteFicha
            v-else-if="dte"
            :dte="dte"
            @actualizado="alActualizar"
        />
        <div
            v-else
            class="flex flex-wrap items-center justify-between gap-3"
        >
            <p
                class="text-sm text-muted"
                data-prueba="dte-sin"
            >
                {{ tipo === 'factura' ? 'Sin DTE: esta factura no se ha certificado.' : 'Nota interna: sin NCRE (el documento no tenía DTE certificado).' }}
            </p>
            <UButton
                v-if="tipo === 'factura' && certificable && puede('fel.certificar')"
                label="Certificar"
                icon="i-lucide-badge-check"
                color="neutral"
                variant="outline"
                :loading="certificando"
                data-prueba="dte-certificar"
                @click="certificar"
            />
        </div>
        <ProblemaAlerta
            v-if="problemaCertificar"
            :problema="problemaCertificar"
            data-prueba="dte-certificar-error"
        />
    </div>
</template>
