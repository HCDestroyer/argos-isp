<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Elegir los servicios de una promoción de velocidad (tableros PendPromocionForm, sección
 * «5 · Servicios», y la ventana «Asignar» de PendPromociones): buscador (`GET /servicios?q=`, sin
 * retirados) con casillas y la lista de los elegidos con su plan y router. La API busca por
 * cliente, usuario PPP o IP; el tablero dice «código, cliente o router» (anotado en a4.md). El servicio que hizo fallar un 422 (todo o nada) queda marcado con el motivo.
 */
withDefaults(defineProps<{
    /** Servicios que ya tienen la promoción: salen marcados y no se pueden elegir otra vez. */
    yaAsignados?: number[]
    /** Servicio marcado por el último 422, con su motivo. */
    falla?: { servicioId: number, titulo: string, ayuda: string } | null
    /** Sin la lista de elegidos debajo (la ventana muestra solo los resultados con casillas). */
    soloResultados?: boolean
}>(), {
    yaAsignados: () => [],
    falla: null,
    soloResultados: false,
})

const elegidos = defineModel<Servicio[]>({ required: true })

const { puede } = usePermisos()
/** Buscar servicios pide `servicios.ver`; sin él no hay buscador. */
const puedeBuscar = computed(() => puede('servicios.ver'))

const busqueda = ref('')
const resultados = shallowRef<Servicio[]>([])
const buscando = ref(false)
const problema = ref<Problem | null>(null)
let turno = 0

async function buscar() {
    const texto = busqueda.value.trim()
    const mio = ++turno
    if (texto.length < 2 || !puedeBuscar.value) {
        resultados.value = []
        problema.value = null
        return
    }
    buscando.value = true
    const resultado = await useServicios().listar({ q: texto, excluir_retirados: true, limit: 8 })
    if (mio !== turno) {
        return
    }
    buscando.value = false
    resultados.value = resultado.ok ? resultado.data.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void buscar(), 250)
})
onBeforeUnmount(() => clearTimeout(espera))

const idsElegidos = computed(() => new Set(elegidos.value.map(s => s.id)))

function alternar(servicio: Servicio, marcado: boolean | 'indeterminate') {
    if (marcado === true && !idsElegidos.value.has(servicio.id)) {
        elegidos.value = [...elegidos.value, servicio]
    }
    else if (marcado !== true) {
        quitar(servicio.id)
    }
}

function quitar(id: number) {
    elegidos.value = elegidos.value.filter(s => s.id !== id)
}

function detalle(servicio: Servicio): string {
    return `${servicio.plan_nombre} · ${servicio.router_nombre}`
}
</script>

<template>
    <div class="flex flex-col gap-3">
        <UAlert
            v-if="!puedeBuscar"
            color="neutral"
            variant="subtle"
            icon="i-lucide-lock"
            description="Para elegir servicios hace falta el permiso servicios.ver."
        />
        <UInput
            v-else
            v-model="busqueda"
            icon="i-lucide-search"
            placeholder="Buscar por cliente, usuario PPP o IP…"
            aria-label="Buscar servicio"
            class="w-full"
            :loading="buscando"
            :ui="{ base: 'rounded-full' }"
            data-prueba="buscar-servicio-promocion"
        />

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="buscar"
        />

        <div
            v-if="busqueda.trim().length >= 2 && !problema"
            class="flex flex-col divide-y divide-(--ax-borde) overflow-hidden rounded-xl border border-(--ax-borde)"
            data-prueba="resultados-servicio-promocion"
        >
            <p
                v-if="!buscando && !resultados.length"
                class="px-3 py-3 text-sm text-muted"
            >
                Ningún servicio coincide.
            </p>
            <div
                v-for="servicio in resultados"
                :key="servicio.id"
                class="flex items-start gap-3 px-3 py-2.5"
            >
                <UCheckbox
                    :model-value="idsElegidos.has(servicio.id) || yaAsignados.includes(servicio.id)"
                    :disabled="yaAsignados.includes(servicio.id)"
                    :aria-label="`Elegir ${servicio.codigo ?? servicio.id}`"
                    class="mt-0.5"
                    @update:model-value="valor => alternar(servicio, valor)"
                />
                <div class="flex min-w-0 flex-col">
                    <span class="text-sm">
                        <span class="font-semibold text-highlighted">{{ servicio.codigo }}</span>
                        <span class="text-muted"> · {{ servicio.cliente_nombre }}</span>
                    </span>
                    <span class="truncate text-xs text-muted">{{ detalle(servicio) }}<template v-if="yaAsignados.includes(servicio.id)"> · ya la tiene</template></span>
                </div>
            </div>
        </div>

        <ul
            v-if="!soloResultados && elegidos.length"
            class="flex flex-col divide-y divide-(--ax-borde) overflow-hidden rounded-xl border border-(--ax-borde)"
            data-prueba="servicios-elegidos"
        >
            <li
                v-for="servicio in elegidos"
                :key="servicio.id"
                class="flex items-start gap-3 px-3 py-2.5"
                :class="falla?.servicioId === servicio.id ? 'bg-error/5' : ''"
            >
                <span class="mt-0.5 shrink-0 rounded-md bg-(--ax-panel) px-1.5 py-0.5 font-mono text-xs text-default">{{ servicio.codigo }}</span>
                <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-sm">
                        <span class="font-semibold text-highlighted">{{ servicio.cliente_nombre }}</span>
                        <span class="text-xs text-muted"> · {{ detalle(servicio) }}</span>
                    </span>
                    <span
                        v-if="falla?.servicioId === servicio.id"
                        class="mt-0.5 flex items-start gap-1 text-xs text-error"
                        data-prueba="servicio-con-falla"
                    >
                        <UIcon
                            name="i-lucide-triangle-alert"
                            class="mt-0.5 size-3.5 shrink-0"
                        />
                        <span><strong>{{ falla.titulo }}.</strong> {{ falla.ayuda }}</span>
                    </span>
                </div>
                <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="rounded-full"
                    :aria-label="`Quitar ${servicio.codigo ?? servicio.id} de la lista`"
                    @click="quitar(servicio.id)"
                />
            </li>
        </ul>
    </div>
</template>
