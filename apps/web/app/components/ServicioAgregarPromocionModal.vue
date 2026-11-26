<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Agregar … a una promoción» (tablero OperServicioFicha, ventana `prom`): las promociones
 * vigentes y programadas, una a elegir; las que se cruzan en fechas con la que ya tiene salen
 * deshabilitadas con «se encima» (la API lo exige igual: 422 `promocion_solapada`).
 * `POST /promociones-velocidad/:id/servicios` con este servicio (`promociones_velocidad.asignar`).
 */
const props = defineProps<{
    servicio: Servicio
    /** Las que el servicio tiene ahora. */
    actuales: PromocionVelocidad[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [promocion: PromocionVelocidad]
}>()

const opciones = shallowRef<PromocionVelocidad[]>([])
const cargando = ref(false)
const problemaLista = ref<Problem | null>(null)
const elegida = ref<number | undefined>(undefined)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const falla = computed(() => (problema.value ? fallaPromocion(problema.value) : null))
let claveIdempotencia = nuevaClaveIdempotencia()

async function cargar() {
    cargando.value = true
    problemaLista.value = null
    const [vigentes, programadas] = await Promise.all([
        leerTodas(cursor => usePromocionesVelocidad().listar({ vigencia: 'vigente', limit: 100 }, cursor)),
        leerTodas(cursor => usePromocionesVelocidad().listar({ vigencia: 'programada', limit: 100 }, cursor)),
    ])
    cargando.value = false
    if (!vigentes.ok || !programadas.ok) {
        problemaLista.value = !vigentes.ok ? vigentes.problema : !programadas.ok ? programadas.problema : null
        opciones.value = []
        return
    }
    opciones.value = [...vigentes.data.filas, ...programadas.data.filas].filter(p => p.empresa_id === props.servicio.empresa_id)
}

watch(abierto, (valor) => {
    if (valor) {
        elegida.value = undefined
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
        void cargar()
    }
})
watch(elegida, () => {
    claveIdempotencia = nuevaClaveIdempotencia()
    problema.value = null
})

/** La que ya tiene y se cruza en fechas con `p` (o la misma). */
function seEncima(p: PromocionVelocidad): PromocionVelocidad | null {
    return props.actuales.find(a => a.id === p.id || (a.inicio < p.fin && a.fin > p.inicio)) ?? null
}

function detalle(p: PromocionVelocidad): string {
    const encima = seEncima(p)
    if (encima) {
        return encima.id === p.id ? 'ya la tiene' : `se encima con «${encima.nombre}»`
    }
    return [velocidadCortaPromocion(p), horarioPromocion(p).toLowerCase() === 'todo el día' ? 'todo el día' : horarioPromocion(p), periodoPromocion(p), p.precio === null ? 'gratis' : precioPromocion(p)].join(' · ')
}

const encimadas = computed(() => opciones.value.filter(p => seEncima(p) && seEncima(p)?.id !== p.id))

async function agregar() {
    if (elegida.value === undefined) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await usePromocionesVelocidad().asignar(elegida.value, [props.servicio.id], claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Agregar ${servicio.codigo ?? 'el servicio'} a una promoción`"
        description="Elige la promoción."
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                :texto="`Agregar ${servicio.codigo ?? 'el servicio'} a una promoción`"
                icono="i-lucide-zap"
            />
        </template>
        <template #body>
            <div class="flex flex-col gap-3">
                <ProblemaAlerta
                    v-if="problemaLista"
                    :problema="problemaLista"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <USkeleton
                    v-else-if="cargando"
                    class="h-24 w-full"
                />
                <p
                    v-else-if="!opciones.length"
                    class="text-sm text-muted"
                >
                    No hay promociones vigentes ni programadas de esta empresa.
                </p>
                <URadioGroup
                    v-else
                    v-model="elegida"
                    :items="opciones.map(p => ({ label: p.nombre, description: detalle(p), value: p.id, disabled: !!seEncima(p) }))"
                    variant="card"
                    aria-label="Promoción"
                    :ui="{ fieldset: 'gap-2', item: 'rounded-xl' }"
                    data-prueba="opciones-promocion"
                />
                <UAlert
                    v-if="encimadas.length"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :description="`${encimadas.map(p => `«${p.nombre}»`).join(', ')} se ${encimadas.length === 1 ? 'encima' : 'enciman'} con la que ya tiene: un servicio no puede tener dos promociones con fechas que se crucen.`"
                />
                <UAlert
                    v-if="falla"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="falla.titulo"
                    :description="`${falla.detalle} ${falla.ayuda}`"
                    data-prueba="falla-agregar"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    label="Agregar"
                    :icon="ICONOS.guardar"
                    class="rounded-full"
                    :loading="enviando"
                    :disabled="elegida === undefined"
                    data-prueba="confirmar-agregar-promocion"
                    @click="agregar"
                />
            </div>
        </template>
    </UModal>
</template>
