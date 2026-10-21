<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Ficha de una bonificación (A3): lo que se entregó sin cobrar, por qué (motivo y explicación), el
 * periodo que ocupa (si es de un servicio, el cron ya no lo factura), el valor bruto con IVA, la base
 * sin IVA del asiento interno 5.1.01 / ingreso y sus líneas. No tiene CxC, IVA ni DTE.
 */
definePageMeta({ permiso: 'facturas.ver' })

const route = useRoute()
const { enlace, puede } = usePermisos()
const nombres = useNombresClientes()

const bonificacionId = computed(() => Number(route.params.id))
const bonificacion = shallowRef<Bonificacion | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `Bonificación #${route.params.id} · ArgosIsp` }))

type Linea = Bonificacion['lineas'][number]
const columnas: TableColumn<Linea>[] = [
    { accessorKey: 'concepto', header: 'Concepto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cantidad', header: 'Cantidad', meta: SOLO_ANCHO },
    { accessorKey: 'precio_unitario', header: 'Precio', meta: SOLO_ANCHO },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const asientos = shallowRef<Asiento[]>([])
const cargandoAsientos = ref(false)
const problemaAsientos = ref<Problem | null>(null)

/** El asiento interno (origen `bonificacion`), con `libro.ver`. */
async function cargarAsientos(actual: Bonificacion) {
    if (!puede('libro.ver')) {
        return
    }
    cargandoAsientos.value = true
    const resultado = await useLibro().asientosDe('bonificacion', actual.id, sumarDiasFecha(fechaGuatemala(actual.created_at), -1))
    cargandoAsientos.value = false
    asientos.value = resultado.ok ? resultado.data : []
    problemaAsientos.value = resultado.ok ? null : resultado.problema
}

function reintentarAsientos() {
    if (bonificacion.value) {
        void cargarAsientos(bonificacion.value)
    }
}

async function cargar() {
    cargando.value = true
    const resultado = await useBonificaciones().ver(bonificacionId.value)
    cargando.value = false
    bonificacion.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        void nombres.cargar([resultado.data.cliente_id])
        void cargarAsientos(resultado.data)
    }
}

watch(bonificacionId, () => void cargar())
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="bonificacion"
        :titulo="bonificacion ? `Bonificación #${bonificacion.id}` : 'Bonificación'"
        icono="i-lucide-hand-heart"
    >
        <template #acciones>
            <UButton
                to="/bonificaciones"
                icon="i-lucide-arrow-left"
                label="Bonificaciones"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!bonificacion"
            class="h-40 w-full"
        />
        <div
            v-else
            class="flex flex-col gap-6"
            data-prueba="ficha-bonificacion"
        >
            <div class="flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-xl font-semibold text-highlighted">
                        {{ ocupaPeriodo(bonificacion) ? `Periodo de ${periodoBonificacion(bonificacion)}` : `Cargo del ${periodoBonificacion(bonificacion)}` }}
                    </h2>
                    <UBadge
                        :label="origenBonificacionVisual(bonificacion.origen).etiqueta"
                        :icon="origenBonificacionVisual(bonificacion.origen).icono"
                        :color="origenBonificacionVisual(bonificacion.origen).color"
                        variant="subtle"
                        data-prueba="bonificacion-origen"
                    />
                </div>
                <p class="text-sm text-muted">
                    {{ bonificacion.concepto }}
                </p>
            </div>

            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                :description="ocupaPeriodo(bonificacion)
                    ? 'Este periodo del servicio quedó bonificado: el cron ya no lo factura. No es una factura: no tiene saldo, IVA ni DTE.'
                    : 'Cargo único sin costo: no es una factura (nunca una de Q 0.00), no tiene saldo, IVA ni DTE.'"
            />

            <div class="grid gap-6 lg:grid-cols-2">
                <UPageCard
                    title="Bonificación"
                    icon="i-lucide-hand-heart"
                    variant="subtle"
                >
                    <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DatoFicha etiqueta="Cliente">
                            <ULink
                                v-if="enlace(`/clientes/${bonificacion.cliente_id}`)"
                                :to="enlace(`/clientes/${bonificacion.cliente_id}`)"
                                class="hover:text-primary"
                            >
                                {{ nombres.nombre(bonificacion.cliente_id) }}
                            </ULink>
                            <template v-else>
                                {{ nombres.nombre(bonificacion.cliente_id) }}
                            </template>
                        </DatoFicha>
                        <DatoFicha etiqueta="Servicio">
                            <ULink
                                v-if="bonificacion.servicio_id && enlace(`/servicios/${bonificacion.servicio_id}`)"
                                :to="enlace(`/servicios/${bonificacion.servicio_id}`)"
                                class="hover:text-primary"
                            >
                                Servicio #{{ bonificacion.servicio_id }}
                            </ULink>
                            <template v-else>
                                {{ bonificacion.servicio_id ? `Servicio #${bonificacion.servicio_id}` : 'Sin servicio' }}
                            </template>
                        </DatoFicha>
                        <DatoFicha
                            etiqueta="Motivo"
                            :valor="bonificacion.motivo_nombre"
                            data-prueba="bonificacion-motivo"
                        />
                        <DatoFicha
                            etiqueta="Explicación"
                            :valor="bonificacion.motivo_texto"
                        />
                        <DatoFicha
                            etiqueta="Clave"
                            :valor="bonificacion.clave_unica"
                            mono
                            class="min-w-0 [&_dd]:break-all"
                        />
                        <DatoFicha
                            etiqueta="Registrada"
                            :valor="formatearFechaHora(bonificacion.created_at)"
                        />
                    </dl>
                </UPageCard>

                <UPageCard
                    title="Valor"
                    icon="i-lucide-scale"
                    variant="subtle"
                >
                    <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="Valor bruto (con IVA) sin cobrar"
                            :valor="formatearQuetzales(bonificacion.bruto)"
                            data-prueba="bonificacion-bruto"
                        />
                        <DatoFicha
                            etiqueta="Base sin IVA (asiento 5.1.01 / ingreso)"
                            :valor="formatearQuetzales(bonificacion.base)"
                        />
                        <DatoFicha
                            v-if="bonificacion.canje_id"
                            etiqueta="Canje de lealtad"
                            :valor="`#${bonificacion.canje_id}`"
                        />
                    </dl>
                </UPageCard>
            </div>

            <section
                class="flex flex-col gap-2"
                aria-label="Líneas"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Líneas
                </h3>
                <UTable
                    :data="bonificacion.lineas"
                    :columns="columnas"
                >
                    <template #concepto-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm">{{ row.original.concepto }}</span>
                            <span class="text-xs text-muted">{{ row.original.gravable ? 'Con IVA' : 'Exento' }}<template v-if="row.original.cuenta_codigo"> · {{ row.original.cuenta_codigo }}</template></span>
                        </div>
                    </template>
                    <template #precio_unitario-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.precio_unitario) }}</span>
                    </template>
                    <template #total-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                    </template>
                </UTable>
            </section>

            <section
                v-if="puede('libro.ver')"
                class="flex flex-col gap-2"
                aria-label="Asiento del libro"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Asiento del libro
                </h3>
                <ProblemaAlerta
                    v-if="problemaAsientos"
                    :problema="problemaAsientos"
                    :reintentar="reintentarAsientos"
                    :reintentando="cargandoAsientos"
                />
                <USkeleton
                    v-else-if="cargandoAsientos"
                    class="h-24 w-full"
                />
                <p
                    v-else-if="!asientos.length"
                    class="text-sm text-muted"
                >
                    No se encontró el asiento de esta bonificación en el libro diario.
                </p>
                <div
                    v-else
                    class="grid gap-3 lg:grid-cols-2"
                >
                    <AsientoContable
                        v-for="asiento in asientos"
                        :key="asiento.id"
                        :asiento="asiento"
                        :con-origen="false"
                    />
                </div>
            </section>
        </div>
    </PanelPagina>
</template>
