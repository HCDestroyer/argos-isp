<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de una orden de traslado (A3, `contratos/inventario.md` D.1): estado, origen y destino,
 * líneas con lo enviado y lo recibido (faltantes por línea y por serie), la recepción (método, quién
 * recibió y quién registró, firma o papel) y la cancelación. Acciones: «Recibir», «Cancelar» con
 * motivo, «Imprimir» (el PDF, sin costos) y «Adjuntar papel firmado» tras recibir en papel.
 */
definePageMeta({ permiso: 'inventario.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const id = computed(() => Number(route.params.id))
const orden = shallowRef<OrdenTrasladoDetalle | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead({ title: () => (orden.value ? `Orden de traslado N.º ${orden.value.numero} · ArgosIsp` : 'Orden de traslado · ArgosIsp') })

async function cargar() {
    cargando.value = true
    const resultado = await useOrdenesTraslado().ver(id.value)
    cargando.value = false
    orden.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
watch(id, cargar)

const enTransito = computed(() => orden.value?.estado === 'en_transito')
const recibida = computed(() => orden.value?.estado === 'recibida' || orden.value?.estado === 'recibida_con_diferencias')

/* PDF imprimible */
const cargandoPdf = ref(false)

async function imprimir() {
    if (!orden.value) {
        return
    }
    const ventana = window.open('', '_blank')
    cargandoPdf.value = true
    const resultado = await useOrdenesTraslado().pdf(orden.value.id)
    cargandoPdf.value = false
    if (!resultado.ok) {
        ventana?.close()
        toast.add({ title: 'No se pudo generar el PDF', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-file-x', color: 'error' })
        return
    }
    const url = URL.createObjectURL(resultado.data)
    if (ventana) {
        ventana.location.href = url
    }
    else {
        guardarBlob(resultado.data, `orden-traslado-${orden.value.numero}.pdf`)
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/* Firma y papel firmado */
const urlFirma = ref<string | null>(null)
const problemaFirma = ref<Problem | null>(null)

async function leerFirma() {
    problemaFirma.value = null
    if (!orden.value?.firma_sha256) {
        return
    }
    const resultado = await useOrdenesTraslado().firma(orden.value.id)
    if (!resultado.ok) {
        problemaFirma.value = resultado.problema
        return
    }
    if (urlFirma.value) {
        URL.revokeObjectURL(urlFirma.value)
    }
    urlFirma.value = URL.createObjectURL(resultado.data)
}

watch(() => orden.value?.firma_sha256, () => void leerFirma())
onBeforeUnmount(() => {
    if (urlFirma.value) {
        URL.revokeObjectURL(urlFirma.value)
    }
})

const descargandoDocumento = ref(false)

async function verDocumento() {
    if (!orden.value) {
        return
    }
    descargandoDocumento.value = true
    const resultado = await useOrdenesTraslado().documento(orden.value.id)
    descargandoDocumento.value = false
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo abrir el documento', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const extension = orden.value.documento_tipo?.split('/').at(-1) ?? 'pdf'
    guardarBlob(resultado.data, `orden-traslado-${orden.value.numero}-firmada.${extension}`)
}

/* Acciones */
const recibirAbierto = ref(false)
const documentoAbierto = ref(false)
const cancelarAbierto = ref(false)

function alRecibir(nueva: OrdenTrasladoDetalle) {
    orden.value = nueva
    toast.add({
        title: `Orden N.º ${nueva.numero} ${ESTADOS_ORDEN_TRASLADO[nueva.estado].etiqueta.toLowerCase()}`,
        description: nueva.estado === 'recibida_con_diferencias' ? 'Lo faltante volvió al origen.' : undefined,
        icon: 'i-lucide-package-check',
        color: nueva.estado === 'recibida' ? 'success' : 'warning',
    })
    if (nueva.metodo_recepcion === 'firma_papel' && !nueva.documento_sha256 && puede('inventario.adjuntar_documento_traslado')) {
        documentoAbierto.value = true
    }
}

function alAdjuntar(nueva: OrdenTrasladoDetalle) {
    orden.value = nueva
    toast.add({ title: 'Papel firmado adjunto', icon: 'i-lucide-paperclip', color: 'success' })
}

function cancelar(motivo: string, clave: string): Promise<Resultado<OrdenTrasladoDetalle>> {
    return orden.value ? useOrdenesTraslado().cancelar(orden.value, motivo, clave) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'La orden no está cargada', status: 400 } })
}

function alCancelar(nueva: OrdenTrasladoDetalle) {
    orden.value = nueva
    toast.add({ title: `Orden N.º ${nueva.numero} cancelada`, description: 'Todo volvió al origen.', icon: 'i-lucide-ban', color: 'success' })
}

function unidadesTexto(linea: LineaOrdenTraslado) {
    return linea.unidades.map(u => ({ ...u, texto: identificacionUnidad(u) }))
}
</script>

<template>
    <PanelPagina
        id="inventario-traslado"
        :titulo="orden ? `Orden N.º ${orden.numero}` : 'Orden de traslado'"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <UButton
                label="Órdenes"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
                to="/inventario/traslados"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!orden"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-24 w-full" />
            <USkeleton class="h-48 w-full" />
        </div>
        <div
            v-else
            class="mx-auto flex w-full max-w-5xl flex-col gap-5"
            data-prueba="detalle-traslado"
        >
            <UCard>
                <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="flex min-w-0 flex-col gap-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <UBadge
                                    :label="ESTADOS_ORDEN_TRASLADO[orden.estado].etiqueta"
                                    :icon="ESTADOS_ORDEN_TRASLADO[orden.estado].icono"
                                    :color="ESTADOS_ORDEN_TRASLADO[orden.estado].color"
                                    variant="subtle"
                                    data-prueba="estado-traslado"
                                />
                                <span class="text-xs text-muted">Enviada el {{ formatearFechaHora(orden.enviado_en) }}{{ orden.enviado_por_nombre ? ` por ${orden.enviado_por_nombre}` : '' }}</span>
                            </div>
                            <p class="text-sm text-highlighted">
                                {{ rutaOrden(orden) }}
                            </p>
                            <p
                                v-if="orden.motivo"
                                class="text-sm text-muted"
                            >
                                {{ orden.motivo }}
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                label="Imprimir"
                                icon="i-lucide-printer"
                                color="neutral"
                                variant="outline"
                                :loading="cargandoPdf"
                                data-prueba="traslado-imprimir"
                                @click="imprimir"
                            />
                            <UButton
                                v-if="enTransito && puede('inventario.cancelar_traslado')"
                                label="Cancelar"
                                icon="i-lucide-ban"
                                color="error"
                                variant="outline"
                                data-prueba="traslado-cancelar"
                                @click="cancelarAbierto = true"
                            />
                            <UButton
                                v-if="enTransito && puede('inventario.recibir_traslado')"
                                label="Recibir"
                                icon="i-lucide-package-check"
                                data-prueba="traslado-recibir"
                                @click="recibirAbierto = true"
                            />
                            <UButton
                                v-if="orden.metodo_recepcion === 'firma_papel' && recibida && !orden.documento_sha256 && puede('inventario.adjuntar_documento_traslado')"
                                label="Adjuntar papel firmado"
                                icon="i-lucide-paperclip"
                                data-prueba="traslado-adjuntar"
                                @click="documentoAbierto = true"
                            />
                        </div>
                    </div>
                    <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <DatoFicha
                            etiqueta="Líneas"
                            :valor="orden.lineas_total"
                        />
                        <DatoFicha
                            etiqueta="Valor enviado"
                            :valor="formatearQuetzales(orden.costo_total)"
                        />
                        <DatoFicha
                            etiqueta="Origen"
                            :valor="orden.bodega_origen_nombre"
                        />
                        <DatoFicha
                            etiqueta="Destino"
                            :valor="orden.usuario_destino_nombre ? `${orden.bodega_destino_nombre} · ${orden.usuario_destino_nombre}` : orden.bodega_destino_nombre"
                        />
                    </dl>
                </div>
            </UCard>

            <UCard :ui="{ body: 'p-0 sm:p-0' }">
                <template #header>
                    <h2 class="text-sm font-semibold text-highlighted">
                        Líneas
                    </h2>
                </template>
                <ul class="divide-y divide-default">
                    <li
                        v-for="linea in orden.lineas"
                        :key="linea.id"
                        class="flex flex-col gap-2 px-4 py-3 sm:px-6"
                        :data-linea-traslado="linea.producto_sku"
                    >
                        <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="flex min-w-0 flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ linea.producto_nombre }}</span>
                                <span class="font-mono text-xs text-muted">{{ linea.producto_sku }}</span>
                            </div>
                            <div class="flex flex-col items-end text-sm tabular-nums">
                                <span>Enviado: {{ formatearCantidad(linea.cantidad, linea.unidad) }}</span>
                                <span
                                    v-if="linea.cantidad_recibida !== null"
                                    class="text-xs text-muted"
                                >Recibido: {{ formatearCantidad(linea.cantidad_recibida, linea.unidad) }}</span>
                                <UBadge
                                    v-if="linea.faltante && Number(linea.faltante) > 0"
                                    :label="`Faltante ${formatearCantidad(linea.faltante, linea.unidad)}`"
                                    color="warning"
                                    variant="subtle"
                                    size="sm"
                                />
                            </div>
                        </div>
                        <div
                            v-if="linea.unidades.length"
                            class="flex flex-wrap gap-1.5"
                        >
                            <UBadge
                                v-for="u in unidadesTexto(linea)"
                                :key="u.unidad_id"
                                :label="u.texto"
                                :icon="u.recibida === null ? 'i-lucide-truck' : (u.recibida ? 'i-lucide-check' : 'i-lucide-x')"
                                :color="u.recibida === false ? 'warning' : 'neutral'"
                                variant="subtle"
                                size="sm"
                                class="font-mono"
                                :data-unidad-traslado="u.serie ?? u.mac"
                            />
                        </div>
                    </li>
                </ul>
            </UCard>

            <UCard
                v-if="recibida"
                data-prueba="recepcion-traslado"
            >
                <template #header>
                    <h2 class="text-sm font-semibold text-highlighted">
                        Recepción
                    </h2>
                </template>
                <div class="flex flex-col gap-4">
                    <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <DatoFicha
                            etiqueta="Método"
                            :valor="orden.metodo_recepcion ? METODOS_RECEPCION[orden.metodo_recepcion].etiqueta : null"
                        />
                        <DatoFicha
                            etiqueta="Recibió"
                            :valor="orden.recibido_por_nombre"
                        />
                        <DatoFicha
                            etiqueta="Registró"
                            :valor="orden.registrado_por_nombre"
                        />
                        <DatoFicha
                            etiqueta="Fecha"
                            :valor="orden.recibido_en ? formatearFechaHora(orden.recibido_en) : null"
                        />
                    </dl>
                    <p
                        v-if="orden.observaciones"
                        class="text-sm text-muted"
                    >
                        {{ orden.observaciones }}
                    </p>
                    <div
                        v-if="orden.firma_sha256"
                        class="flex flex-col gap-2"
                    >
                        <span class="text-xs font-medium text-muted">Firma digital</span>
                        <div class="w-full max-w-md rounded-md border border-default bg-white p-2">
                            <img
                                v-if="urlFirma"
                                :src="urlFirma"
                                alt="Firma de quien recibió"
                                class="h-auto w-full"
                                data-prueba="traslado-firma"
                            >
                        </div>
                        <ProblemaAlerta
                            v-if="problemaFirma"
                            :problema="problemaFirma"
                            :reintentar="leerFirma"
                        />
                        <span
                            class="font-mono text-xs text-muted"
                            :title="orden.firma_sha256"
                        >SHA-256 {{ huellaCorta(orden.firma_sha256) }}…</span>
                    </div>
                    <div
                        v-if="orden.metodo_recepcion === 'firma_papel'"
                        class="flex flex-wrap items-center gap-2"
                    >
                        <UButton
                            v-if="orden.documento_sha256"
                            label="Ver papel firmado"
                            icon="i-lucide-file-check"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :loading="descargandoDocumento"
                            @click="verDocumento"
                        />
                        <UBadge
                            v-else
                            label="Falta adjuntar el papel firmado"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-paperclip"
                        />
                    </div>
                </div>
            </UCard>

            <UAlert
                v-if="orden.estado === 'cancelada'"
                color="neutral"
                variant="subtle"
                icon="i-lucide-ban"
                :title="`Cancelada el ${orden.cancelado_en ? formatearFechaHora(orden.cancelado_en) : '—'}`"
                :description="orden.motivo_cancelacion ?? undefined"
            />

            <TrasladoRecibirSlideover
                v-model:open="recibirAbierto"
                :orden="orden"
                @recibida="alRecibir"
            />
            <TrasladoDocumentoModal
                v-model:open="documentoAbierto"
                :orden="orden"
                @adjuntado="alAdjuntar"
            />
            <AccionMotivoModal
                v-model:open="cancelarAbierto"
                titulo="Cancelar orden de traslado"
                :efecto="`Todo lo enviado en la orden N.º ${orden.numero} vuelve a ${orden.bodega_origen_nombre} al mismo costo.`"
                confirmar="Cancelar orden"
                icono="i-lucide-ban"
                color="error"
                :ejecutar="cancelar"
                @hecho="alCancelar"
            />
        </div>
    </PanelPagina>
</template>
