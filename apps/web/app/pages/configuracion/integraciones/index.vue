<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración → Integraciones: Horus Flow (tráfico, salud y seguridad de la red) e Iris
 * (tickets, órdenes de trabajo y comercial). Cada tarjeta lee su conector por separado: si una
 * falla, la otra se ve igual.
 */
definePageMeta({ permiso: 'horus.ver' })

useHead({ title: 'Integraciones · ArgosIsp' })

const conector = shallowRef<ConectorHorus | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useHorus().conector()
    cargando.value = false
    conector.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

const { puede } = usePermisos()
const verIris = computed(() => puede('iris.ver'))

const conectorIris = shallowRef<ConectorIris | null>(null)
const cargandoIris = ref(false)
const problemaIris = ref<Problem | null>(null)

async function cargarIris() {
    cargandoIris.value = true
    problemaIris.value = null
    const resultado = await useIris().conector()
    cargandoIris.value = false
    conectorIris.value = resultado.ok ? resultado.data : null
    problemaIris.value = resultado.ok ? null : resultado.problema
}

const presentacionIris = computed(() => (conectorIris.value ? presentacionConectorIris(conectorIris.value) : null))

onMounted(() => {
    void cargar()
    if (verIris.value) {
        void cargarIris()
    }
})
</script>

<template>
    <PanelPagina
        id="integraciones"
        titulo="Integraciones"
        icono="i-lucide-blocks"
    >
        <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <UPageCard
                title="Horus Flow"
                description="Consumo, salud y seguridad de cada servicio, avisos de Horus y autologin entre los dos sistemas."
                icon="i-lucide-radar"
                data-prueba="tarjeta-horus"
            >
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <USkeleton
                    v-else-if="!conector"
                    class="h-6 w-28"
                />
                <div v-else>
                    <UBadge
                        :label="conector.activo ? 'Activa' : (conector.version === 0 ? 'Sin conectar' : 'Apagada')"
                        :icon="conector.activo ? 'i-lucide-plug-zap' : 'i-lucide-power-off'"
                        :color="conector.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        data-prueba="estado-tarjeta-horus"
                    />
                </div>
                <UButton
                    to="/configuracion/integraciones/horus"
                    label="Configurar"
                    icon="i-lucide-settings-2"
                    color="neutral"
                    variant="outline"
                    class="self-start"
                    data-prueba="configurar-horus"
                />
            </UPageCard>
            <UPageCard
                v-if="verIris"
                title="Iris"
                description="Tickets, órdenes de trabajo y seguimiento comercial: Iris lee clientes y servicios, activa instalaciones y recibe los avisos de ArgosIsp."
                icon="i-lucide-clipboard-list"
                data-prueba="tarjeta-iris"
            >
                <ProblemaAlerta
                    v-if="problemaIris"
                    :problema="problemaIris"
                    :reintentar="cargarIris"
                    :reintentando="cargandoIris"
                />
                <USkeleton
                    v-else-if="!presentacionIris"
                    class="h-6 w-28"
                />
                <div v-else>
                    <UBadge
                        :label="presentacionIris.etiqueta"
                        :icon="presentacionIris.icono"
                        :color="presentacionIris.color"
                        variant="subtle"
                        data-prueba="estado-tarjeta-iris"
                    />
                </div>
                <UButton
                    to="/configuracion/integraciones/iris"
                    label="Configurar"
                    icon="i-lucide-settings-2"
                    color="neutral"
                    variant="outline"
                    class="self-start"
                    data-prueba="configurar-iris"
                />
            </UPageCard>
        </div>
    </PanelPagina>
</template>
