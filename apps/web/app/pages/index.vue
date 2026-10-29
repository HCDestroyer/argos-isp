<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

// El cajero entra directo a su caja (`rutaInicio`); el resto ve el tablero.
definePageMeta({
    middleware: [() => {
        const destino = rutaInicio(useUsuarioActual().value)
        if (destino !== '/') {
            return navigateTo(destino, { replace: true })
        }
    }],
})

const { usuario } = useAuth()
const { puede, enlace } = usePermisos()

const secciones = computed(() => SECCIONES_PANEL.filter(seccion => puede(seccion.permiso)))
const hoy = formatearFecha(new Date())
const verTablero = computed(() => puede('reportes.ver'))

const resumen = shallowRef<ResumenDashboard | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

const series = computed(() => (resumen.value ? seriesDashboard(resumen.value) : null))
const conSerie = computed(() => (resumen.value ? haySerie(resumen.value) : false))
const cobranza = computed(() => (resumen.value ? porcentajeCobranza(resumen.value.mes.cobranza_pct) : null))
const actualizado = computed(() => (resumen.value ? actualizacionDashboard(resumen.value) : null))

/** Servicios por estado, con los colores fijos y el enlace a la lista filtrada. */
const estados = computed(() => {
    if (!resumen.value) {
        return []
    }
    const s = resumen.value.servicios
    return [
        { estado: 'activo' as const, etiqueta: 'Activos', cantidad: s.activos },
        { estado: 'limitado' as const, etiqueta: 'Limitados', cantidad: s.limitados },
        { estado: 'suspendido' as const, etiqueta: 'Cortados', cantidad: s.suspendidos },
        { estado: 'retirado' as const, etiqueta: 'Retirados', cantidad: s.retirados },
    ]
})

function plural(cantidad: number, singular: string, varios: string): string {
    return `${cantidad.toLocaleString('es-GT')} ${cantidad === 1 ? singular : varios}`
}

async function cargar() {
    if (!verTablero.value) {
        return
    }
    cargando.value = true
    const resultado = await useReportes().resumenDashboard()
    cargando.value = false
    // Con error no queda nada del resumen anterior: nunca cifras viejas o en cero junto al aviso.
    resumen.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="inicio"
        titulo="Inicio"
        icono="i-lucide-house"
    >
        <template #acciones>
            <UButton
                v-if="verTablero"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                aria-label="Actualizar el tablero"
                :loading="cargando"
                @click="cargar"
            />
        </template>

        <div class="flex flex-col gap-6">
            <div>
                <h2 class="text-xl font-semibold text-highlighted">
                    Hola, {{ usuario?.nombre }}
                </h2>
                <p class="text-sm text-muted">
                    {{ hoy }}<template v-if="verTablero && actualizado">
                        · Datos al {{ formatearFechaHora(actualizado) }}
                    </template>
                </p>
            </div>

            <template v-if="verTablero">
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                    data-prueba="tablero-error"
                />

                <div
                    v-else-if="!resumen"
                    class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
                >
                    <USkeleton
                        v-for="i in 4"
                        :key="i"
                        class="h-28 w-full"
                    />
                    <USkeleton class="h-72 w-full sm:col-span-2 lg:col-span-4" />
                </div>

                <template v-else>
                    <section
                        class="flex flex-col gap-3 surface-card p-4"
                        aria-labelledby="titulo-servicios"
                        data-prueba="tablero-servicios"
                    >
                        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h3
                                id="titulo-servicios"
                                class="text-sm text-muted"
                            >
                                Servicios por estado
                            </h3>
                            <p class="text-xs text-muted">
                                Clientes: {{ resumen.clientes.activos }} al día · {{ resumen.clientes.limitados }} limitados · {{ resumen.clientes.cortados }} cortados
                            </p>
                        </div>
                        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <li
                                v-for="item in estados"
                                :key="item.estado"
                            >
                                <ULink
                                    :to="enlace(`/servicios?estado=${item.estado}`)"
                                    class="flex flex-col gap-1.5 rounded-md p-2 hover:bg-elevated/60"
                                    :data-prueba="`servicios-${item.estado}`"
                                >
                                    <NumeroVivo
                                        :valor="item.cantidad.toLocaleString('es-GT')"
                                        class="text-2xl font-semibold tracking-[-0.02em] text-highlighted"
                                    />
                                    <UBadge
                                        :label="item.etiqueta"
                                        :color="ESTADOS_SERVICIO[item.estado].color"
                                        :icon="ESTADOS_SERVICIO[item.estado].icono"
                                        variant="subtle"
                                        size="sm"
                                        class="self-start"
                                    />
                                </ULink>
                            </li>
                        </ul>
                    </section>

                    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <IndicadorTablero
                            etiqueta="Facturado del mes"
                            :valor="formatearQuetzales(resumen.mes.facturado)"
                            icono="i-lucide-receipt-text"
                            :to="enlace('/facturas')"
                            data-prueba="kpi-mes"
                        >
                            <span class="flex flex-col gap-1.5">
                                <span>
                                    Cobrado {{ formatearQuetzales(resumen.mes.cobrado) }} · {{ cobranza?.texto }}
                                    · pendiente {{ formatearQuetzales(pendienteMes(resumen.mes)) }}
                                </span>
                                <UProgress
                                    :model-value="cobranza?.barra ?? 0"
                                    size="sm"
                                    color="primary"
                                    :aria-label="`Cobranza del mes: ${cobranza?.texto}`"
                                />
                                <span>{{ etiquetaPeriodo(resumen.mes.periodo) }}</span>
                            </span>
                        </IndicadorTablero>
                        <IndicadorTablero
                            etiqueta="Cartera vencida"
                            :valor="formatearQuetzales(resumen.cartera_vencida.monto)"
                            icono="i-lucide-alarm-clock"
                            :to="enlace('/facturas?estado=vencida')"
                            :detalle="`${plural(resumen.cartera_vencida.facturas, 'factura', 'facturas')} · ${plural(resumen.cartera_vencida.clientes, 'cliente', 'clientes')} · por cobrar en total ${formatearQuetzales(resumen.cartera_vencida.pendiente_total)}`"
                            data-prueba="kpi-cartera"
                        />
                        <IndicadorTablero
                            etiqueta="Cobros de hoy"
                            :valor="formatearQuetzales(resumen.hoy.cobrado)"
                            icono="i-lucide-hand-coins"
                            :to="enlace(`/pagos?desde=${resumen.hoy.fecha}&hasta=${resumen.hoy.fecha}`)"
                            :detalle="`${plural(resumen.hoy.pagos, 'pago', 'pagos')} · ${formatearFecha(resumen.hoy.fecha)}`"
                            data-prueba="kpi-hoy"
                        />
                        <IndicadorTablero
                            etiqueta="Promesas activas"
                            :valor="resumen.promesas_activas.cantidad.toLocaleString('es-GT')"
                            icono="i-lucide-calendar-clock"
                            :to="enlace('/promesas?estado=activa')"
                            :detalle="`${formatearQuetzales(resumen.promesas_activas.monto)} prometidos`"
                            data-prueba="kpi-promesas"
                        />
                    </div>

                    <div class="grid gap-4 lg:grid-cols-2">
                        <section
                            class="flex min-w-0 flex-col gap-2 surface-card p-4"
                            aria-labelledby="titulo-montos"
                            data-prueba="grafica-montos"
                        >
                            <h3
                                id="titulo-montos"
                                class="text-sm font-medium text-highlighted"
                            >
                                Facturado y cobrado · últimos 12 meses
                            </h3>
                            <GraficaColumnas
                                v-if="series && conSerie"
                                titulo="Facturado y cobrado por mes"
                                :categorias="series.categorias"
                                :categorias-largas="series.categoriasLargas"
                                :series="series.montos"
                                :hallazgo="hallazgoMontos(resumen)"
                            />
                            <UEmpty
                                v-else
                                icon="i-lucide-chart-column"
                                title="Sin facturación ni cobros en los últimos 12 meses"
                                variant="naked"
                            />
                        </section>
                        <section
                            class="flex min-w-0 flex-col gap-2 surface-card p-4"
                            aria-labelledby="titulo-conteos"
                            data-prueba="grafica-conteos"
                        >
                            <h3
                                id="titulo-conteos"
                                class="text-sm font-medium text-highlighted"
                            >
                                Facturas emitidas y pagos registrados
                            </h3>
                            <GraficaColumnas
                                v-if="series && conSerie"
                                titulo="Facturas y pagos por mes"
                                :categorias="series.categorias"
                                :categorias-largas="series.categoriasLargas"
                                :series="series.conteos"
                                :hallazgo="hallazgoConteos(resumen)"
                                formato="entero"
                            />
                            <UEmpty
                                v-else
                                icon="i-lucide-chart-column"
                                title="Sin movimientos en los últimos 12 meses"
                                variant="naked"
                            />
                        </section>
                    </div>
                </template>
            </template>

            <div class="flex flex-col gap-3">
                <h3 class="text-sm font-medium text-muted">
                    Accesos
                </h3>
                <UPageGrid class="gap-4 sm:gap-6 lg:grid-cols-3">
                    <UPageCard
                        v-for="seccion in secciones"
                        :key="seccion.id"
                        :title="seccion.etiqueta"
                        :description="seccion.descripcion"
                        :icon="seccion.icono"
                        :to="seccion.ruta"
                        variant="subtle"
                    />
                </UPageGrid>
            </div>
        </div>
    </PanelPagina>
</template>
