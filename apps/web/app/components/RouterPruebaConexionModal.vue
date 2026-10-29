<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Probar conexión» (`POST /routers/:id/probar-conexion`, `routers.probar_conexion`): al abrir corre
 * los chequeos de túnel, API, equipo y RADIUS y muestra cada uno con icono + texto + color, el
 * tiempo, los datos del equipo (versión, modelo, encendido, CPU) y, si falla, qué revisar. La API
 * responde 200 aunque el router esté caído; al terminar avisa al padre para refrescar la ficha.
 */
const props = defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    probado: [prueba: PruebaConexion]
}>()

const prueba = shallowRef<PruebaConexion | null>(null)
const problema = ref<Problem | null>(null)
const probando = ref(false)

async function probar() {
    probando.value = true
    problema.value = null
    const resultado = await useRouters().probarConexion(props.router.id)
    probando.value = false
    prueba.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        emit('probado', resultado.data)
    }
}

watch(abierto, (valor) => {
    if (valor) {
        prueba.value = null
        void probar()
    }
})

const equipo = computed(() => (prueba.value ? datosEquipo(prueba.value.chequeos) : null))
const resumen = computed(() => {
    if (!prueba.value) {
        return null
    }
    if (prueba.value.ok) {
        return { color: 'success' as const, icono: 'i-lucide-circle-check', titulo: 'Todo en orden', texto: 'Argos llega al router y el router a Argos.' }
    }
    const fallas = prueba.value.chequeos.filter(c => c.ok === false).length
    return fallas
        ? { color: 'error' as const, icono: 'i-lucide-circle-x', titulo: fallas === 1 ? 'Un chequeo falló' : `${fallas} chequeos fallaron`, texto: 'Abajo dice qué revisar en cada uno.' }
        : { color: 'warning' as const, icono: 'i-lucide-circle-alert', titulo: 'No se pudo comprobar todo', texto: 'Algún chequeo no llegó a correr.' }
})
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Probar conexión · ${router.nombre}`"
        description="Comprueba el túnel, la API del router, el equipo y RADIUS. No cambia nada en el router."
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="prueba-conexion"
            >
                <div
                    v-if="probando && !prueba"
                    class="flex flex-col gap-2"
                >
                    <p class="flex items-center gap-2 text-sm text-muted">
                        <UIcon
                            name="i-lucide-loader-circle"
                            class="size-4 animate-spin"
                        />
                        Probando… puede tardar unos segundos si el router no responde.
                    </p>
                    <USkeleton
                        v-for="n in 4"
                        :key="n"
                        class="h-12 w-full"
                    />
                </div>
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    :reintentar="probar"
                    :reintentando="probando"
                />
                <template v-else-if="prueba && resumen">
                    <UAlert
                        :color="resumen.color"
                        variant="subtle"
                        :icon="resumen.icono"
                        :title="resumen.titulo"
                        :description="`${resumen.texto} Probado el ${formatearFechaHora(prueba.probado_en)}.`"
                        data-prueba="prueba-resumen"
                    />

                    <dl
                        v-if="equipo"
                        class="grid grid-cols-2 gap-3 rounded-md border border-default p-3 sm:grid-cols-4"
                        data-prueba="prueba-equipo"
                    >
                        <DatoFicha
                            etiqueta="RouterOS"
                            :valor="equipo.version"
                        />
                        <DatoFicha
                            etiqueta="Modelo"
                            :valor="equipo.modelo"
                        />
                        <DatoFicha
                            etiqueta="Encendido"
                            :valor="equipo.uptime"
                        />
                        <DatoFicha
                            etiqueta="CPU"
                            :valor="equipo.cpu_pct === null ? null : `${equipo.cpu_pct} %`"
                        />
                    </dl>

                    <ul class="flex flex-col divide-y divide-default">
                        <li
                            v-for="chequeo in prueba.chequeos"
                            :key="chequeo.clave"
                            class="flex flex-col gap-1 py-3"
                            :data-chequeo="chequeo.clave"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="text-sm font-medium text-highlighted">{{ ETIQUETAS_CHEQUEO[chequeo.clave] }}</span>
                                <span class="flex items-center gap-2">
                                    <span
                                        v-if="chequeo.ms"
                                        class="text-xs text-muted tabular-nums"
                                    >{{ chequeo.ms.toLocaleString('es-GT') }} ms</span>
                                    <UBadge
                                        :label="estadoChequeo(chequeo).etiqueta"
                                        :icon="estadoChequeo(chequeo).icono"
                                        :color="estadoChequeo(chequeo).color"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </span>
                            </div>
                            <p class="text-xs break-words text-muted">
                                {{ chequeo.detalle }}
                            </p>
                            <p
                                v-if="consejoChequeo(chequeo)"
                                class="flex items-start gap-1.5 text-xs"
                                :class="chequeo.ok === false ? 'text-error' : 'text-default'"
                                data-prueba="consejo-chequeo"
                            >
                                <UIcon
                                    name="i-lucide-lightbulb"
                                    class="mt-0.5 size-3.5 shrink-0"
                                />
                                <span>Qué revisar: {{ consejoChequeo(chequeo) }}</span>
                            </p>
                        </li>
                    </ul>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cerrar"
                    color="neutral"
                    variant="ghost"
                    @click="abierto = false"
                />
                <UButton
                    label="Probar de nuevo"
                    icon="i-lucide-refresh-cw"
                    :loading="probando"
                    data-prueba="probar-de-nuevo"
                    @click="probar"
                />
            </div>
        </template>
    </UModal>
</template>
