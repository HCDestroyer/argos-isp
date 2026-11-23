<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Caja en la barra superior (pedido del PM): solo un icono de billetera con un punto de estado
 * (verde abierta, gris cerrada), sin montos en el icono; solo con `cajas.ver`. El clic abre un
 * menú con el resumen del turno (`GET /cajas/turno-actual/resumen`, se lee al abrirlo: desde
 * cuándo, fondo inicial, cobrado en efectivo, otros medios y lo que debe haber), «Ir a la caja» y,
 * aparte, «Cerrar caja…» (`cajas.cerrar`, abre la ventana del cierre en 3 pasos) o «Abrir caja…»
 * (`cajas.abrir`, la ventana de apertura). No aparece en la propia pantalla de caja.
 */
const { puede, enlace } = usePermisos()
const route = useRoute()
const miCaja = useMiCaja()

const visible = computed(() => puede('cajas.ver') && route.path !== '/caja')
const abierta = computed(() => miCaja.abierta.value)
const caja = computed(() => abierta.value ?? miCaja.propias.value[0] ?? null)
const menuAbierto = ref(false)
const aperturaAbierta = ref(false)

const turno = shallowRef<ResumenTurnoCaja | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const cierreAbierto = ref(false)
/** La caja que se está cerrando (se conserva mientras la ventana muestra «Caja cerrada»). */
const cajaCierre = shallowRef<Caja | null>(null)

async function cargarResumen() {
    turno.value = null
    problema.value = null
    const actual = abierta.value
    if (!actual?.turno_abierto_id) {
        return
    }
    cargando.value = true
    const resultado = await useCajas().resumen(actual.id)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    turno.value = resultado.data
}

function cerrarCaja() {
    menuAbierto.value = false
    cajaCierre.value = abierta.value
    cierreAbierto.value = true
}

watch(menuAbierto, (valor) => {
    if (valor) {
        void miCaja.refrescar().then(cargarResumen)
    }
})

onMounted(() => {
    if (visible.value) {
        void miCaja.cargar()
    }
})

/** Tras cobrar o al volver a la pestaña, el punto de estado se pone al día (sin sondeo). */
function alVolver() {
    if (document.visibilityState === 'visible' && visible.value) {
        void miCaja.refrescar()
    }
}
onMounted(() => document.addEventListener('visibilitychange', alVolver))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', alVolver))

const etiqueta = computed(() => (miCaja.cajas.value === null ? 'Caja' : abierta.value ? `Caja abierta: ${abierta.value.nombre}` : 'Caja cerrada'))

function abrirCaja() {
    menuAbierto.value = false
    aperturaAbierta.value = true
}

async function alAbrir() {
    await miCaja.refrescar()
}
</script>

<template>
    <div v-if="visible">
        <UPopover
            v-model:open="menuAbierto"
            :content="{ align: 'end', sideOffset: 8 }"
        >
            <UChip
                :show="miCaja.cajas.value !== null"
                :color="abierta ? 'success' : 'neutral'"
                size="md"
                inset
                :ui="{ base: PUNTO_FLOTANTE }"
            >
                <UButton
                    icon="i-lucide-wallet"
                    color="neutral"
                    variant="ghost"
                    class="boton-flotante boton-circulo"
                    :title="etiqueta"
                    :aria-label="etiqueta"
                    data-prueba="acceso-caja"
                />
            </UChip>
            <template #content>
                <div
                    class="flex w-72 flex-col gap-3 p-3"
                    data-prueba="menu-caja"
                >
                    <p class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                        <span
                            class="size-2 rounded-full"
                            :class="abierta ? 'bg-success' : 'bg-(--ui-text-dimmed)'"
                            aria-hidden="true"
                        />
                        <template v-if="caja">
                            {{ caja.nombre }} · {{ abierta ? 'abierta' : 'cerrada' }}<template v-if="turno">
                                desde {{ formatearHora(turno.abierto_en) }}
                            </template>
                        </template>
                        <template v-else>
                            No tienes una caja asignada
                        </template>
                    </p>
                    <template v-if="abierta">
                        <ProblemaAlerta
                            v-if="problema"
                            :problema="problema"
                            :reintentar="cargarResumen"
                            :reintentando="cargando"
                        />
                        <USkeleton
                            v-else-if="cargando"
                            class="h-10 w-full"
                        />
                        <dl
                            v-else-if="turno"
                            class="grid grid-cols-2 gap-2 rounded-lg bg-(--ax-panel) p-3 text-sm"
                            data-prueba="resumen-turno-menu"
                        >
                            <dt class="text-muted">
                                Fondo inicial
                            </dt>
                            <dd class="text-end font-semibold tabular-nums text-highlighted">
                                {{ formatearQuetzales(turno.fondo_inicial) }}
                            </dd>
                            <dt class="text-muted">
                                Efectivo ({{ turno.efectivo_cobrado.cantidad }})
                            </dt>
                            <dd class="text-end font-semibold tabular-nums text-highlighted">
                                {{ formatearQuetzales(turno.efectivo_cobrado.monto) }}
                            </dd>
                            <dt class="text-muted">
                                Otros medios ({{ turno.otros_medios.cantidad }})
                            </dt>
                            <dd class="text-end font-semibold tabular-nums text-highlighted">
                                {{ formatearQuetzales(turno.otros_medios.monto) }}
                            </dd>
                            <dt class="border-t border-(--ax-borde) pt-2 font-semibold text-highlighted">
                                Debe haber
                            </dt>
                            <dd class="border-t border-(--ax-borde) pt-2 text-end font-bold tabular-nums text-highlighted">
                                {{ formatearQuetzales(turno.esperado) }}
                            </dd>
                        </dl>
                    </template>
                    <div class="flex flex-col gap-1">
                        <UButton
                            v-if="enlace('/caja')"
                            :to="enlace('/caja')"
                            label="Ir a la caja"
                            icon="i-lucide-wallet"
                            color="neutral"
                            variant="ghost"
                            block
                            class="justify-start"
                            @click="menuAbierto = false"
                        />
                        <USeparator v-if="(abierta && puede('cajas.cerrar')) || (!abierta && caja && puede('cajas.abrir'))" />
                        <UButton
                            v-if="abierta && puede('cajas.cerrar')"
                            label="Cerrar caja…"
                            icon="i-lucide-lock"
                            color="neutral"
                            variant="ghost"
                            block
                            class="justify-start"
                            data-prueba="cerrar-caja-menu"
                            @click="cerrarCaja"
                        />
                        <UButton
                            v-if="!abierta && caja && puede('cajas.abrir')"
                            label="Abrir caja…"
                            icon="i-lucide-lock-open"
                            color="success"
                            variant="soft"
                            block
                            class="justify-start"
                            data-prueba="abrir-caja-menu"
                            @click="abrirCaja"
                        />
                    </div>
                </div>
            </template>
        </UPopover>
        <CajaCierreModal
            v-if="cajaCierre && puede('cajas.cerrar')"
            v-model:open="cierreAbierto"
            :caja="cajaCierre"
            @hecho="alAbrir"
        />
        <CajaAperturaModal
            v-if="caja && puede('cajas.abrir')"
            v-model:open="aperturaAbierta"
            :caja="caja"
            @hecho="alAbrir"
        />
    </div>
</template>
