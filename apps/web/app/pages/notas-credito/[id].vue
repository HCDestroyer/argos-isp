<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

definePageMeta({ permiso: 'facturas.ver' })

const route = useRoute()
const { puede, enlace } = usePermisos()
const toast = useToast()

const notaId = computed(() => Number(route.params.id))

const nota = shallowRef<NotaCredito | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const asiento = shallowRef<Asiento | null>(null)
const cargandoAsiento = ref(false)
const problemaAsiento = ref<Problem | null>(null)

useHead(() => ({ title: `Nota de crédito #${route.params.id} · ArgosIsp` }))

async function cargarAsiento(actual: NotaCredito) {
    asiento.value = null
    problemaAsiento.value = null
    if (!puede('libro.ver') || actual.asiento_id === null) {
        return
    }
    cargandoAsiento.value = true
    const resultado = await useLibro().asiento(actual.asiento_id)
    cargandoAsiento.value = false
    asiento.value = resultado.ok ? resultado.data : null
    problemaAsiento.value = resultado.ok ? null : resultado.problema
}

function reintentarAsiento() {
    if (nota.value) {
        void cargarAsiento(nota.value)
    }
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useNotasCredito().ver(notaId.value)
    cargando.value = false
    if (!resultado.ok) {
        nota.value = null
        problema.value = resultado.problema
        return
    }
    nota.value = resultado.data
    void cargarAsiento(resultado.data)
}

/*
 * FEL: la NCRE de la nota. Si la SAT la rechazó en definitivo, la nota se anula
 * (`POST /notas-credito/:id/anular`, `facturas.anular_nota_credito`): reverso espejo y el monto
 * vuelve al saldo de la factura. La API decide (409 si la NCRE sigue en cola o ya se certificó).
 */
const anularAbierto = ref(false)
const ncreRechazada = computed(() => nota.value?.fel_estado === 'rechazado' && !nota.value.anulada_en)
const puedeAnular = computed(() => puede('facturas.anular_nota_credito') && ncreRechazada.value)

/** La NCRE cambió de estado (reintentada, certificada…): se relee la nota. */
function alCambiarNcre() {
    void cargar()
}

/* PDF de la nota (`GET /documentos/nota-credito/:notaId`, el mismo del portal). */
const generandoPdf = ref(false)

async function abrirPdf() {
    if (!nota.value || generandoPdf.value) {
        return
    }
    const ventana = window.open('', '_blank')
    generandoPdf.value = true
    const resultado = await useDocumentos().notaCredito(nota.value.id)
    generandoPdf.value = false
    if (!resultado.ok) {
        ventana?.close()
        toast.add({ title: 'No se pudo generar el PDF', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const url = URL.createObjectURL(resultado.data)
    if (ventana) {
        ventana.location.href = url
    }
    else {
        const enlace = document.createElement('a')
        enlace.href = url
        enlace.download = `nota-credito-${nota.value.id}.pdf`
        enlace.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function anular(motivo: string, clave: string) {
    return useNotasCredito().anular(notaId.value, motivo, clave).then(r => (r.ok ? r : { ...r, problema: problemaFelLegible(r.problema) }))
}

function alAnular(anulada: NotaCredito) {
    toast.add({
        title: `Nota de crédito #${anulada.id} anulada`,
        description: `Se registró el reverso: ${formatearQuetzales(anulada.monto)} vuelven al saldo de la factura #${anulada.factura_id}`,
        icon: 'i-lucide-ban',
        color: 'success',
    })
    void cargar()
}

watch(notaId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="nota-credito"
        :titulo="`Nota de crédito #${route.params.id}`"
        icono="i-lucide-file-minus"
    >
        <template #acciones>
            <UButton
                to="/notas-credito"
                icon="i-lucide-arrow-left"
                label="Notas de crédito"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            v-if="cargando && !nota"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-32 w-full" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Nota de crédito no encontrada"
            :description="`No existe una nota de crédito con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a notas de crédito', to: '/notas-credito', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="nota"
            class="flex flex-col gap-6"
        >
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            Nota de crédito #{{ nota.id }}
                        </h2>
                        <UBadge
                            v-if="nota.anulada_en"
                            :label="`Anulada · ${formatearFechaHora(nota.anulada_en)}`"
                            icon="i-lucide-ban"
                            color="neutral"
                            variant="subtle"
                            data-prueba="nota-anulada"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        {{ formatearFecha(nota.fecha) }} ·
                        <ULink
                            :to="enlace(`/clientes/${nota.cliente_id}?tab=cuenta`)"
                            class="text-default hover:text-primary"
                        >
                            {{ nota.cliente_nombre }}
                        </ULink>
                    </p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        :label="nota.fel_estado === 'certificado' ? 'NCRE (PDF)' : 'Nota (PDF)'"
                        icon="i-lucide-file-down"
                        color="neutral"
                        variant="outline"
                        :loading="generandoPdf"
                        data-prueba="nota-pdf"
                        @click="abrirPdf"
                    />
                    <UButton
                        v-if="puedeAnular"
                        label="Anular nota"
                        icon="i-lucide-ban"
                        color="error"
                        variant="outline"
                        data-prueba="abrir-anular-nota"
                        @click="anularAbierto = true"
                    />
                </div>
            </div>

            <UAlert
                v-if="ncreRechazada"
                color="error"
                variant="subtle"
                icon="i-lucide-octagon-x"
                title="La SAT rechazó la NCRE de esta nota"
                description="Corrige el dato y reintenta la NCRE, o anula la nota: su asiento se revierte y el monto vuelve al saldo de la factura. Mientras siga sin certificar, el mes no se puede cerrar."
                data-prueba="nota-ncre-rechazada"
            />

            <UPageCard
                title="Datos de la nota"
                icon="i-lucide-receipt-text"
                variant="subtle"
            >
                <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                    <DatoFicha
                        etiqueta="Monto acreditado"
                        :valor="formatearQuetzales(nota.monto)"
                    />
                    <DatoFicha
                        etiqueta="Subtotal"
                        :valor="formatearQuetzales(nota.subtotal)"
                    />
                    <DatoFicha
                        etiqueta="IVA acreditado"
                        :valor="formatearQuetzales(nota.iva)"
                    />
                    <DatoFicha etiqueta="Factura">
                        <ULink
                            :to="`/facturas/${nota.factura_id}`"
                            class="text-default hover:text-primary"
                            data-prueba="enlace-factura"
                        >
                            Factura #{{ nota.factura_id }}
                        </ULink>
                    </DatoFicha>
                    <DatoFicha
                        v-if="nota.servicio_id !== null"
                        etiqueta="Servicio"
                    >
                        <ULink
                            :to="enlace(`/servicios/${nota.servicio_id}`)"
                            class="text-default hover:text-primary"
                        >
                            Servicio #{{ nota.servicio_id }}
                        </ULink>
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Emitida por"
                        :valor="nota.created_by_nombre ?? (nota.created_by ? `Usuario #${nota.created_by}` : 'Sistema')"
                    />
                    <DatoFicha
                        etiqueta="Registrada"
                        :valor="formatearFechaHora(nota.created_at)"
                    />
                    <DatoFicha
                        etiqueta="Motivo"
                        :valor="nota.motivo"
                        class="col-span-2 lg:col-span-4"
                    />
                </dl>
            </UPageCard>

            <UPageCard
                v-if="puede('fel.ver')"
                title="NCRE (certificación FEL)"
                icon="i-lucide-badge-check"
                variant="subtle"
                data-prueba="nota-fel"
            >
                <DteDocumento
                    tipo="nota_credito"
                    :documento-id="nota.id"
                    :dte-id="nota.dte_id ?? null"
                    :refrescar="`${nota.fel_estado ?? ''}-${nota.anulada_en ?? ''}`"
                    @cambiado="alCambiarNcre"
                />
            </UPageCard>

            <section
                v-if="puede('libro.ver')"
                class="flex flex-col gap-2"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Asiento del libro
                </h3>
                <ProblemaAlerta
                    v-if="problemaAsiento"
                    :problema="problemaAsiento"
                    :reintentar="reintentarAsiento"
                    :reintentando="cargandoAsiento"
                />
                <USkeleton
                    v-else-if="cargandoAsiento"
                    class="h-24 w-full"
                />
                <p
                    v-else-if="!asiento"
                    class="text-sm text-muted"
                >
                    Esta nota no tiene asiento en el libro diario.
                </p>
                <AsientoContable
                    v-else
                    :asiento="asiento"
                    :con-origen="false"
                    class="lg:max-w-2xl"
                />
            </section>

            <AccionMotivoModal
                v-if="puedeAnular"
                v-model:open="anularAbierto"
                titulo="Anular nota de crédito"
                :descripcion="`Nota #${nota.id} · ${formatearQuetzales(nota.monto)} · factura #${nota.factura_id}`"
                efecto="La SAT rechazó su NCRE: se registra el asiento de reverso y el monto vuelve al saldo de la factura. El servicio se reevalúa. No se puede deshacer."
                confirmar="Anular nota"
                placeholder="Ej.: la SAT rechazó la NCRE; se emitirá otra con el dato corregido"
                :ejecutar="anular"
                @hecho="alAnular"
            />
        </div>
    </PanelPagina>
</template>
