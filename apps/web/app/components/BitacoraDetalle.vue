<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de una entrada de la bitácora (tablero OperBitacora), a la derecha de la lista y en un
 * panel a pantalla completa en el teléfono: qué hizo en español con el nombre técnico debajo
 * (decisión 25), quién, desde dónde y cuándo; qué cambió campo por campo (`GET /bitacora/cambios`
 * de la misma petición; lo sensible ya viene como `***`), los detalles, la entrada tal cual la
 * guardó la API y lo demás que pasó en la misma petición.
 */
const props = withDefaults(defineProps<{
    accion: AccionAuditoria
    /** En el panel del teléfono el título ya lo pone el panel. */
    sinEncabezado?: boolean
}>(), {
    sinEncabezado: false,
})

const emit = defineEmits<{
    /** Filtrar la bitácora por el `request_id` de esta entrada. */
    peticion: [requestId: string]
    /** Ver el historial de cambios de la entidad de esta entrada. */
    cambios: [tipo: string, id: number]
    /** Todo lo de este actor. */
    actor: [actorId: number]
}>()

const ruta = computed(() => rutaEntidad(props.accion.entidad_tipo, props.accion.entidad_id))

const cambios = shallowRef<CambioAuditoria[]>([])
const hermanas = shallowRef<AccionAuditoria[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

/** Lo que cambió y lo demás de la misma petición (`request_id`). */
async function cargar() {
    cambios.value = []
    hermanas.value = []
    problema.value = null
    const requestId = props.accion.request_id
    if (!requestId) {
        return
    }
    cargando.value = true
    const [deCambios, deAcciones] = await Promise.all([
        useBitacora().cambios({ request_id: requestId }),
        useBitacora().acciones({ request_id: requestId }),
    ])
    cargando.value = false
    if (!deCambios.ok || !deAcciones.ok) {
        problema.value = !deCambios.ok ? deCambios.problema : !deAcciones.ok ? deAcciones.problema : null
        return
    }
    cambios.value = deCambios.data.data
    hermanas.value = deAcciones.data.data.filter(a => a.id !== props.accion.id)
}

const resultadoOk = computed(() => props.accion.resultado === 'ok')

watch(() => props.accion.id, cargar)
onMounted(cargar)
</script>

<template>
    <OperPanelLateral
        :titulo="sinEncabezado ? undefined : tituloAccion(accion)"
        :subtitulo="`${etiquetaActor(accion)} · ${formatearFechaHora(accion.created_at)} · desde ${etiquetaCanal(accion.canal).toLowerCase()}`"
        icono="i-lucide-scroll-text"
        :tono="resultadoOk ? 'tono-marca' : 'tono-error'"
        data-prueba="detalle-bitacora"
    >
        <template #insignia>
            <UBadge
                :label="resultadoOk ? 'Correcto' : 'Error'"
                :icon="resultadoOk ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
                :color="resultadoOk ? 'success' : 'error'"
                variant="subtle"
            />
        </template>

        <UAlert
            v-if="accion.error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Por qué no se hizo"
            :description="accion.error"
        />

        <!-- Qué cambió: el diff de la misma petición. -->
        <section
            class="flex flex-col gap-2"
            aria-labelledby="titulo-que-cambio"
        >
            <h3
                id="titulo-que-cambio"
                class="text-xs font-semibold tracking-[0.06em] text-muted uppercase"
            >
                Qué cambió<template v-if="cambios.length">
                    · {{ cambios.length }} {{ cambios.length === 1 ? 'campo' : 'campos' }}
                </template>
            </h3>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando"
                class="h-16 w-full"
            />
            <p
                v-else-if="!cambios.length"
                class="text-sm text-muted"
            >
                Esta acción no cambió campos guardados (o no los registra).
            </p>
            <ul
                v-else
                class="flex flex-col divide-y divide-(--ax-borde)"
                data-prueba="diff-bitacora"
            >
                <li
                    v-for="cambio in cambios"
                    :key="cambio.id"
                    class="flex flex-col gap-1 py-2"
                >
                    <span class="text-[0.8125rem] text-muted">{{ nombreCampoCambio(cambio.campo) }}</span>
                    <div class="flex flex-wrap items-center gap-1.5 text-sm">
                        <span
                            class="rounded-md px-1.5 py-0.5 font-mono text-xs break-all"
                            :class="cambio.antes === null ? 'text-dimmed' : 'bg-error/10 text-error line-through'"
                        >{{ valorCambio(cambio.antes) }}</span>
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="size-4 text-muted"
                        />
                        <span
                            class="rounded-md px-1.5 py-0.5 font-mono text-xs break-all"
                            :class="cambio.despues === null ? 'text-dimmed' : 'bg-success/10 text-success'"
                            :data-campo="nombreCampoCambio(cambio.campo)"
                        >{{ valorCambio(cambio.despues) }}</span>
                    </div>
                </li>
            </ul>
            <p class="flex items-center gap-1.5 text-xs text-muted">
                <UIcon
                    name="i-lucide-lock"
                    class="size-3.5"
                />
                Lo sensible (contraseñas, tokens) siempre se guarda como ***.
            </p>
        </section>

        <!-- Detalles. -->
        <section class="flex flex-col gap-1">
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Detalles
            </h3>
            <dl class="flex flex-col divide-y divide-(--ax-borde) text-sm">
                <div class="flex justify-between gap-3 py-2">
                    <dt class="text-muted">
                        Acción
                    </dt>
                    <dd class="font-mono text-highlighted">
                        {{ accion.accion }}
                    </dd>
                </div>
                <div class="flex justify-between gap-3 py-2">
                    <dt class="text-muted">
                        Sobre
                    </dt>
                    <dd class="text-end">
                        <ULink
                            v-if="ruta"
                            :to="ruta"
                            class="text-primary underline"
                        >
                            {{ etiquetaEntidad(accion) }}
                        </ULink>
                        <template v-else>
                            {{ etiquetaEntidad(accion) ?? '—' }}
                        </template>
                    </dd>
                </div>
                <div class="flex items-center justify-between gap-3 py-2">
                    <dt class="text-muted">
                        Petición
                    </dt>
                    <dd>
                        <span
                            class="rounded-md bg-(--ax-panel) px-1.5 py-0.5 font-mono text-xs"
                            data-copiar
                        >{{ accion.request_id }}</span>
                    </dd>
                </div>
                <div class="flex justify-between gap-3 py-2">
                    <dt class="text-muted">
                        Empresa
                    </dt>
                    <dd
                        class="text-end text-highlighted"
                        data-prueba="empresa-accion"
                    >
                        {{ accion.empresa_nombre ?? 'Del grupo (sin empresa)' }}
                    </dd>
                </div>
                <div
                    v-if="accion.iris_actor"
                    class="flex justify-between gap-3 py-2"
                >
                    <dt class="text-muted">
                        Quién en Iris
                    </dt>
                    <dd
                        class="text-end text-highlighted"
                        data-prueba="detalle-iris-actor"
                    >
                        {{ textoActorIris(accion.iris_actor) }}
                    </dd>
                </div>
                <div
                    v-if="accion.iris_conversacion"
                    class="flex justify-between gap-3 py-2"
                >
                    <dt class="text-muted">
                        Conversación de Iris
                    </dt>
                    <dd
                        class="font-mono text-xs text-highlighted"
                        data-prueba="detalle-iris-conversacion"
                    >
                        {{ accion.iris_conversacion }}
                    </dd>
                </div>
            </dl>
        </section>

        <UCollapsible :ui="{ content: 'pt-2' }">
            <UButton
                label="Entrada tal como llegó"
                icon="i-lucide-braces"
                trailing-icon="i-lucide-chevron-down"
                color="neutral"
                variant="ghost"
                size="sm"
                class="self-start px-0"
            />
            <template #content>
                <pre
                    class="max-h-80 overflow-auto rounded-xl bg-(--ax-panel) p-3 font-mono text-xs break-all whitespace-pre-wrap text-default"
                    data-prueba="entrada"
                >{{ jsonLegible(accion.entrada) }}</pre>
            </template>
        </UCollapsible>

        <!-- En la misma petición. -->
        <section
            v-if="hermanas.length"
            class="flex flex-col gap-1"
        >
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                En la misma petición
            </h3>
            <ul class="flex flex-col gap-2">
                <li
                    v-for="hermana in hermanas"
                    :key="hermana.id"
                    class="flex items-center gap-3"
                >
                    <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                        <UIcon
                            name="i-lucide-send"
                            class="size-4"
                        />
                    </span>
                    <div class="flex min-w-0 flex-col">
                        <span class="truncate text-sm font-semibold text-highlighted">{{ tituloAccion(hermana) }}</span>
                        <span class="truncate font-mono text-xs text-muted">{{ hermana.accion }} · {{ formatearHora(hermana.created_at) }}</span>
                    </div>
                </li>
            </ul>
            <UButton
                label="Ver solo esta petición"
                icon="i-lucide-link"
                color="neutral"
                variant="link"
                size="sm"
                class="self-start px-0"
                @click="emit('peticion', accion.request_id)"
            />
        </section>

        <template #pie>
            <UButton
                v-if="accion.entidad_tipo && accion.entidad_id"
                label="Historial de la entidad"
                icon="i-lucide-history"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center"
                @click="emit('cambios', accion.entidad_tipo, accion.entidad_id)"
            />
            <UButton
                v-if="accion.actor_id"
                :label="`Todo lo de ${etiquetaActor(accion)}`"
                icon="i-lucide-user"
                color="neutral"
                variant="outline"
                class="min-w-0 flex-1 justify-center"
                :ui="{ label: 'truncate' }"
                @click="emit('actor', accion.actor_id)"
            />
        </template>
    </OperPanelLateral>
</template>
