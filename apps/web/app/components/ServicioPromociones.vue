<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Pestaña «Promociones» de la ficha del servicio (tablero OperServicioFicha, `t: prom`): la
 * vigente con su tramo («Aplicada ahora … hasta HH:MM») y «Quitar»; las anteriores (terminadas,
 * quitadas o canceladas); «Agregar a una promoción» en una ventana corta y «Nueva promoción» en su
 * página con este servicio elegido. `GET /servicios/:id/promociones-velocidad` (`servicios.ver`);
 * el detalle de cada promoción (velocidad, horario, periodo, precio) se lee con
 * `GET /promociones-velocidad/:id` si hay `promociones_velocidad.ver`.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const emit = defineEmits<{
    cambiada: []
}>()

const toast = useToast()
const { puede } = usePermisos()

const asignaciones = shallowRef<PromocionServicio[]>([])
const promociones = shallowReactive(new Map<number, PromocionVelocidad | null>())
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await leerTodas(cursor => usePromocionesVelocidad().delServicio(props.servicio.id, cursor))
    if (!resultado.ok) {
        cargando.value = false
        problema.value = resultado.problema
        asignaciones.value = []
        return
    }
    asignaciones.value = resultado.data.filas
    if (puede('promociones_velocidad.ver')) {
        const ids = [...new Set(resultado.data.filas.map(a => a.promocion_id))]
        await Promise.all(ids.map(async (id) => {
            const p = await usePromocionesVelocidad().ver(id)
            promociones.set(id, p.ok ? p.data : null)
        }))
    }
    cargando.value = false
}

watch(() => props.servicio.id, () => void cargar())
onMounted(() => void cargar())

/** La que tiene ahora: vigente en el servicio y con la promoción sin terminar ni cancelar. */
const actuales = computed(() => asignaciones.value.filter((a) => {
    const p = promociones.get(a.promocion_id)
    return a.estado === 'vigente' && (!p || promocionAbierta(p))
}))
const anteriores = computed(() => asignaciones.value.filter(a => !actuales.value.includes(a)))

function resumen(a: PromocionServicio): string {
    const p = promociones.get(a.promocion_id)
    if (!p) {
        return ''
    }
    const precio = p.precio === null ? 'gratis' : precioPromocion(p)
    return [velocidadCortaPromocion(p) + (p.tipo_velocidad === 'multiplicador' ? ' su plan' : ''), horarioPromocion(p), periodoPromocion(p), precio].join(' · ')
}

function estadoActual(a: PromocionServicio) {
    const p = promociones.get(a.promocion_id) ?? null
    const base = estadoAsignacion(a, p)
    if (a.tramo_abierto) {
        return { ...base, etiqueta: `Aplicada ahora · hasta ${formatearHora(a.tramo_abierto.fin)}` }
    }
    if (p?.vigencia === 'vigente' && p.proximo_tramo) {
        return { ...base, etiqueta: `Fuera de su horario · vuelve ${cuandoVuelve(p.proximo_tramo.inicio)}` }
    }
    return base
}

function estadoAnterior(a: PromocionServicio) {
    const p = promociones.get(a.promocion_id) ?? null
    if (a.estado === 'quitada') {
        return estadoAsignacion(a, p)
    }
    return p?.vigencia === 'cancelada'
        ? { etiqueta: `Cancelada${p.motivo_cancelacion ? ` · «${p.motivo_cancelacion}»` : ''}`, icono: 'i-lucide-circle-x', color: 'neutral' as const }
        : { etiqueta: 'Terminó', icono: 'i-lucide-check', color: 'neutral' as const }
}

/* Ventanas. */
const agregarAbierto = ref(false)
const quitarAbierto = ref(false)
const aQuitar = shallowRef<PromocionServicio | null>(null)

function abrirQuitar(a: PromocionServicio) {
    aQuitar.value = a
    quitarAbierto.value = true
}

function alQuitar() {
    toast.add({ title: 'Promoción quitada', description: `${props.servicio.codigo ?? 'El servicio'} vuelve a la velocidad de ${props.servicio.plan_nombre}.`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('cambiada')
    void cargar()
}

function alAgregar(promocion: PromocionVelocidad) {
    toast.add({ title: `Agregado a «${promocion.nombre}»`, description: 'Si el horario ya empezó, la velocidad ya subió.', icon: 'i-lucide-circle-check', color: 'success' })
    emit('cambiada')
    void cargar()
}

const puedeAgregar = computed(() => puede('promociones_velocidad.asignar') && puede('promociones_velocidad.ver') && props.servicio.estado !== 'retirado')

function abrirAgregar() {
    agregarAbierto.value = true
}

defineExpose({ abrirAgregar, puedeAgregar })
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="promociones-servicio"
    >
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <UAlert
                color="primary"
                variant="subtle"
                icon="i-lucide-info"
                description="Más velocidad por días o en horas fijas, sin cortar la sesión. Una sola promoción a la vez por servicio."
                class="flex-1"
                :ui="{ root: 'py-2' }"
            />
            <div class="flex shrink-0 gap-2">
                <UButton
                    v-if="puedeAgregar"
                    label="Agregar a una promoción"
                    icon="i-lucide-zap"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="rounded-full"
                    data-prueba="agregar-a-promocion"
                    @click="agregarAbierto = true"
                />
                <UButton
                    v-if="puede('promociones_velocidad.crear') && servicio.estado !== 'retirado'"
                    :to="`/planes/promociones/nueva?servicio=${servicio.id}`"
                    label="Nueva promoción"
                    icon="i-lucide-plus"
                    size="sm"
                    class="rounded-full"
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
            v-else-if="cargando"
            class="h-20 w-full rounded-2xl"
        />
        <template v-else>
            <p
                v-if="!asignaciones.length"
                class="py-4 text-sm text-muted"
            >
                Este servicio no ha tenido promociones de velocidad.
            </p>

            <section
                v-for="a in actuales"
                :key="a.id"
                class="flex flex-col gap-3 rounded-2xl border border-info/40 p-3 sm:flex-row sm:items-center"
                data-prueba="promocion-actual"
            >
                <span class="pastilla-icono size-10 shrink-0 rounded-xl bg-info/10 text-info">
                    <UIcon
                        name="i-lucide-zap"
                        class="size-5"
                    />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                    <span class="text-sm">
                        <ULink
                            v-if="puede('promociones_velocidad.ver')"
                            :to="`/planes/promociones/${a.promocion_id}`"
                            class="text-base font-semibold text-highlighted hover:text-primary"
                        >{{ a.promocion_nombre }}</ULink>
                        <strong
                            v-else
                            class="text-base text-highlighted"
                        >{{ a.promocion_nombre }}</strong>
                        <span
                            v-if="resumen(a)"
                            class="text-xs text-muted"
                        > · {{ resumen(a) }}</span>
                    </span>
                    <span class="text-xs text-muted">Asignada el {{ formatearFechaCorta(a.created_at) }}</span>
                </div>
                <UBadge
                    :label="estadoActual(a).etiqueta"
                    :icon="estadoActual(a).icono"
                    :color="estadoActual(a).color"
                    variant="subtle"
                    class="shrink-0 rounded-full"
                    data-prueba="estado-promocion-servicio"
                />
                <UButton
                    v-if="puede('promociones_velocidad.quitar')"
                    label="Quitar"
                    icon="i-lucide-x"
                    color="error"
                    variant="outline"
                    size="sm"
                    class="shrink-0 rounded-full"
                    data-prueba="quitar-promocion-servicio"
                    @click="abrirQuitar(a)"
                />
            </section>

            <template v-if="anteriores.length">
                <h3 class="pt-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                    Anteriores
                </h3>
                <ul class="flex flex-col divide-y divide-(--ax-borde)">
                    <li
                        v-for="a in anteriores"
                        :key="a.id"
                        class="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                        <span class="min-w-0 text-sm">
                            <strong class="text-highlighted">{{ a.promocion_nombre }}</strong>
                            <span
                                v-if="resumen(a)"
                                class="text-xs text-muted"
                            > · {{ resumen(a) }}</span>
                        </span>
                        <UBadge
                            :label="estadoAnterior(a).etiqueta"
                            :icon="estadoAnterior(a).icono"
                            :color="estadoAnterior(a).color"
                            variant="subtle"
                            size="sm"
                            class="w-fit shrink-0 rounded-full"
                        />
                    </li>
                </ul>
            </template>
        </template>

        <ServicioAgregarPromocionModal
            v-if="puedeAgregar"
            v-model:open="agregarAbierto"
            :servicio="servicio"
            :actuales="actuales.map(a => promociones.get(a.promocion_id)).filter((p): p is PromocionVelocidad => !!p)"
            @hecho="alAgregar"
        />
        <PromocionQuitarModal
            v-if="aQuitar && puede('promociones_velocidad.quitar')"
            v-model:open="quitarAbierto"
            :promocion-id="aQuitar.promocion_id"
            :promocion-nombre="aQuitar.promocion_nombre"
            :servicio-id="servicio.id"
            :servicio-etiqueta="servicio.codigo ?? `Servicio ${servicio.id}`"
            :plan-nombre="servicio.plan_nombre"
            @hecho="alQuitar"
        />
    </div>
</template>
