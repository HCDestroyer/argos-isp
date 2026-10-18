<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/** Configuración → Integraciones: hoy solo Horus Flow (tráfico, salud y seguridad de la red). */
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

onMounted(cargar)
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
        </div>
    </PanelPagina>
</template>
