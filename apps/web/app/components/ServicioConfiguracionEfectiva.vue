<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración efectiva del servicio (`GET /servicios/:id/configuracion-efectiva`, `servicios.ver`):
 * el plan como queda en su router (rate-limit activo y limitado, profile, pools) y la facturación
 * de su plantilla con las excepciones del servicio ya aplicadas; cada campo que viene de una
 * excepción lleva la marca. Lo calcula la API: el panel no combina nada. Quien lo monta comprobó
 * `servicios.ver`.
 */
const props = defineProps<{
    servicioId: number
}>()

const configuracion = shallowRef<ConfiguracionEfectivaServicio | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await useServicios().configuracionEfectiva(props.servicioId)
    cargando.value = false
    configuracion.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => props.servicioId, () => void cargar(), { immediate: true })
defineExpose({ recargar: cargar })

const facturacion = computed(() => configuracion.value?.facturacion ?? null)
const excepciones = computed(() => new Set(facturacion.value?.excepciones ?? []))

function conExcepcion(...campos: string[]): boolean {
    return campos.some(c => excepciones.value.has(c))
}
</script>

<template>
    <UPageCard
        title="Configuración efectiva"
        description="Lo que de verdad aplica: el plan en su router y la plantilla con las excepciones del servicio."
        icon="i-lucide-sliders-horizontal"
        variant="subtle"
        data-prueba="configuracion-efectiva"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="cargando && !configuracion"
            class="flex flex-col gap-2"
        >
            <USkeleton class="h-5 w-64" />
            <USkeleton class="h-5 w-48" />
        </div>
        <div
            v-else-if="configuracion"
            class="grid gap-6 lg:grid-cols-2"
        >
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <DatoFicha
                    etiqueta="Plan en el router"
                    :valor="configuracion.plan.nombre"
                />
                <DatoFicha
                    etiqueta="Velocidad"
                    :valor="`${formatearVelocidad(configuracion.plan.bajada_kbps)} / ${formatearVelocidad(configuracion.plan.subida_kbps)}`"
                />
                <DatoFicha
                    etiqueta="Rate-limit activo"
                    :valor="configuracion.plan.rate_limit"
                    mono
                    class="sm:col-span-2"
                />
                <DatoFicha
                    etiqueta="Rate-limit limitado"
                    :valor="configuracion.plan.rate_limit_limitado"
                    mono
                    class="sm:col-span-2"
                />
                <DatoFicha
                    etiqueta="Profile PPP"
                    :valor="configuracion.plan.profile_ppp"
                    mono
                />
                <DatoFicha
                    etiqueta="Pool IPv4"
                    :valor="configuracion.plan.pool_ipv4"
                    mono
                />
            </dl>
            <dl
                v-if="facturacion"
                class="grid gap-x-6 gap-y-3 sm:grid-cols-2"
            >
                <DatoFicha
                    etiqueta="Plantilla"
                    :valor="facturacion.nombre"
                />
                <div class="flex flex-col gap-1">
                    <dt class="flex items-center gap-1.5 text-xs text-muted">
                        Ciclo
                        <UBadge
                            v-if="conExcepcion('dia', 'prorrateo')"
                            label="Excepción"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </dt>
                    <dd class="text-sm">
                        {{ resumenCiclo(facturacion) }}
                    </dd>
                </div>
                <div class="flex flex-col gap-1 sm:col-span-2">
                    <dt class="flex items-center gap-1.5 text-xs text-muted">
                        Corte
                        <UBadge
                            v-if="conExcepcion('dias_gracia', 'facturas_para_limitar', 'facturas_para_cortar', 'hora_corte')"
                            label="Excepción"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </dt>
                    <dd class="text-sm">
                        {{ resumenCorte(facturacion) }}
                    </dd>
                </div>
                <div class="flex flex-col gap-1">
                    <dt class="flex items-center gap-1.5 text-xs text-muted">
                        Mora
                        <UBadge
                            v-if="conExcepcion('mora_tipo', 'mora_valor', 'mora_recurrente')"
                            label="Excepción"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </dt>
                    <dd class="text-sm">
                        {{ resumenMora(facturacion) }}
                    </dd>
                </div>
                <div class="flex flex-col gap-1">
                    <dt class="flex items-center gap-1.5 text-xs text-muted">
                        Promesas
                        <UBadge
                            v-if="conExcepcion('reglas_promesa')"
                            label="Excepción"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </dt>
                    <dd class="text-sm">
                        {{ resumenPromesas(facturacion.reglas_promesa) }}
                    </dd>
                </div>
            </dl>
            <UAlert
                v-else
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="El servicio no tiene plantilla de facturación y no hay una por defecto."
            />
        </div>
    </UPageCard>
</template>
