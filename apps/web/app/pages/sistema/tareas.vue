<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

definePageMeta({ permiso: 'sistema.ver_crons' })

useHead({ title: 'Tareas programadas · ArgosIsp' })

/**
 * Tareas programadas (`GET /sistema/crons`, tablero `SistemaCrons.dc.html`): todas las tareas
 * automáticas del sistema con su horario, la última y la próxima corrida, si están atrasadas y qué
 * instancia las corre. Al elegir una se ve su historial (`GET /sistema/crons/:clave/corridas`) y
 * «Ejecutar ahora» (`sistema.ejecutar_cron` y los permisos propios de la tarea) con una confirmación
 * corta. En el teléfono la lista y el detalle son dos pantallas; «Ejecutar ahora» va fijo abajo.
 */
const { puede } = usePermisos()
const toast = useToast()
const api = useTareasProgramadas()

const datos = shallowRef<TareasProgramadas | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const busqueda = ref('')
const filtro = ref<FiltroTarea>('todas')
const modulo = ref('todos')
const clave = ref<string | null>(null)
const ahora = ref(Date.now())

async function cargar() {
    cargando.value = true
    const resultado = await api.listar()
    cargando.value = false
    ahora.value = Date.now()
    if (resultado.ok) {
        datos.value = resultado.data
        problema.value = null
        return
    }
    problema.value = resultado.problema
}

let reloj: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    cargar()
    // Solo refresca los «hace …» y «en …»; los datos se vuelven a pedir con «Actualizar».
    reloj = setInterval(() => (ahora.value = Date.now()), 15_000)
})
onBeforeUnmount(() => clearInterval(reloj))

const todas = computed(() => datos.value?.data ?? [])
const atencion = computed(() => todas.value.filter(t => ESTADOS_TAREA[t.estado].atencion))
const atrasadas = computed(() => todas.value.filter(t => t.estado === 'atrasada'))

const modulos = computed(() => {
    const vistos = new Map<string, string>()
    for (const tarea of todas.value) {
        vistos.set(tarea.modulo, tarea.modulo_nombre)
    }
    return [{ label: 'Módulo: Todos', value: 'todos' }, ...[...vistos].map(([value, nombre]) => ({ label: nombre, value }))]
})

const delModulo = computed(() => todas.value.filter(t => modulo.value === 'todos' || t.modulo === modulo.value))

const pestanas = computed(() => FILTROS_TAREA.map(f => ({
    label: f.etiqueta,
    value: f.id,
    badge: {
        label: String(delModulo.value.filter(t => tareaEnFiltro(t.estado, f.id)).length),
        color: (f.id === 'error' || f.id === 'atrasada') ? 'error' as const : 'neutral' as const,
        variant: 'subtle' as const,
    },
})))

const visibles = computed(() => {
    const texto = busqueda.value.trim().toLocaleLowerCase('es')
    return delModulo.value
        .filter(t => tareaEnFiltro(t.estado, filtro.value))
        .filter(t => !texto || `${t.nombre} ${t.descripcion} ${t.modulo_nombre} ${t.clave}`.toLocaleLowerCase('es').includes(texto))
})

const seleccionada = computed(() => todas.value.find(t => t.clave === clave.value) ?? null)

function puedeEjecutar(tarea: TareaProgramada): boolean {
    return tarea.manual && tarea.activo && tarea.permisos.every(p => puede(p))
}

const COLOR_PUNTO: Record<string, string> = {
    success: 'bg-success',
    error: 'bg-error',
    warning: 'bg-warning',
    primary: 'bg-primary',
    neutral: 'bg-(--ui-text-dimmed)',
}

const TONO: Record<string, string> = {
    success: 'tono-exito',
    error: 'tono-error',
    warning: 'tono-aviso',
    primary: 'tono-marca',
    neutral: 'tono-neutro',
}

/* Historial de la tarea elegida */
const corridas = ref<CorridaCron[]>([])
const siguiente = ref<string | null>(null)
const problemaHistorial = ref<Problem | null>(null)
const cargandoHistorial = ref(false)

async function cargarHistorial(mas = false) {
    if (!clave.value) {
        return
    }
    cargandoHistorial.value = true
    const resultado = await api.corridas(clave.value, mas ? siguiente.value ?? undefined : undefined)
    cargandoHistorial.value = false
    if (!resultado.ok) {
        problemaHistorial.value = resultado.problema
        return
    }
    problemaHistorial.value = null
    corridas.value = mas ? [...corridas.value, ...resultado.data.data] : resultado.data.data
    siguiente.value = resultado.data.nextCursor
}

watch(clave, () => {
    corridas.value = []
    siguiente.value = null
    problemaHistorial.value = null
    cargarHistorial()
})

/* Ejecutar ahora */
const confirmar = ref(false)

function ejecutarSeleccionada() {
    return api.ejecutar(clave.value!, nuevaClaveIdempotencia())
}

function encolada() {
    toast.add({
        title: 'Tarea en cola',
        description: 'Corre en cuanto su proceso la tome; su corrida aparece en el historial.',
        icon: 'i-lucide-check',
        color: 'success',
    })
    setTimeout(() => {
        cargar()
        cargarHistorial()
    }, 2000)
}

function textoCorrida(corrida: CorridaCron): string {
    return corrida.error ?? corrida.resumen ?? ESTADOS_CORRIDA[corrida.estado].etiqueta
}

function cuandoCorrida(corrida: CorridaCron): string {
    if (corrida.repeticiones > 1) {
        return `${formatearFechaHora(corrida.primera)} – ${formatearHora(corrida.inicio)}`
    }
    return formatearFechaHora(corrida.inicio)
}

function datoCorrida(corrida: CorridaCron): string {
    const partes: string[] = []
    if (corrida.repeticiones > 1) {
        partes.push(`×${corrida.repeticiones}`)
    }
    if (corrida.origen === 'manual') {
        partes.push('A mano')
    }
    if (corrida.estado === 'en_curso') {
        partes.push('en curso')
    }
    else if (corrida.duracion_ms !== null) {
        partes.push(duracionLegible(corrida.duracion_ms))
    }
    return partes.join(' · ')
}

function textoLock(tarea: TareaProgramada): string {
    if (!tarea.lock) {
        return 'Sin lock (una sola copia)'
    }
    if (!tarea.lock.tomado) {
        return 'Libre · nadie la corre'
    }
    return `Tomado por ${tarea.lock.instancia ?? tarea.lock.dueno ?? 'otra instancia'}`
}
</script>

<template>
    <ConfiguracionMarco
        id="tareas"
        sin-tarjeta
    >
        <template #acciones>
            <UButton
                label="Actualizar"
                :icon="ICONOS.actualizar"
                color="neutral"
                variant="outline"
                :loading="cargando"
                data-prueba="actualizar-tareas"
                @click="cargar"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!datos"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-96 w-full" />
        </div>
        <div
            v-else
            class="flex flex-col gap-3"
        >
            <p
                class="text-sm text-muted"
                data-prueba="resumen-tareas"
            >
                {{ todas.length }} tareas<template v-if="atencion.length">
                    · <strong class="text-error">{{ atencion.length }} {{ atencion.length === 1 ? 'necesita' : 'necesitan' }} atención</strong>
                </template> · actualizado {{ haceCuanto(datos.generado_en, ahora) }}
            </p>

            <UAlert
                v-for="aviso in datos.avisos"
                :key="aviso"
                color="warning"
                variant="subtle"
                icon="i-lucide-plug-zap"
                :description="aviso"
            />
            <UAlert
                v-for="tarea in atrasadas.slice(0, 3)"
                :key="`atrasada-${tarea.clave}`"
                color="warning"
                variant="subtle"
                icon="i-lucide-alarm-clock"
                data-prueba="aviso-atrasada"
            >
                <template #description>
                    <strong>{{ tarea.nombre }}</strong> no corre desde
                    {{ tarea.ultima_correcta ? formatearFechaHora(tarea.ultima_correcta) : 'que se instaló' }}.
                    Revisa que <code class="font-mono">{{ tarea.proceso }}</code> esté corriendo.
                </template>
            </UAlert>

            <div class="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
                <section
                    class="min-w-0 flex-col surface-card"
                    :class="seleccionada ? 'hidden lg:flex' : 'flex'"
                    aria-label="Lista de tareas programadas"
                >
                    <div class="flex flex-wrap items-center gap-2 p-3 sm:p-4">
                        <UInput
                            v-model="busqueda"
                            icon="i-lucide-search"
                            placeholder="Buscar tarea…"
                            aria-label="Buscar tarea"
                            class="w-full sm:w-64"
                        />
                        <div class="max-w-full overflow-x-auto">
                            <UTabs
                                v-model="filtro"
                                :items="pestanas"
                                :content="false"
                                size="sm"
                                :ui="{ list: 'w-max', trigger: 'flex-none' }"
                                aria-label="Filtrar por estado"
                            />
                        </div>
                        <USelect
                            v-model="modulo"
                            :items="modulos"
                            icon="i-lucide-filter"
                            aria-label="Filtrar por módulo"
                            class="w-full sm:ml-auto sm:w-48"
                        />
                    </div>
                    <div
                        class="hidden grid-cols-[minmax(0,2.3fr)_7rem_7.5rem_minmax(0,1.9fr)_6.5rem_1.5rem] gap-3 border-y border-default bg-elevated/60 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid"
                        aria-hidden="true"
                    >
                        <span>Tarea</span><span>Módulo</span><span>Horario</span><span>Última corrida</span><span>Próxima</span><span />
                    </div>
                    <UEmpty
                        v-if="!visibles.length"
                        icon="i-lucide-calendar-search"
                        title="Ninguna tarea con ese filtro"
                        class="py-10"
                    />
                    <ul
                        v-else
                        class="flex flex-col"
                        data-prueba="lista-tareas"
                    >
                        <li
                            v-for="tarea in visibles"
                            :key="tarea.clave"
                            class="border-b border-default last:border-b-0"
                        >
                            <ULink
                                as="button"
                                type="button"
                                class="grid w-full gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-(--ax-fila-hover) md:grid-cols-[minmax(0,2.3fr)_7rem_7.5rem_minmax(0,1.9fr)_6.5rem_1.5rem] md:items-center"
                                :class="tarea.clave === clave ? 'bg-primary/5 shadow-[inset_3px_0_0_var(--ui-primary)]' : ''"
                                :aria-current="tarea.clave === clave ? 'true' : undefined"
                                :data-prueba="`tarea-${tarea.clave}`"
                                @click="clave = tarea.clave"
                            >
                                <span class="flex min-w-0 items-start gap-2">
                                    <span class="flex min-w-0 flex-1 flex-col">
                                        <span class="truncate text-sm font-semibold text-highlighted">{{ tarea.nombre }}</span>
                                        <span class="truncate text-xs text-muted md:block">
                                            <span class="md:hidden">{{ tarea.modulo_nombre }} · {{ tarea.horario?.texto ?? 'Apagada' }}</span>
                                            <span class="hidden md:inline">{{ tarea.descripcion }}</span>
                                        </span>
                                    </span>
                                    <span class="flex pt-1 md:hidden">
                                        <span
                                            class="inline-block rounded-full"
                                            :class="[COLOR_PUNTO[ESTADOS_TAREA[tarea.estado].color], ESTADOS_TAREA[tarea.estado].atencion ? 'size-3.5 ring-4 ring-(--ui-bg-accented)' : 'size-2']"
                                            aria-hidden="true"
                                        />
                                    </span>
                                </span>
                                <span class="hidden text-xs text-muted md:block">{{ tarea.modulo_nombre }}</span>
                                <span class="hidden text-xs text-muted md:block">{{ tarea.horario?.texto ?? 'Apagada' }}</span>
                                <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:flex-col md:items-start">
                                    <UBadge
                                        :label="ESTADOS_TAREA[tarea.estado].etiqueta"
                                        :color="ESTADOS_TAREA[tarea.estado].color"
                                        :icon="ESTADOS_TAREA[tarea.estado].icono"
                                        variant="subtle"
                                        size="sm"
                                    />
                                    <span class="truncate text-xs text-muted md:max-w-full">{{ ultimaLegible(tarea, ahora) }}</span>
                                </span>
                                <span class="hidden text-xs tabular-nums text-muted md:block">{{ proximaLegible(tarea.proxima, ahora) }}</span>
                                <span class="hidden justify-center md:flex">
                                    <span
                                        class="inline-block rounded-full"
                                        :class="[COLOR_PUNTO[ESTADOS_TAREA[tarea.estado].color], ESTADOS_TAREA[tarea.estado].atencion ? 'size-3.5 ring-4 ring-(--ui-bg-accented)' : 'size-2']"
                                        :data-prueba="ESTADOS_TAREA[tarea.estado].atencion ? 'punto-atencion' : 'punto'"
                                        :title="ESTADOS_TAREA[tarea.estado].etiqueta"
                                    />
                                </span>
                            </ULink>
                        </li>
                    </ul>
                </section>

                <aside
                    class="min-w-0 flex-col surface-card pb-24 lg:pb-0"
                    :class="seleccionada ? 'flex' : 'hidden lg:flex'"
                    aria-label="Detalle de la tarea"
                    data-prueba="detalle-tarea"
                >
                    <UEmpty
                        v-if="!seleccionada"
                        icon="i-lucide-mouse-pointer-click"
                        title="Elige una tarea"
                        description="Verás su horario, quién la corre y su historial de corridas."
                        class="py-12"
                    />
                    <template v-else>
                        <div class="flex items-start gap-3 p-4">
                            <UButton
                                :icon="ICONOS.volver"
                                color="neutral"
                                variant="ghost"
                                aria-label="Volver a la lista"
                                class="lg:hidden"
                                @click="clave = null"
                            />
                            <span
                                class="pastilla-icono pastilla-tono hidden sm:flex"
                                :class="TONO[ESTADOS_TAREA[seleccionada.estado].color]"
                            >
                                <UIcon
                                    :name="ESTADOS_TAREA[seleccionada.estado].icono"
                                    class="size-5"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col">
                                <h2 class="text-base font-semibold text-highlighted">
                                    {{ seleccionada.nombre }}
                                </h2>
                                <p class="text-xs text-muted">
                                    {{ seleccionada.descripcion }}
                                </p>
                            </div>
                            <UButton
                                icon="i-lucide-x"
                                color="neutral"
                                variant="ghost"
                                aria-label="Cerrar detalle"
                                class="hidden lg:inline-flex"
                                @click="clave = null"
                            />
                        </div>
                        <dl class="flex flex-col px-4 text-sm">
                            <div class="flex items-center justify-between gap-3 border-t border-default py-2">
                                <dt class="text-muted">
                                    Estado
                                </dt>
                                <dd>
                                    <UBadge
                                        :label="ESTADOS_TAREA[seleccionada.estado].etiqueta"
                                        :color="ESTADOS_TAREA[seleccionada.estado].color"
                                        :icon="ESTADOS_TAREA[seleccionada.estado].icono"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3 border-t border-default py-2">
                                <dt class="text-muted">
                                    Horario
                                </dt>
                                <dd class="text-right">
                                    {{ seleccionada.horario?.texto ?? 'Apagada' }} · {{ seleccionada.modulo_nombre }}
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3 border-t border-default py-2">
                                <dt class="text-muted">
                                    Próxima
                                </dt>
                                <dd class="text-right tabular-nums">
                                    {{ seleccionada.proxima ? `${proximaLegible(seleccionada.proxima, ahora)} (${formatearFechaHora(seleccionada.proxima)})` : '—' }}
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3 border-t border-default py-2">
                                <dt class="text-muted">
                                    Corre en
                                </dt>
                                <dd class="font-mono text-xs">
                                    {{ seleccionada.proceso }}
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3 border-t border-default py-2">
                                <dt class="text-muted">
                                    Lock
                                </dt>
                                <dd
                                    class="flex items-center gap-1.5 text-right text-muted"
                                    data-prueba="lock-tarea"
                                >
                                    <UIcon
                                        name="i-lucide-lock"
                                        class="size-3.5 shrink-0"
                                    />
                                    {{ textoLock(seleccionada) }}
                                </dd>
                            </div>
                        </dl>
                        <p
                            v-if="seleccionada.nota"
                            class="mx-4 mt-2 rounded-lg bg-elevated px-3 py-2 text-xs text-muted"
                        >
                            {{ seleccionada.nota }}
                        </p>
                        <PanelBarraAccion
                            v-if="seleccionada.manual"
                            class="lg:px-4 lg:py-3"
                        >
                            <UButton
                                label="Ejecutar ahora"
                                icon="i-lucide-play"
                                :disabled="!puedeEjecutar(seleccionada) || seleccionada.estado === 'en_curso'"
                                class="w-full justify-center lg:w-auto"
                                data-prueba="ejecutar-tarea"
                                @click="confirmar = true"
                            />
                            <span class="hidden text-xs text-muted lg:inline">
                                {{ puedeEjecutar(seleccionada) ? 'Respeta el lock: si ya corre, no se repite.' : 'No tienes permiso para ejecutarla.' }}
                            </span>
                        </PanelBarraAccion>
                        <p
                            v-else
                            class="px-4 py-3 text-xs text-muted"
                        >
                            Corre todo el tiempo en su proceso; no se ejecuta a mano.
                        </p>

                        <h3 class="px-4 pt-2 text-xs font-semibold tracking-wide text-muted uppercase">
                            Historial de corridas
                        </h3>
                        <div
                            class="flex flex-col px-4 pb-4"
                            data-prueba="historial-corridas"
                        >
                            <ProblemaAlerta
                                v-if="problemaHistorial"
                                :problema="problemaHistorial"
                                :reintentar="() => cargarHistorial()"
                                :reintentando="cargandoHistorial"
                                class="mt-2"
                            />
                            <template v-else>
                                <USkeleton
                                    v-if="cargandoHistorial && !corridas.length"
                                    class="mt-2 h-24 w-full"
                                />
                                <p
                                    v-else-if="!corridas.length"
                                    class="py-3 text-sm text-muted"
                                >
                                    {{ seleccionada.ultima?.fuente === 'auditoria' ? 'El historial empieza con esta versión; la última corrida conocida sale de la bitácora.' : 'Todavía no hay corridas registradas.' }}
                                </p>
                                <ul
                                    v-else
                                    class="flex flex-col"
                                >
                                    <li
                                        v-for="corrida in corridas"
                                        :key="corrida.id ?? corrida.inicio"
                                        class="flex gap-3 border-t border-default py-2.5 first:border-t-0"
                                        :data-prueba="`corrida-${corrida.estado}`"
                                    >
                                        <span
                                            class="pastilla-icono pastilla-tono size-8"
                                            :class="TONO[ESTADOS_CORRIDA[corrida.estado].color]"
                                        >
                                            <UIcon
                                                :name="ESTADOS_CORRIDA[corrida.estado].icono"
                                                class="size-4"
                                                :aria-label="ESTADOS_CORRIDA[corrida.estado].etiqueta"
                                            />
                                        </span>
                                        <div class="flex min-w-0 flex-1 flex-col">
                                            <div class="flex items-baseline gap-2">
                                                <strong class="text-sm text-highlighted">{{ cuandoCorrida(corrida) }}</strong>
                                                <span class="ml-auto shrink-0 text-xs text-muted">{{ datoCorrida(corrida) }}</span>
                                            </div>
                                            <span
                                                class="text-xs"
                                                :class="corrida.error ? 'text-error' : 'text-default'"
                                            >{{ textoCorrida(corrida) }}</span>
                                            <span
                                                v-if="corrida.instancia"
                                                class="text-[11px] text-muted"
                                            >{{ corrida.instancia }}</span>
                                        </div>
                                    </li>
                                </ul>
                                <UButton
                                    v-if="siguiente"
                                    label="Cargar más"
                                    variant="link"
                                    :loading="cargandoHistorial"
                                    class="self-start px-0"
                                    @click="cargarHistorial(true)"
                                />
                            </template>
                        </div>
                    </template>
                </aside>
            </div>
        </div>

        <ConfirmacionModal
            v-if="seleccionada"
            v-model:open="confirmar"
            :titulo="`¿Ejecutar «${seleccionada.nombre}» ahora?`"
            :efecto="`Se pone en la cola de ${seleccionada.proceso} y corre con su lock. Si otra instancia ya la está corriendo, verás «Ya se está ejecutando».`"
            confirmar="Ejecutar ahora"
            icono="i-lucide-play"
            color="primary"
            :ejecutar="ejecutarSeleccionada"
            @hecho="encolada"
        />
    </ConfiguracionMarco>
</template>
