<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Código de corte» en la ficha del servicio (`GET /servicios/:id/codigo-corte`, `servicios.ver`;
 * `contratos/corte-identificacion.md` §5 bis): si el router manda a este suspendido a la página de
 * corte con su código, desde cuándo, o si está en gracia tras reactivarse. El código nunca se muestra
 * (la API no lo devuelve: da acceso a la página de corte del servicio). Si la lectura falla, el error con
 * «Reintentar» y ningún estado inventado.
 */
const props = defineProps<{
    servicioId: number
}>()

const codigo = shallowRef<CodigoCorteServicio | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useServicios().codigoCorte(props.servicioId)
    cargando.value = false
    codigo.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
watch(() => props.servicioId, cargar)

const vista = computed(() => (codigo.value ? presentarCodigoCorte(codigo.value) : null))

defineExpose({ recargar: cargar })
</script>

<template>
    <UPageCard
        title="Código de corte"
        icon="i-lucide-ticket"
        variant="subtle"
        data-prueba="codigo-corte-servicio"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="cargando && !codigo"
            class="flex flex-col gap-2"
        >
            <USkeleton class="h-5 w-32" />
            <USkeleton class="h-4 w-64" />
        </div>
        <div
            v-else-if="codigo && vista"
            class="flex flex-col gap-3"
        >
            <div class="flex flex-wrap items-center gap-2">
                <UBadge
                    :label="vista.etiqueta"
                    :icon="vista.icono"
                    :color="vista.color"
                    variant="subtle"
                    data-prueba="codigo-corte-estado"
                />
                <UBadge
                    :label="`Router: ${CORTE_IDENTIFICACION[codigo.corte_identificacion].etiqueta.toLowerCase()}`"
                    :icon="CORTE_IDENTIFICACION[codigo.corte_identificacion].icono"
                    color="neutral"
                    variant="outline"
                    size="sm"
                />
            </div>
            <p
                class="text-sm text-muted"
                data-prueba="codigo-corte-detalle"
            >
                {{ vista.detalle }}
            </p>
            <p class="text-xs text-dimmed">
                El código no se muestra: da acceso a la página de corte de este servicio y solo lo lleva la regla del router.
            </p>
        </div>
    </UPageCard>
</template>
