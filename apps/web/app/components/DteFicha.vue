<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Un DTE (A3, fase 3): estado con icono y texto, autorización, serie y número, intentos y el
 * error del certificador, con sus acciones: reintentar (`fel.certificar`, rechazado o error
 * temporal), ver y descargar el XML certificado y abrir el PDF del certificador (404 si no lo
 * devolvió). Todo sale de `GET /dte/:id`; nada se calcula aquí.
 */
const props = withDefaults(defineProps<{
    dte: Dte
    /** Enlace al documento (factura, nota); apágalo dentro de su propia ficha. */
    conDocumento?: boolean
}>(), {
    conDocumento: false,
})

const emit = defineEmits<{
    actualizado: [dte: Dte]
}>()

const { puede } = usePermisos()
const toast = useToast()

const estado = computed(() => ESTADOS_DTE[props.dte.estado])
const serieNumero = computed(() => serieNumeroDte(props.dte))
const rutaDocumento = computed(() => (props.dte.documento_tipo === 'nota_credito' ? `/notas-credito/${props.dte.documento_id}` : `/facturas/${props.dte.documento_id}`))
const puedeReintentar = computed(() => puede('fel.certificar') && dteReintentable(props.dte))

/* Reintentar: una clave por DTE mostrado (repetir tras un corte no duplica). */
const reintentando = ref(false)
const problemaReintento = ref<Problem | null>(null)
let claveReintento = nuevaClaveIdempotencia()
watch(() => props.dte.id, () => {
    claveReintento = nuevaClaveIdempotencia()
    problemaReintento.value = null
})

async function reintentar() {
    reintentando.value = true
    problemaReintento.value = null
    const resultado = await useDte().reintentar(props.dte.id, claveReintento)
    reintentando.value = false
    if (!resultado.ok) {
        problemaReintento.value = problemaFelLegible(resultado.problema)
        return
    }
    claveReintento = nuevaClaveIdempotencia()
    toast.add({
        title: resultado.data.id === props.dte.id ? 'DTE de nuevo en cola' : `DTE #${resultado.data.id} creado`,
        description: resultado.data.id === props.dte.id ? 'El worker lo enviará al certificador.' : 'Con el receptor releído; el rechazado queda como historia.',
        icon: 'i-lucide-rotate-cw',
        color: 'success',
    })
    emit('actualizado', resultado.data)
}

/* XML certificado, en un modal con descarga. */
const xmlAbierto = ref(false)
const xml = ref<string | null>(null)
const cargandoXml = ref(false)
const problemaXml = ref<Problem | null>(null)

async function verXml() {
    xmlAbierto.value = true
    if (xml.value !== null) {
        return
    }
    cargandoXml.value = true
    problemaXml.value = null
    const resultado = await useDte().xml(props.dte.id)
    cargandoXml.value = false
    xml.value = resultado.ok ? resultado.data : null
    problemaXml.value = resultado.ok ? null : resultado.problema
}

function descargar(contenido: Blob, nombre: string) {
    const url = URL.createObjectURL(contenido)
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombre
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function descargarXml() {
    if (xml.value !== null) {
        descargar(new Blob([xml.value], { type: 'application/xml' }), `dte-${props.dte.tipo_dte}-${props.dte.serie ?? props.dte.id}-${props.dte.numero ?? ''}.xml`)
    }
}

/* PDF del certificador: se abre en otra pestaña; si no existe, el 404 de la API en un toast. */
const cargandoPdf = ref(false)

async function abrirPdf() {
    const ventana = window.open('', '_blank')
    cargandoPdf.value = true
    const resultado = await useDte().pdf(props.dte.id)
    cargandoPdf.value = false
    if (!resultado.ok) {
        ventana?.close()
        toast.add({ title: 'PDF no disponible', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-file-x', color: 'warning' })
        return
    }
    const url = URL.createObjectURL(resultado.data)
    if (ventana) {
        ventana.location.href = url
    }
    else {
        descargar(resultado.data, `dte-${props.dte.id}.pdf`)
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

watch(() => props.dte.id, () => {
    xml.value = null
})
</script>

<template>
    <div
        class="flex flex-col gap-4"
        :data-dte="dte.id"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold text-highlighted">{{ dte.tipo_dte }} · DTE #{{ dte.id }}</span>
                    <EstadoDteBadge
                        :estado="dte.estado"
                        data-prueba="dte-estado"
                    />
                    <UBadge
                        v-if="dte.contingencia"
                        label="Emitido en contingencia"
                        icon="i-lucide-cloud-off"
                        color="warning"
                        variant="outline"
                        size="sm"
                    />
                </div>
                <p class="text-xs text-muted">
                    {{ estado.ayuda }}
                </p>
            </div>
            <div class="flex flex-wrap gap-2">
                <UButton
                    v-if="puedeReintentar"
                    label="Reintentar"
                    icon="i-lucide-rotate-cw"
                    color="warning"
                    variant="outline"
                    :loading="reintentando"
                    data-prueba="dte-reintentar"
                    @click="reintentar"
                />
                <UButton
                    v-if="dteConXml(dte)"
                    label="Ver XML"
                    icon="i-lucide-file-code-2"
                    color="neutral"
                    variant="outline"
                    data-prueba="dte-xml"
                    @click="verXml"
                />
                <UButton
                    v-if="dteConXml(dte)"
                    label="PDF"
                    icon="i-lucide-file-down"
                    color="neutral"
                    variant="outline"
                    :loading="cargandoPdf"
                    data-prueba="dte-pdf"
                    @click="abrirPdf"
                />
            </div>
        </div>

        <UAlert
            v-if="dte.ultimo_error"
            :color="dte.estado === 'rechazado' ? 'error' : 'warning'"
            variant="subtle"
            :icon="dte.estado === 'rechazado' ? 'i-lucide-octagon-x' : 'i-lucide-triangle-alert'"
            :title="dte.estado === 'rechazado' ? (dte.definitivo ? 'Rechazo definitivo del certificador' : 'Reintentos agotados') : 'Último error del certificador'"
            :description="dte.ultimo_error"
            data-prueba="dte-error"
        />

        <ProblemaAlerta
            v-if="problemaReintento"
            :problema="problemaReintento"
            data-prueba="dte-reintento-error"
        />

        <dl class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <DatoFicha
                etiqueta="Autorización (UUID SAT)"
                :valor="dte.autorizacion"
                mono
                data-prueba="dte-autorizacion"
            />
            <DatoFicha
                etiqueta="Serie y número"
                :valor="serieNumero"
                mono
                data-prueba="dte-serie-numero"
            />
            <DatoFicha
                etiqueta="Certificado"
                :valor="dte.certificado_en ? formatearFechaHora(dte.certificado_en) : null"
            />
            <DatoFicha
                etiqueta="Receptor"
                :valor="`${TIPOS_RECEPTOR[dte.receptor.tipo]} ${dte.receptor.tipo === 'cf' ? '' : dte.receptor.id} · ${dte.receptor.nombre}`"
            />
            <DatoFicha
                etiqueta="Total del DTE"
                :valor="`${formatearQuetzales(dte.total)} · IVA ${formatearQuetzales(dte.iva)}`"
            />
            <DatoFicha
                etiqueta="Intentos"
                :valor="dte.proximo_intento && dte.estado !== 'certificado' ? `${dte.intentos} · próximo ${formatearFechaHora(dte.proximo_intento)}` : String(dte.intentos)"
                data-prueba="dte-intentos"
            />
            <DatoFicha
                etiqueta="Emisión"
                :valor="formatearFechaHora(dte.fecha_emision)"
            />
            <DatoFicha
                etiqueta="Certificador"
                :valor="`${dte.proveedor} · ${AMBIENTES_FEL[dte.ambiente]} · solicitud ${dte.solicitud === 'manual' ? 'manual' : 'automática'}`"
            />
            <DatoFicha
                v-if="conDocumento"
                etiqueta="Documento"
            >
                <ULink
                    :to="rutaDocumento"
                    class="text-default hover:text-primary"
                    data-prueba="dte-documento"
                >
                    {{ DOCUMENTOS_DTE[dte.documento_tipo] }} #{{ dte.documento_id }}
                </ULink>
            </DatoFicha>
            <DatoFicha
                v-if="dte.referencia"
                etiqueta="Referencia"
                :valor="`${serieNumeroDte(dte.referencia) ?? dte.referencia.autorizacion} · ${formatearFecha(dte.referencia.fecha)} · ${dte.referencia.motivo}`"
                class="sm:col-span-2"
            />
            <DatoFicha
                v-if="dte.anulado_en || dte.motivo_anulacion"
                etiqueta="Anulación"
                :valor="[dte.anulado_en ? formatearFechaHora(dte.anulado_en) : 'Pendiente de confirmar', dte.motivo_anulacion].filter(Boolean).join(' · ')"
                class="sm:col-span-2"
            />
            <DatoFicha
                etiqueta="Identificador ante el certificador"
                :valor="dte.identificador"
                mono
                class="sm:col-span-2 lg:col-span-3"
            />
        </dl>

        <UModal
            v-model:open="xmlAbierto"
            :title="`XML del DTE #${dte.id}`"
            :description="serieNumero ?? dte.identificador"
            :ui="{ content: 'sm:max-w-3xl' }"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaXml"
                    :problema="problemaXml"
                    :reintentar="() => { xml = null; void verXml() }"
                    :reintentando="cargandoXml"
                />
                <USkeleton
                    v-else-if="cargandoXml"
                    class="h-40 w-full"
                />
                <pre
                    v-else-if="xml !== null"
                    class="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-elevated p-3 font-mono text-xs text-default"
                    data-prueba="dte-xml-contenido"
                >{{ xml }}</pre>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cerrar"
                        color="neutral"
                        variant="ghost"
                        @click="xmlAbierto = false"
                    />
                    <UButton
                        label="Descargar XML"
                        icon="i-lucide-download"
                        :disabled="xml === null"
                        @click="descargarXml"
                    />
                </div>
            </template>
        </UModal>
    </div>
</template>
