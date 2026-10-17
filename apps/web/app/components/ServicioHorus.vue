<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Bloque "Horus" de la ficha del servicio (`GET /servicios/:id/horus`, A6): estado de seguridad,
 * hallazgos abiertos y lo último que avisó Horus. Con el conector apagado no se muestra. Si Horus
 * no respondió se ve el último dato conocido con "Dato de hace X"; sin ningún dato, el error con
 * "Reintentar" (nunca un "Limpio" inventado).
 */
const props = defineProps<{
    servicioId: number
}>()

const horus = useHorus()

const consulta = shallowRef<Horus360Servicio | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const ahora = ref(Date.now())

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await horus.servicio360(props.servicioId)
    cargando.value = false
    ahora.value = Date.now()
    consulta.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
watch(() => props.servicioId, cargar)

const seguridad = computed(() => (consulta.value ? leerSeguridad(consulta.value.datos) : null))
const sinSeguridad = computed(() => (consulta.value ? motivoSinSeguridad(consulta.value.datos) : null))
const marca = computed(() => (consulta.value ? marcaDatoViejo(consulta.value.stale, consulta.value.actualizado_en, ahora.value) : null))
const visible = computed(() => problema.value !== null || cargando.value || consulta.value?.conector === 'activo')

defineExpose({ recargar: cargar })
</script>

<template>
    <section
        v-if="visible"
        class="flex flex-col gap-3"
        aria-labelledby="titulo-horus"
        data-prueba="bloque-horus"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3
                id="titulo-horus"
                class="flex items-center gap-2 text-sm font-semibold text-highlighted"
            >
                <UIcon
                    name="i-lucide-radar"
                    class="size-4"
                />
                Horus · seguridad
            </h3>
            <div class="flex items-center gap-2">
                <UButton
                    icon="i-lucide-rotate-cw"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="Actualizar datos de Horus"
                    :loading="cargando"
                    @click="cargar"
                />
            </div>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="cargando && !consulta"
            class="h-20 w-full"
        />
        <template v-else-if="consulta">
            <UAlert
                v-if="!consulta.datos"
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="Horus no devolvió datos de este servicio"
                :description="consulta.error ?? 'Sin respuesta de Horus.'"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', loading: cargando, onClick: cargar }]"
                data-prueba="horus-sin-datos"
            />
            <template v-else>
                <UAlert
                    v-if="consulta.stale"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-history"
                    :title="`Horus no respondió: se muestra el último dato conocido${consulta.actualizado_en ? ` (${formatearFechaHora(consulta.actualizado_en)})` : ''}`"
                    :description="consulta.error ?? undefined"
                    data-prueba="horus-stale"
                />

                <div class="surface-card flex flex-col gap-3 p-4">
                    <SeguridadHorusBadge
                        v-if="seguridad"
                        :estado="seguridad.estado"
                        :hallazgos-abiertos="seguridad.hallazgos_abiertos"
                        :marca="marca"
                    />
                    <p
                        v-else
                        class="text-sm text-muted"
                        data-prueba="horus-sin-seguridad"
                    >
                        Horus no informó el estado de seguridad{{ sinSeguridad ? `: ${sinSeguridad}` : '' }}.
                    </p>

                    <p
                        v-if="consulta.ip"
                        class="text-xs text-muted"
                    >
                        Consultado por {{ consulta.consulta === 'address' ? 'la IP' : 'el servicio' }} · IP actual <span class="font-mono">{{ consulta.ip }}</span>
                    </p>

                    <ul
                        v-if="seguridad?.hallazgos.length"
                        class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        aria-label="Hallazgos abiertos"
                        data-prueba="hallazgos-horus"
                    >
                        <li
                            v-for="hallazgo in seguridad.hallazgos"
                            :key="hallazgo.id"
                            class="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                        >
                            <div class="flex min-w-0 flex-col gap-1">
                                <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                    {{ nombreTipoHallazgo(hallazgo.tipo) }}
                                    <UBadge
                                        :label="`Severidad ${presentacionSeveridad(hallazgo.severidad).etiqueta.toLowerCase()}`"
                                        :icon="presentacionSeveridad(hallazgo.severidad).icono"
                                        :color="presentacionSeveridad(hallazgo.severidad).color"
                                        variant="outline"
                                        size="sm"
                                    />
                                </span>
                                <span
                                    v-if="hallazgo.resumen"
                                    class="break-words text-sm text-default"
                                >{{ hallazgo.resumen }}</span>
                                <span
                                    v-if="hallazgo.abierto_en"
                                    class="text-xs text-muted"
                                >Abierto {{ formatearFechaHora(hallazgo.abierto_en) }}</span>
                            </div>
                            <VerEnHorusBoton
                                tipo="hallazgo"
                                :id-externo="hallazgo.id"
                                size="xs"
                                variant="ghost"
                                class="self-start"
                            />
                        </li>
                    </ul>
                    <p
                        v-else-if="seguridad"
                        class="text-sm text-muted"
                    >
                        Sin hallazgos abiertos.
                    </p>
                </div>
            </template>

            <div
                v-if="consulta.eventos_recientes.length"
                class="flex flex-col gap-2"
            >
                <h4 class="text-xs font-medium text-muted">
                    Últimos avisos de Horus
                </h4>
                <ul class="flex flex-col gap-1.5">
                    <li
                        v-for="evento in consulta.eventos_recientes"
                        :key="evento.id"
                        class="flex flex-col text-sm sm:flex-row sm:gap-2"
                    >
                        <span class="shrink-0 text-xs text-muted sm:w-40">{{ formatearFechaHora(evento.ocurrido_en ?? evento.recibido_en) }}</span>
                        <span class="break-words">{{ evento.resumen ?? evento.evento }}</span>
                    </li>
                </ul>
            </div>
        </template>
    </section>
</template>
