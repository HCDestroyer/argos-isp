<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de una promoción de velocidad (tablero PendPromociones, columna derecha, y
 * PendPromocionesMovil, pantalla `det`): nombre con su estado y la frase de «ahora», velocidad,
 * cuándo, periodo, precio y cómo se aplica; sus servicios (`GET /promociones-velocidad/:id/servicios`,
 * vigentes y quitados) con el estado de cada uno, buscador y «Cargar más»; quitar uno, asignar
 * servicios y cancelar la promoción en ventanas cortas.
 *
 * La API da de cada asignación solo `servicio_id`: el código, el cliente, el plan y el router se
 * leen de `GET /servicios/:id` (pedido en `.claude/integration/a4.md` que vengan en la asignación).
 * «Sin sesión ahora» y la velocidad «antes → después» del tablero no van: la API no los da.
 */
const props = withDefaults(defineProps<{
    promocion: PromocionVelocidad
    /** Botones de abajo (Cancelar promoción y Asignar servicios). En el teléfono van en la barra fija. */
    conPie?: boolean
}>(), {
    conPie: true,
})

const emit = defineEmits<{
    cambiada: [promocion: PromocionVelocidad]
}>()

const toast = useToast()
const { puede, enlace } = usePermisos()

const estado = computed(() => estadoPromocion(props.promocion))
const abierta = computed(() => promocionAbierta(props.promocion))
const puedeAsignar = computed(() => abierta.value && puede('promociones_velocidad.asignar'))
const puedeCancelar = computed(() => abierta.value && puede('promociones_velocidad.cancelar'))
const puedeQuitar = computed(() => abierta.value && puede('promociones_velocidad.quitar'))

/* Servicios de la promoción, por páginas de 50. */
const asignaciones = shallowRef<PromocionServicio[]>([])
const siguiente = ref<string | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const servicios = shallowReactive(new Map<number, Servicio | null>())

async function leerServicios(ids: number[]) {
    // Sin `servicios.ver` la fila dice «Servicio N»: no se piden datos que no se pueden leer.
    if (!puede('servicios.ver')) {
        return
    }
    const faltan = ids.filter(id => !servicios.has(id))
    await Promise.all(faltan.map(async (id) => {
        const resultado = await useServicios().ver(id)
        servicios.set(id, resultado.ok ? resultado.data : null)
    }))
}

async function cargar(mas = false) {
    cargando.value = true
    if (!mas) {
        problema.value = null
    }
    const resultado = await usePromocionesVelocidad().servicios(props.promocion.id, mas ? siguiente.value ?? undefined : undefined)
    if (!resultado.ok) {
        cargando.value = false
        problema.value = resultado.problema
        if (!mas) {
            asignaciones.value = []
        }
        return
    }
    asignaciones.value = mas ? [...asignaciones.value, ...resultado.data.data] : resultado.data.data
    siguiente.value = resultado.data.nextCursor
    await leerServicios(resultado.data.data.map(a => a.servicio_id))
    cargando.value = false
}

watch(() => props.promocion.id, () => {
    busqueda.value = ''
    void cargar()
})
onMounted(() => void cargar())

const busqueda = ref('')
const filas = computed(() => {
    const texto = normalizarBusqueda(busqueda.value)
    if (!texto) {
        return asignaciones.value
    }
    return asignaciones.value.filter((a) => {
        const s = servicios.get(a.servicio_id)
        return normalizarBusqueda(`${s?.codigo ?? a.servicio_id} ${s?.cliente_nombre ?? ''} ${s?.router_nombre ?? ''}`).includes(texto)
    })
})
const vigentes = computed(() => asignaciones.value.filter(a => a.estado === 'vigente').map(a => a.servicio_id))

function etiquetaDe(a: PromocionServicio): string {
    return servicios.get(a.servicio_id)?.codigo ?? `Servicio ${a.servicio_id}`
}

/* Ventanas. */
const asignarAbierto = ref(false)
const cancelarAbierto = ref(false)
const quitarAbierto = ref(false)
const aQuitar = shallowRef<PromocionServicio | null>(null)

function abrirQuitar(a: PromocionServicio) {
    aQuitar.value = a
    quitarAbierto.value = true
}

function alAsignar(promocion: PromocionVelocidad, cuantos: number) {
    toast.add({ title: cuantos === 1 ? 'Servicio asignado' : `${cuantos} servicios asignados`, description: `«${promocion.nombre}»: si el horario ya empezó, la velocidad ya subió.`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('cambiada', promocion)
    void cargar()
}

function alQuitar(promocion: PromocionVelocidad) {
    toast.add({ title: 'Promoción quitada', description: `${aQuitar.value ? etiquetaDe(aQuitar.value) : 'El servicio'} vuelve a la velocidad de su plan.`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('cambiada', promocion)
    void cargar()
}

function alCancelar(promocion: PromocionVelocidad) {
    toast.add({ title: `«${promocion.nombre}» cancelada`, description: 'Sus servicios vuelven a la velocidad de su plan.', icon: 'i-lucide-circle-check', color: 'success' })
    emit('cambiada', promocion)
    void cargar()
}

function cancelar(motivo: string, clave: string) {
    return usePromocionesVelocidad().cancelar(props.promocion.id, props.promocion.version, motivo, clave)
}

function abrirAsignar() {
    asignarAbierto.value = true
}

function abrirCancelar() {
    cancelarAbierto.value = true
}

defineExpose({ abrirAsignar, abrirCancelar, puedeAsignar, puedeCancelar })
</script>

<template>
    <div
        class="flex min-w-0 flex-col"
        data-prueba="detalle-promocion"
    >
        <header class="flex items-start gap-3 border-b border-(--ax-borde) px-4 py-3.5 sm:px-5">
            <div class="flex min-w-0 flex-1 flex-col">
                <h2 class="truncate text-lg font-bold tracking-[-0.02em] text-highlighted">
                    {{ promocion.nombre }}
                </h2>
                <p class="text-xs text-muted">
                    {{ estado.ahora }}
                </p>
            </div>
            <UBadge
                :label="estado.etiqueta"
                :icon="estado.icono"
                :color="estado.color"
                variant="subtle"
                class="shrink-0 rounded-full"
                data-prueba="estado-promocion"
            />
        </header>

        <dl class="px-4 py-1 sm:px-5">
            <RedFila etiqueta="Velocidad">
                <strong>{{ velocidadCortaPromocion(promocion) }}</strong> <span class="font-normal text-muted">· {{ velocidadLargaPromocion(promocion) }}</span>
            </RedFila>
            <RedFila etiqueta="Cuándo">
                <strong>{{ cuandoPromocion(promocion) }}</strong> <span class="font-normal text-muted">· {{ horarioPromocion(promocion) }}</span>
            </RedFila>
            <RedFila
                etiqueta="Periodo"
                :valor="periodoPromocion(promocion)"
            />
            <RedFila etiqueta="Precio">
                <strong data-prueba="precio-promocion">{{ precioPromocion(promocion) }}</strong> <span class="font-normal text-muted">· {{ precioAyudaPromocion(promocion) }}</span>
            </RedFila>
            <div class="flex items-start justify-between gap-3 border-t border-(--ax-borde) py-2 text-sm">
                <dt class="shrink-0 text-muted">
                    Cómo se aplica
                </dt>
                <dd class="text-end text-xs text-default">
                    Sin cortar la sesión. En routers con velocidad por plan (PCQ o árbol) el servicio pasa al plan destino mientras dura y regresa solo.
                </dd>
            </div>
            <div
                v-if="promocion.descripcion"
                class="flex items-start justify-between gap-3 border-t border-(--ax-borde) py-2 text-sm"
            >
                <dt class="shrink-0 text-muted">
                    Para qué
                </dt>
                <dd class="text-end text-default">
                    {{ promocion.descripcion }}
                </dd>
            </div>
        </dl>

        <section
            class="flex min-w-0 flex-col border-t border-(--ax-borde)"
            aria-label="Servicios con la promoción"
        >
            <div class="flex flex-wrap items-center gap-2 bg-(--ax-panel)/50 px-4 py-2.5 sm:px-5">
                <h3 class="text-sm font-semibold text-highlighted">
                    Servicios ({{ promocion.servicios }})
                </h3>
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    size="sm"
                    placeholder="Código o cliente…"
                    aria-label="Buscar servicio de la promoción"
                    class="ms-auto w-44"
                    :ui="{ base: 'rounded-full' }"
                />
            </div>

            <div
                v-if="problema"
                class="p-4"
            >
                <ProblemaAlerta
                    :problema="problema"
                    :reintentar="() => cargar()"
                    :reintentando="cargando"
                />
            </div>
            <USkeleton
                v-else-if="cargando && !asignaciones.length"
                class="m-4 h-24"
            />
            <p
                v-else-if="!filas.length"
                class="px-4 py-4 text-sm text-muted sm:px-5"
            >
                {{ busqueda ? 'Ningún servicio coincide.' : 'Todavía no tiene servicios. Asígnalos con «Asignar servicios».' }}
            </p>
            <ul
                v-else
                class="flex flex-col divide-y divide-(--ax-borde)"
                data-prueba="servicios-promocion"
            >
                <li
                    v-for="a in filas"
                    :key="a.id"
                    class="flex items-center gap-3 px-4 py-2.5 sm:px-5"
                    :class="a.estado === 'quitada' ? 'opacity-70' : ''"
                    :data-servicio="a.servicio_id"
                >
                    <div class="flex min-w-0 flex-1 flex-col">
                        <span class="flex min-w-0 items-center gap-2 text-sm">
                            <ULink
                                :to="enlace(`/servicios/${a.servicio_id}?pestana=promociones`)"
                                class="shrink-0 rounded-md bg-(--ax-panel) px-1.5 py-0.5 font-mono text-xs text-default hover:text-primary"
                            >{{ etiquetaDe(a) }}</ULink>
                            <span class="truncate font-semibold text-highlighted">{{ servicios.get(a.servicio_id)?.cliente_nombre ?? '' }}</span>
                        </span>
                        <span
                            v-if="servicios.get(a.servicio_id)"
                            class="truncate text-xs text-muted"
                        >{{ servicios.get(a.servicio_id)?.plan_nombre }} · {{ servicios.get(a.servicio_id)?.router_nombre }}</span>
                        <!-- Teléfono: el estado debajo, para que el nombre no se corte. -->
                        <UBadge
                            :label="estadoAsignacion(a, promocion).etiqueta"
                            :icon="estadoAsignacion(a, promocion).icono"
                            :color="estadoAsignacion(a, promocion).color"
                            variant="subtle"
                            size="sm"
                            class="mt-1 w-fit max-w-full truncate rounded-full sm:hidden"
                        />
                    </div>
                    <UBadge
                        :label="estadoAsignacion(a, promocion).etiqueta"
                        :icon="estadoAsignacion(a, promocion).icono"
                        :color="estadoAsignacion(a, promocion).color"
                        variant="subtle"
                        size="sm"
                        class="hidden max-w-[50%] shrink-0 truncate rounded-full sm:inline-flex"
                    />
                    <UButton
                        v-if="puedeQuitar && a.estado === 'vigente'"
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="shrink-0 rounded-full"
                        :aria-label="`Quitar la promoción de ${etiquetaDe(a)}`"
                        @click="abrirQuitar(a)"
                    />
                </li>
            </ul>
            <div
                v-if="asignaciones.length"
                class="flex items-center gap-1 px-4 py-2 text-xs text-muted sm:px-5"
            >
                <span>{{ asignaciones.length }} de {{ siguiente ? `más de ${asignaciones.length}` : asignaciones.length }}</span>
                <template v-if="siguiente">
                    <span>·</span>
                    <UButton
                        label="Cargar más"
                        variant="link"
                        size="xs"
                        class="px-0"
                        :loading="cargando"
                        @click="cargar(true)"
                    />
                </template>
            </div>
        </section>

        <footer
            v-if="conPie && (puedeAsignar || puedeCancelar)"
            class="mt-auto flex flex-wrap items-center gap-2 border-t border-(--ax-borde) px-4 py-3 sm:px-5"
        >
            <UButton
                v-if="puedeCancelar"
                label="Cancelar promoción"
                icon="i-lucide-circle-x"
                color="error"
                variant="outline"
                class="rounded-full"
                data-prueba="cancelar-promocion"
                @click="cancelarAbierto = true"
            />
            <UButton
                v-if="puedeAsignar"
                label="Asignar servicios"
                icon="i-lucide-plus"
                class="glow-brand ms-auto rounded-full"
                data-prueba="asignar-servicios"
                @click="asignarAbierto = true"
            />
        </footer>

        <PromocionAsignarModal
            v-if="puedeAsignar"
            v-model:open="asignarAbierto"
            :promocion="promocion"
            :ya-asignados="vigentes"
            @hecho="alAsignar"
        />
        <AccionMotivoModal
            v-if="puedeCancelar"
            v-model:open="cancelarAbierto"
            :titulo="`Cancelar «${promocion.nombre}»`"
            :efecto="`Los ${promocion.servicios} servicios vuelven a la velocidad de su plan ahora mismo, sin cortar la sesión. No se puede deshacer: para volver a darla se crea otra promoción.${promocion.precio !== null ? ' Los días que ya tuvo se cobran en la próxima factura; los que faltan, no.' : ''}`"
            confirmar="Cancelar promoción"
            icono="i-lucide-circle-x"
            placeholder="Ej.: el router no aguanta la carga"
            :ejecutar="cancelar"
            @hecho="alCancelar"
        />
        <PromocionQuitarModal
            v-if="aQuitar && puedeQuitar"
            v-model:open="quitarAbierto"
            :promocion-id="promocion.id"
            :promocion-nombre="promocion.nombre"
            :servicio-id="aQuitar.servicio_id"
            :servicio-etiqueta="etiquetaDe(aQuitar)"
            :plan-nombre="servicios.get(aQuitar.servicio_id)?.plan_nombre ?? null"
            @hecho="alQuitar"
        />
    </div>
</template>
