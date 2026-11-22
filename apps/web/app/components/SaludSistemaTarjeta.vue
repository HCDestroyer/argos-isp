<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Salud del sistema (`GET /sistema/salud`, `sistema.ver_salud`). `compacto` (inicio): estado
 * general, un renglón por grupo con su peor estado y las barras de procesador, memoria y disco (el
 * disco lleva a Almacenamiento). Completo (`/sistema/salud`): cada componente con su detalle.
 * Se refresca a pedido y cada 45 s mientras la pestaña está visible (la API no cachea: nunca más
 * seguido). Con error, «Reintentar» y ninguna cifra.
 */
const props = withDefaults(defineProps<{
    compacto?: boolean
}>(), {
    compacto: false,
})

const { puede, enlace } = usePermisos()
const salud = shallowRef<SaludSistema | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    if (!puede('sistema.ver_salud') || cargando.value) {
        return
    }
    cargando.value = true
    const resultado = await useSistema().salud()
    cargando.value = false
    salud.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

const REFRESCO_MS = 45_000
let temporizador: ReturnType<typeof setInterval> | undefined
function alCambiarVisibilidad() {
    if (document.visibilityState === 'visible') {
        void cargar()
    }
}
onMounted(() => {
    void cargar()
    temporizador = setInterval(() => {
        if (document.visibilityState === 'visible') {
            void cargar()
        }
    }, REFRESCO_MS)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
})
onBeforeUnmount(() => {
    clearInterval(temporizador)
    document.removeEventListener('visibilitychange', alCambiarVisibilidad)
})

const ORDEN: ComponenteSalud['estado'][] = ['caido', 'degradado', 'desconocido', 'ok']
const peor = (estados: ComponenteSalud['estado'][]) => ORDEN.find(estado => estados.includes(estado)) ?? 'desconocido'

/** Un renglón por grupo (sin recursos del host, que van en barras). */
const grupos = computed(() => {
    const lista = salud.value?.componentes ?? []
    return (Object.keys(GRUPOS_SALUD) as ComponenteSalud['grupo'][])
        .filter(grupo => grupo !== 'host' || !props.compacto)
        .map((grupo) => {
            const componentes = lista.filter(componente => componente.grupo === grupo)
            const conProblema = componentes.filter(componente => componente.estado !== 'ok')
            return { grupo, nombre: GRUPOS_SALUD[grupo], componentes, estado: peor(componentes.map(c => c.estado)), resumen: conProblema[0]?.detalle ?? null }
        })
        .filter(grupo => grupo.componentes.length > 0)
})

const recursos = computed(() => (salud.value?.componentes ?? [])
    .filter(componente => componente.grupo === 'host')
    .map(componente => ({ componente, porcentaje: porcentajeRecurso(componente) })))

const avisos = computed(() => (salud.value?.componentes ?? []).filter(componente => componente.estado === 'degradado' || componente.estado === 'caido').length)

function colorBarra(estado: ComponenteSalud['estado']): 'primary' | 'warning' | 'error' | 'neutral' {
    return estado === 'ok' ? 'primary' : estado === 'degradado' ? 'warning' : estado === 'caido' ? 'error' : 'neutral'
}

/** Clase de texto fija por estado (Tailwind no ve clases armadas con plantillas). */
const TEXTO_ESTADO: Record<ComponenteSalud['estado'], string> = {
    ok: 'text-success',
    degradado: 'text-warning',
    caido: 'text-error',
    desconocido: 'text-muted',
}
</script>

<template>
    <section
        class="flex min-w-0 flex-col gap-4 surface-card p-4 sm:p-5"
        aria-labelledby="titulo-salud"
        data-prueba="salud-sistema"
    >
        <header class="flex flex-wrap items-center gap-3">
            <span class="pastilla-icono tono-marca pastilla-tono">
                <UIcon
                    name="i-lucide-heart-pulse"
                    class="size-5"
                />
            </span>
            <h3
                id="titulo-salud"
                class="text-sm font-semibold text-highlighted"
            >
                Salud del sistema
            </h3>
            <UBadge
                v-if="salud"
                :label="avisos ? `${ESTADO_GENERAL[salud.estado_general].etiqueta} · ${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}` : ESTADO_GENERAL[salud.estado_general].etiqueta"
                :color="ESTADO_GENERAL[salud.estado_general].color"
                :icon="ESTADO_GENERAL[salud.estado_general].icono"
                variant="subtle"
                size="sm"
                data-prueba="salud-estado-general"
            />
            <div class="ms-auto flex items-center gap-1">
                <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    title="Actualizar ahora"
                    aria-label="Actualizar la salud del sistema"
                    :loading="cargando"
                    @click="cargar"
                />
                <UButton
                    v-if="compacto && enlace('/sistema/salud')"
                    :to="enlace('/sistema/salud')"
                    label="Ver detalle"
                    trailing-icon="i-lucide-arrow-right"
                    color="neutral"
                    variant="link"
                    size="sm"
                />
            </div>
        </header>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!salud"
            class="grid gap-3 sm:grid-cols-2"
        >
            <USkeleton class="h-32 w-full" />
            <USkeleton class="h-32 w-full" />
        </div>
        <div
            v-else
            class="grid gap-5"
            :class="compacto ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''"
        >
            <ul class="flex flex-col divide-y divide-(--ax-borde)">
                <li
                    v-for="grupo in grupos"
                    :key="grupo.grupo"
                    class="flex flex-col gap-1.5 py-2"
                    :data-grupo="grupo.grupo"
                >
                    <div class="flex items-center gap-2 text-sm">
                        <UIcon
                            :name="ESTADOS_SALUD[grupo.estado].icono"
                            class="size-4 shrink-0"
                            :class="TEXTO_ESTADO[grupo.estado]"
                        />
                        <span class="flex-1 text-default">{{ grupo.nombre }}</span>
                        <span
                            class="text-xs font-semibold"
                            :class="TEXTO_ESTADO[grupo.estado]"
                        >{{ ESTADOS_SALUD[grupo.estado].etiqueta }}</span>
                    </div>
                    <p
                        v-if="compacto && grupo.resumen"
                        class="ps-6 text-xs text-muted"
                    >
                        {{ grupo.resumen }}
                    </p>
                    <ul
                        v-if="!compacto"
                        class="flex flex-col gap-1 ps-6"
                    >
                        <li
                            v-for="componente in grupo.componentes"
                            :key="componente.id"
                            class="flex flex-wrap items-baseline gap-x-2 text-xs"
                            :data-componente="componente.id"
                        >
                            <span class="font-medium text-highlighted">{{ componente.nombre }}</span>
                            <UBadge
                                :label="ESTADOS_SALUD[componente.estado].etiqueta"
                                :color="ESTADOS_SALUD[componente.estado].color"
                                :icon="ESTADOS_SALUD[componente.estado].icono"
                                variant="subtle"
                                size="sm"
                            />
                            <span class="text-muted">{{ componente.detalle }}<template v-if="componente.desde"> · desde {{ formatearFechaHora(componente.desde) }}</template></span>
                        </li>
                    </ul>
                </li>
            </ul>

            <div
                v-if="compacto && recursos.length"
                class="flex flex-col gap-3"
                data-prueba="salud-recursos"
            >
                <div
                    v-for="{ componente, porcentaje } in recursos"
                    :key="componente.id"
                    class="flex flex-col gap-1"
                >
                    <div class="flex items-center justify-between gap-2 text-sm">
                        <span class="text-default">{{ componente.nombre }}</span>
                        <ULink
                            v-if="componente.id === 'host.disco' && enlace('/sistema/almacenamiento')"
                            :to="enlace('/sistema/almacenamiento')"
                            class="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                        >
                            {{ porcentaje === null ? 'Sin datos' : `${porcentaje} % usado` }} · Almacenamiento
                        </ULink>
                        <span
                            v-else
                            class="text-xs font-semibold tabular-nums text-highlighted"
                        >{{ porcentaje === null ? 'Sin datos' : `${porcentaje} %` }}</span>
                    </div>
                    <UProgress
                        v-if="porcentaje !== null"
                        :model-value="porcentaje"
                        size="sm"
                        :color="colorBarra(componente.estado)"
                        :aria-label="`${componente.nombre}: ${porcentaje} %`"
                    />
                    <p class="text-xs text-muted">
                        {{ componente.detalle }}
                    </p>
                </div>
            </div>
        </div>
        <p
            v-if="salud"
            class="text-xs text-dimmed"
        >
            Medido {{ formatearFechaHora(salud.generado_en) }} · se actualiza solo cada 45 s mientras miras esta pantalla.
        </p>
    </section>
</template>
