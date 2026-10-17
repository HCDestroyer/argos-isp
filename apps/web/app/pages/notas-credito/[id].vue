<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

definePageMeta({ permiso: 'facturas.ver' })

const route = useRoute()
const { puede, enlace } = usePermisos()

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
            <div class="flex flex-col gap-1">
                <h2 class="text-xl font-semibold text-highlighted">
                    Nota de crédito #{{ nota.id }}
                </h2>
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
        </div>
    </PanelPagina>
</template>
