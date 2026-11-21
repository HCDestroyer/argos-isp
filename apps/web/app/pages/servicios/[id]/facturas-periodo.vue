<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { BreadcrumbItem, FormSubmitEvent } from '@nuxt/ui'

/**
 * Emitir facturas de periodos de un servicio a mano (A3, pedido del PM del 19 nov): pago por
 * adelantado (hasta 12 periodos futuros) y periodos que el cron no emitió. La vista previa
 * (`facturas.ver`) dice el estado, monto, vencimiento y lo que cubre el saldo a favor; la emisión
 * (`facturas.emitir_periodos`) nunca duplica lo ya emitido o bonificado. Los periodos anteriores al
 * inicio del servicio (hasta 24, pedido del PM del 21 nov) o del cobro solo con
 * `facturas.emitir_periodo_anterior` y motivo, y vencen desde hoy. Cada periodo cobra el precio
 * completo (sin prorrateo); con `facturas.editar_monto_periodo` se puede cambiar el monto, con motivo.
 */
definePageMeta({ permiso: 'facturas.emitir_periodos' })

const route = useRoute()
const toast = useToast()
const { puede, enlace } = usePermisos()

const servicioId = computed(() => Number(route.params.id))
const servicio = shallowRef<Servicio | null>(null)
const vista = shallowRef<PeriodosFacturables | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const estado = reactive<{ periodos: string[], montos: MontosEditados, motivo: string }>({ periodos: [], montos: {}, motivo: '' })
const verAnteriores = ref(false)
const adelantarMeses = ref(3)
const enviando = ref(false)
const problemaEnvio = ref<Problem | null>(null)
const resultado = shallowRef<FacturasPeriodoEmitidas | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const conAnteriores = computed(() => puede('facturas.emitir_periodo_anterior'))
const conEdicion = computed(() => puede('facturas.editar_monto_periodo'))
const titulo = computed(() => (servicio.value ? etiquetaServicio(servicio.value) : `Servicio #${servicioId.value}`))

useHead(() => ({ title: `Emitir facturas de periodos · ${titulo.value} · ArgosIsp` }))

const migas = computed<BreadcrumbItem[]>(() => [
    { label: 'Servicios', icon: 'i-lucide-wifi', to: enlace('/servicios') },
    { label: titulo.value, to: enlace(`/servicios/${servicioId.value}`) },
    { label: 'Emitir facturas de periodos' },
])

const periodos = computed(() => vista.value?.periodos ?? [])
const cantidadAnteriores = computed(() => periodos.value.filter(p => p.estado === 'antes_del_inicio').length)
// Los anteriores al inicio del servicio van plegados: se muestran al pedirlos o si hay uno marcado.
const periodosVisibles = computed(() => periodos.value.filter(p => verAnteriores.value || p.estado !== 'antes_del_inicio' || estado.periodos.includes(p.periodo)))
const futurosDisponibles = computed(() => proximosFuturos(periodos.value, Number.POSITIVE_INFINITY).length)
const eligeAnterior = computed(() => periodos.value.some(p => esPeriodoAnterior(p) && estado.periodos.includes(p.periodo)))
const eligeAntesDelInicio = computed(() => periodos.value.some(p => p.estado === 'antes_del_inicio' && estado.periodos.includes(p.periodo)))
const hayMontoEditado = computed(() => periodos.value.some(p => estado.periodos.includes(p.periodo) && montoEditado(p, estado.montos) !== null))
const motivoObligatorio = computed(() => eligeAnterior.value || hayMontoEditado.value)
const esquema = computed(() => esquemaFacturasPeriodo(eligeAnterior.value, periodos.value))
const resumen = computed(() => (vista.value ? resumenEmision(periodos.value, estado.periodos, vista.value.saldo_a_favor, estado.montos) : null))
const enlaceFacturas = computed(() => (vista.value ? enlace(`/facturas?cliente=${vista.value.cliente_id}&servicio=${servicioId.value}`) : undefined))

async function cargar() {
    // La vista previa pide `facturas.ver` además del permiso de la pantalla.
    if (!puede('facturas.ver')) {
        cargando.value = false
        problema.value = problemaSinPermiso('facturas.ver')
        return
    }
    cargando.value = true
    const [respuestaServicio, respuestaVista] = await Promise.all([
        puede('servicios.ver') ? useServicios().ver(servicioId.value) : null,
        useFacturasPeriodo().periodos(servicioId.value),
    ])
    cargando.value = false
    if (respuestaServicio?.ok) {
        servicio.value = respuestaServicio.data
    }
    if (respuestaVista.ok) {
        vista.value = respuestaVista.data
        problema.value = null
        // Lo marcado que ya no se puede elegir (se emitió mientras tanto) se desmarca.
        estado.periodos = estado.periodos.filter(p => respuestaVista.data.periodos.some(f => f.periodo === p && periodoElegible(f, conAnteriores.value)))
    }
    else {
        vista.value = null
        problema.value = respuestaVista.problema
    }
}

function marcar(periodo: string, marcado: boolean) {
    const otros = estado.periodos.filter(p => p !== periodo)
    estado.periodos = marcado ? [...otros, periodo].sort() : otros
    if (!marcado) {
        const { [periodo]: _quitado, ...resto } = estado.montos
        estado.montos = resto
    }
}

function marcado(periodo: string): boolean {
    return estado.periodos.includes(periodo)
}

function aplicarAdelanto() {
    estado.periodos = adelantar(periodos.value, estado.periodos, adelantarMeses.value)
}

async function emitirDatos(datos: DatosFacturasPeriodo) {
    enviando.value = true
    problemaEnvio.value = null
    const respuesta = await useFacturasPeriodo().emitir(servicioId.value, cuerpoFacturasPeriodo(datos, periodos.value), claveIdempotencia)
    enviando.value = false
    if (!respuesta.ok) {
        problemaEnvio.value = problemaEmision(respuesta.problema)
        return
    }
    resultado.value = respuesta.data
    claveIdempotencia = nuevaClaveIdempotencia()
    estado.periodos = []
    estado.montos = {}
    estado.motivo = ''
    toast.add({
        title: 'Facturas de periodos',
        description: avisoEmision(respuesta.data),
        icon: 'i-lucide-receipt',
        color: 'success',
        actions: enlaceFacturas.value ? [{ label: 'Ver facturas', to: enlaceFacturas.value, color: 'neutral', variant: 'outline' }] : undefined,
    })
    await cargar()
}

function enviar(evento: FormSubmitEvent<DatosFacturasPeriodo>) {
    return emitirDatos(evento.data)
}

/** «Reintentar» del error de la emisión: lo mismo, con la misma `Idempotency-Key`. */
function reintentarEnvio() {
    const datos = esquema.value.safeParse(estado)
    if (datos.success) {
        void emitirDatos(datos.data)
    }
}

watch(servicioId, () => {
    estado.periodos = []
    estado.montos = {}
    verAnteriores.value = false
    resultado.value = null
    void cargar()
})
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="servicio-facturas-periodo"
        titulo="Emitir facturas de periodos"
        icono="i-lucide-calendar-plus"
    >
        <template #acciones>
            <UButton
                :to="enlace(`/servicios/${servicioId}`)"
                icon="i-lucide-arrow-left"
                label="Atrás"
                aria-label="Atrás"
                color="neutral"
                variant="ghost"
                :ui="{ label: 'hidden sm:inline' }"
                data-prueba="facturas-periodo-atras"
            />
        </template>

        <div class="flex max-w-4xl flex-col gap-4">
            <UBreadcrumb :items="migas" />

            <div
                v-if="cargando && !vista && !problema"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-16 w-full" />
                <USkeleton class="h-64 w-full" />
            </div>

            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="facturas-periodo-problema"
            />

            <template v-else-if="vista">
                <UAlert
                    v-if="!vista.emitible"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-circle-slash"
                    title="No se pueden emitir facturas de periodos"
                    :description="vista.motivo ? MOTIVOS_NO_EMITIBLE[vista.motivo] : undefined"
                    data-prueba="facturas-periodo-no-emitible"
                />

                <template v-else>
                    <p class="text-sm text-muted">
                        Elige los periodos que quieres facturar ya: los futuros para cobrar por adelantado (hasta {{ vista.maximo_futuros }}), los que el sistema no emitió o, con permiso, los anteriores al inicio del servicio (hasta {{ vista.maximo_anteriores }}).
                        Cada periodo cobra el mes completo. Lo ya emitido o bonificado nunca se duplica. Los futuros vencen en su fecha normal; los anteriores vencen desde hoy.
                    </p>

                    <UCard
                        v-if="resultado"
                        data-prueba="facturas-periodo-resultado"
                    >
                        <template #header>
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <h2 class="text-sm font-semibold text-highlighted">
                                    {{ avisoEmision(resultado) }}
                                </h2>
                                <UButton
                                    v-if="enlaceFacturas"
                                    :to="enlaceFacturas"
                                    label="Ver facturas del servicio"
                                    trailing-icon="i-lucide-arrow-right"
                                    color="neutral"
                                    variant="link"
                                    size="sm"
                                    data-prueba="facturas-periodo-ver-facturas"
                                />
                            </div>
                        </template>
                        <ul class="flex flex-col gap-2 text-sm">
                            <li
                                v-for="c in resultado.creadas"
                                :key="`c-${c.periodo}`"
                                class="flex flex-wrap items-center justify-between gap-2"
                                :data-creada="c.periodo"
                            >
                                <span class="flex items-center gap-2">
                                    <UBadge
                                        :label="estadoFacturaVisual(c.estado).etiqueta"
                                        :icon="estadoFacturaVisual(c.estado).icono"
                                        :color="estadoFacturaVisual(c.estado).color"
                                        variant="subtle"
                                        size="sm"
                                    />
                                    <ULink
                                        :to="enlace(`/facturas/${c.factura_id}`)"
                                        class="font-medium text-highlighted hover:text-primary"
                                    >
                                        Factura #{{ c.factura_id }} · {{ etiquetaPeriodo(c.periodo) }}
                                    </ULink>
                                </span>
                                <span class="tabular-nums text-muted">
                                    {{ formatearQuetzales(c.total) }} · vence {{ formatearFecha(c.vence_en) }}<template v-if="montoPositivo(c.pagado)"> · {{ formatearQuetzales(c.pagado) }} con saldo a favor</template>
                                </span>
                            </li>
                            <li
                                v-for="b in resultado.bonificadas"
                                :key="`b-${b.periodo}`"
                                class="flex items-center gap-2"
                            >
                                <UBadge
                                    :label="ESTADOS_PERIODO.bonificada.etiqueta"
                                    :icon="ESTADOS_PERIODO.bonificada.icono"
                                    :color="ESTADOS_PERIODO.bonificada.color"
                                    variant="subtle"
                                    size="sm"
                                />
                                <ULink
                                    :to="enlace(`/bonificaciones/${b.bonificacion_id}`)"
                                    class="font-medium text-highlighted hover:text-primary"
                                >
                                    {{ etiquetaPeriodo(b.periodo) }}: quedó en cero
                                </ULink>
                            </li>
                            <li
                                v-for="o in resultado.omitidas"
                                :key="`o-${o.periodo}`"
                                class="flex items-center gap-2 text-muted"
                                :data-omitida="o.periodo"
                            >
                                <UIcon
                                    name="i-lucide-skip-forward"
                                    class="size-4 shrink-0"
                                />
                                <span>{{ etiquetaPeriodo(o.periodo) }}: no se emitió. {{ MOTIVOS_OMITIDA[o.motivo] }}.</span>
                            </li>
                        </ul>
                        <p class="mt-3 text-xs text-muted">
                            Saldo a favor que queda: {{ formatearQuetzales(resultado.saldo_a_favor) }}
                        </p>
                    </UCard>

                    <UForm
                        :schema="esquema"
                        :state="estado"
                        class="flex flex-col gap-4"
                        data-prueba="form-facturas-periodo"
                        @submit="enviar"
                    >
                        <div class="flex flex-wrap items-end gap-2">
                            <UFormField
                                label="Adelantar meses"
                                :hint="`hasta ${futurosDisponibles}`"
                            >
                                <UInputNumber
                                    v-model="adelantarMeses"
                                    :min="1"
                                    :max="Math.max(1, futurosDisponibles)"
                                    class="w-32"
                                    data-prueba="adelantar-meses"
                                />
                            </UFormField>
                            <UButton
                                :label="`Adelantar ${adelantarMeses} ${adelantarMeses === 1 ? 'mes' : 'meses'}`"
                                icon="i-lucide-fast-forward"
                                color="neutral"
                                variant="outline"
                                :disabled="futurosDisponibles === 0"
                                data-prueba="adelantar"
                                @click="aplicarAdelanto"
                            />
                        </div>

                        <UFormField
                            name="periodos"
                            label="Periodos"
                        >
                            <UButton
                                v-if="cantidadAnteriores > 0"
                                :label="verAnteriores ? 'Ocultar periodos antes del inicio del servicio' : `Ver ${cantidadAnteriores} periodos antes del inicio del servicio`"
                                :icon="verAnteriores ? 'i-lucide-chevron-up' : 'i-lucide-history'"
                                color="neutral"
                                variant="link"
                                size="sm"
                                class="mb-2 px-0"
                                data-prueba="ver-anteriores"
                                @click="verAnteriores = !verAnteriores"
                            />
                            <ul
                                class="flex flex-col divide-y divide-default rounded-lg border border-default"
                                data-prueba="lista-periodos"
                            >
                                <li
                                    v-for="p in periodosVisibles"
                                    :key="p.periodo"
                                    class="flex items-start gap-3 p-3"
                                    :data-periodo="p.periodo"
                                    :data-estado="p.estado"
                                >
                                    <UCheckbox
                                        v-if="periodoElegible(p, conAnteriores)"
                                        :model-value="marcado(p.periodo)"
                                        :aria-label="`Emitir ${etiquetaPeriodo(p.periodo)}`"
                                        class="mt-0.5"
                                        :data-prueba="`marcar-${p.periodo}`"
                                        @update:model-value="marcar(p.periodo, $event === true)"
                                    />
                                    <UIcon
                                        v-else
                                        :name="p.factura_id || p.bonificacion_id ? 'i-lucide-check' : 'i-lucide-lock'"
                                        class="mt-0.5 size-4 shrink-0 text-dimmed"
                                        :aria-label="p.factura_id || p.bonificacion_id ? 'Ya emitido' : 'No se puede elegir'"
                                    />
                                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <span class="text-sm font-medium text-highlighted">{{ etiquetaPeriodo(p.periodo) }}</span>
                                            <UBadge
                                                :label="ESTADOS_PERIODO[p.estado].etiqueta"
                                                :icon="ESTADOS_PERIODO[p.estado].icono"
                                                :color="ESTADOS_PERIODO[p.estado].color"
                                                variant="subtle"
                                                size="sm"
                                                data-prueba="estado-periodo"
                                            />
                                            <UBadge
                                                v-if="p.factura_estado"
                                                :label="estadoFacturaVisual(p.factura_estado).etiqueta"
                                                :icon="estadoFacturaVisual(p.factura_estado).icono"
                                                :color="estadoFacturaVisual(p.factura_estado).color"
                                                variant="outline"
                                                size="sm"
                                            />
                                        </div>
                                        <span class="text-xs text-muted">
                                            Del {{ formatearFecha(p.periodo) }} al {{ formatearFecha(p.hasta) }}<template v-if="p.prorrateado"> · proporcional, {{ p.dias }} de {{ p.dias_ciclo }} días</template> · vence {{ formatearFecha(p.vence_en) }}
                                        </span>
                                        <ULink
                                            v-if="p.factura_id"
                                            :to="enlace(`/facturas/${p.factura_id}`)"
                                            class="text-xs text-muted hover:text-primary"
                                        >
                                            Factura #{{ p.factura_id }}
                                        </ULink>
                                        <ULink
                                            v-else-if="p.bonificacion_id"
                                            :to="enlace(`/bonificaciones/${p.bonificacion_id}`)"
                                            class="text-xs text-muted hover:text-primary"
                                        >
                                            Bonificación #{{ p.bonificacion_id }}
                                        </ULink>
                                        <span
                                            v-if="esPeriodoAnterior(p) && !conAnteriores"
                                            class="text-xs text-muted"
                                        >
                                            {{ p.estado === 'antes_del_inicio' ? 'Anterior al inicio del servicio' : 'Anterior al inicio del cobro' }}: hace falta el permiso «Emitir periodo anterior».
                                        </span>
                                        <span
                                            v-if="p.error"
                                            class="text-xs text-error"
                                            data-prueba="periodo-error"
                                        >
                                            No se pudo calcular el monto: {{ p.error }}
                                        </span>
                                    </div>
                                    <div class="flex shrink-0 flex-col items-end gap-0.5 text-right">
                                        <UFormField
                                            v-if="conEdicion && marcado(p.periodo)"
                                            :name="`montos.${p.periodo}`"
                                            size="sm"
                                            :ui="{ error: 'max-w-32 text-right' }"
                                        >
                                            <UInput
                                                v-model="estado.montos[p.periodo]"
                                                inputmode="decimal"
                                                :placeholder="p.monto ?? undefined"
                                                :aria-label="`Monto de ${etiquetaPeriodo(p.periodo)}`"
                                                class="w-32"
                                                :ui="{ base: 'text-right tabular-nums' }"
                                                :data-prueba="`monto-${p.periodo}`"
                                            >
                                                <template #leading>
                                                    <span class="text-xs text-muted">Q</span>
                                                </template>
                                            </UInput>
                                        </UFormField>
                                        <span
                                            v-else
                                            class="text-sm font-medium tabular-nums text-highlighted"
                                        >{{ formatearQuetzales(p.monto) }}</span>
                                        <span
                                            v-if="marcado(p.periodo) && montoEditado(p, estado.montos)"
                                            class="text-xs text-warning"
                                            :data-prueba="`monto-editado-${p.periodo}`"
                                        >calculado {{ formatearQuetzales(p.monto) }}</span>
                                        <span
                                            v-if="p.sera_bonificacion"
                                            class="text-xs text-muted"
                                        >quedaría bonificado</span>
                                        <span
                                            v-else-if="cubiertoPorSaldo(p)"
                                            class="text-xs text-success"
                                            data-prueba="cubierto-saldo"
                                        >{{ formatearQuetzales(cubiertoPorSaldo(p)) }} cubierto por saldo a favor</span>
                                        <span
                                            v-else-if="p.factura_id && montoPositivo(p.pagado)"
                                            class="text-xs text-muted"
                                        >pagado {{ formatearQuetzales(p.pagado) }}</span>
                                    </div>
                                </li>
                            </ul>
                        </UFormField>

                        <UAlert
                            v-if="eligeAnterior"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-history"
                            title="Excepción a «no cobrar hacia atrás»"
                            :description="eligeAntesDelInicio
                                ? 'Vas a cobrar meses de antes del inicio del servicio. Es una excepción: escribe el motivo, queda en la factura y en la bitácora. Estas facturas vencen desde hoy, con los días de gracia de la plantilla, para que el cliente no quede cortado de inmediato.'
                                : `El sistema factura este servicio desde el ${formatearFecha(vista.facturar_desde)} y nunca cobra hacia atrás. Emitir un periodo anterior es una excepción: escribe el motivo, queda en la factura y en la bitácora. Vence desde hoy, con los días de gracia de la plantilla.`"
                            data-prueba="aviso-anterior"
                        />

                        <UFormField
                            name="motivo"
                            label="Motivo"
                            eager-validation
                            :required="motivoObligatorio"
                            :hint="motivoObligatorio ? undefined : 'Opcional'"
                            :description="hayMontoEditado ? 'Cambiaste un monto: explica por qué. Queda guardado en la factura y en la bitácora, con el monto calculado y el cobrado.' : 'Queda guardado en la factura y en la bitácora.'"
                        >
                            <UTextarea
                                v-model="estado.motivo"
                                :rows="2"
                                :maxlength="500"
                                class="w-full"
                                placeholder="Ej.: el cliente paga tres meses por adelantado"
                                data-prueba="motivo-periodos"
                            />
                        </UFormField>

                        <div
                            class="flex flex-col gap-1 rounded-lg border border-default p-3 text-sm"
                            data-prueba="resumen-periodos"
                        >
                            <p
                                v-if="resumen && resumen.cantidad === 0"
                                class="text-muted"
                            >
                                Marca los periodos que quieres emitir para ver el total.
                            </p>
                            <template v-else-if="resumen">
                                <div class="flex justify-between gap-2">
                                    <span class="text-muted">Total de {{ resumen.cantidad }} {{ resumen.cantidad === 1 ? 'periodo' : 'periodos' }}</span>
                                    <span
                                        class="tabular-nums text-highlighted"
                                        data-prueba="resumen-total"
                                    >{{ formatearQuetzales(resumen.total) }}</span>
                                </div>
                                <div class="flex justify-between gap-2">
                                    <span class="text-muted">Cubre el saldo a favor ({{ formatearQuetzales(vista.saldo_a_favor) }} disponible)</span>
                                    <span
                                        class="tabular-nums text-success"
                                        data-prueba="resumen-cubre"
                                    >{{ formatearQuetzales(resumen.cubre) }}</span>
                                </div>
                                <div class="flex justify-between gap-2 font-medium">
                                    <span class="text-highlighted">Queda por cobrar</span>
                                    <span
                                        class="tabular-nums text-highlighted"
                                        data-prueba="resumen-por-cobrar"
                                    >{{ formatearQuetzales(resumen.porCobrar) }}</span>
                                </div>
                            </template>
                        </div>

                        <ProblemaAlerta
                            v-if="problemaEnvio"
                            :problema="problemaEnvio"
                            :reintentar="reintentarEnvio"
                            :reintentando="enviando"
                            data-prueba="facturas-periodo-error-envio"
                        />

                        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <UButton
                                :to="enlace(`/servicios/${servicioId}`)"
                                label="Cancelar"
                                color="neutral"
                                variant="ghost"
                                class="justify-center"
                            />
                            <UButton
                                type="submit"
                                :label="estado.periodos.length ? `Emitir ${estado.periodos.length} ${estado.periodos.length === 1 ? 'factura' : 'facturas'}` : 'Emitir facturas'"
                                icon="i-lucide-receipt"
                                :loading="enviando"
                                :disabled="!estado.periodos.length"
                                class="justify-center"
                                data-prueba="emitir-periodos"
                            />
                        </div>
                    </UForm>
                </template>
            </template>
        </div>
    </PanelPagina>
</template>
