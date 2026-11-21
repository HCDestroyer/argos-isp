<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Cierre de caja en 3 pasos (tableros NuevoCierreCaja y NuevoCierreCajaMovil, `cajas.cerrar`):
 *
 * 1. **Contar**: billetes y monedas; al lado, lo que debe haber según el resumen del turno
 *    (`GET /cajas/turno-actual/resumen`) y si falta o sobra.
 * 2. **Revisar**: lo cobrado por método, el motivo si hay diferencia (obligatorio), el fondo que
 *    queda para el siguiente turno y a quién se entrega el resto.
 * 3. **Cerrada**: el resultado oficial de `POST /cajas/:id/cerrar` (con `denominaciones[]`,
 *    `fondo_siguiente` y `entregado_a`) e imprimir el corte.
 *
 * Si el resumen no se puede leer no se muestra ningún «debe haber» inventado: se puede contar y
 * cerrar igual, y la API calcula la diferencia.
 */
const props = defineProps<{
    caja: Caja
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [turno: TurnoCaja]
}>()

const usuario = useUsuarioActual()
const { puede } = usePermisos()
const impresion = useImpresionCaja()

const paso = ref<1 | 2 | 3>(1)
const resumen = shallowRef<ResumenTurnoCaja | null>(null)
const cargando = ref(false)
const problemaResumen = ref<Problem | null>(null)
const conteo = ref<ConteoEfectivo>({})
const motivoTipo = ref<string | null>(null)
const nota = ref('')
const fondoSiguiente = ref('')
const entregadoA = ref<number | undefined>(undefined)
const usuarios = shallowRef<{ label: string, value: number }[]>([])
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const cerrado = shallowRef<TurnoCaja | null>(null)
let clave = nuevaClaveIdempotencia()

const MOTIVOS = ['Faltó cambio', 'Error al cobrar', 'Billete falso', 'Otro']
const PASOS = [
    { numero: 1, titulo: 'Contar' },
    { numero: 2, titulo: 'Revisar' },
    { numero: 3, titulo: 'Cerrada' },
] as const

const contado = computed(() => totalConteo(conteo.value))
const esperado = computed(() => (resumen.value ? new Decimal(resumen.value.esperado) : null))
const diferencia = computed(() => (esperado.value ? contado.value.minus(esperado.value) : null))
const hayDiferencia = computed(() => Boolean(diferencia.value && !diferencia.value.isZero()))
const motivo = computed(() => [motivoTipo.value, nota.value.trim()].filter(Boolean).join(': '))
const fondo = computed(() => (/^\d{1,12}(\.\d{1,2})?$/.test(fondoSiguiente.value.trim()) ? new Decimal(fondoSiguiente.value.trim()) : null))
const resto = computed(() => (fondo.value ? contado.value.minus(fondo.value) : null))

/** Duración del turno: «9 h 14 min». */
const duracion = computed(() => {
    const desde = resumen.value?.abierto_en
    if (!desde) {
        return null
    }
    const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000))
    return `${Math.floor(minutos / 60)} h ${minutos % 60} min`
})

const subtitulo = computed(() => {
    if (!resumen.value) {
        return props.caja.turno_abierto_por_nombre ?? ''
    }
    const quien = resumen.value.abierto_por_nombre ?? props.caja.turno_abierto_por_nombre
    return [quien, `abierta ${formatearHora(resumen.value.abierto_en)}`, duracion.value].filter(Boolean).join(' · ')
})

/** Cobros por método (paso 2): efectivo contado; los demás se concilian en Bancos. */
const METODOS_CIERRE: Record<string, { etiqueta: string, icono: string, detalle: string }> = {
    caja: { etiqueta: 'Efectivo', icono: 'i-lucide-banknote', detalle: 'contado' },
    debito: { etiqueta: 'Tarjeta', icono: 'i-lucide-credit-card', detalle: 'cuadrar con el cierre del POS' },
    transferencia: { etiqueta: 'Transferencias', icono: 'i-lucide-zap', detalle: 'se concilian en Bancos' },
    ach: { etiqueta: 'ACH', icono: 'i-lucide-zap', detalle: 'se concilian en Bancos' },
    deposito: { etiqueta: 'Depósitos', icono: 'i-lucide-landmark', detalle: 'se concilian en Bancos' },
    remesa: { etiqueta: 'Remesas', icono: 'i-lucide-send', detalle: 'se concilian en Bancos' },
    agente: { etiqueta: 'Agente bancario', icono: 'i-lucide-store', detalle: 'los liquida el proveedor' },
}
const porMetodo = computed(() => (resumen.value?.cobros.por_metodo ?? []).map(m => ({
    ...m,
    ...(METODOS_CIERRE[m.metodo] ?? { etiqueta: m.metodo, icono: 'i-lucide-circle-dollar-sign', detalle: '' }),
})))

async function cargarResumen() {
    if (!puede('cajas.ver')) {
        return
    }
    cargando.value = true
    problemaResumen.value = null
    const resultado = await useCajas().resumen(props.caja.id)
    cargando.value = false
    resumen.value = resultado.ok ? resultado.data : null
    problemaResumen.value = resultado.ok ? null : resultado.problema
}

async function cargarUsuarios() {
    if (!puede('usuarios.ver') || usuarios.value.length) {
        return
    }
    const resultado = await useUsuarios().listar()
    usuarios.value = resultado.ok ? resultado.data.data.filter(u => u.activo !== false).map(u => ({ label: u.id === usuario.value?.id ? `${u.nombre} (tú)` : u.nombre, value: u.id })) : []
}

watch(abierto, (valor) => {
    if (valor) {
        paso.value = 1
        conteo.value = {}
        motivoTipo.value = null
        nota.value = ''
        fondoSiguiente.value = ''
        entregadoA.value = undefined
        problema.value = null
        cerrado.value = null
        clave = nuevaClaveIdempotencia()
        void cargarResumen()
        void cargarUsuarios()
    }
}, { immediate: true })

function ponerEnCero() {
    conteo.value = {}
}

const errorPaso2 = computed<string | null>(() => {
    if (hayDiferencia.value && motivo.value.length < 3) {
        return 'Hay diferencia: elige el motivo y escribe la nota.'
    }
    if (fondoSiguiente.value.trim() && !fondo.value) {
        return 'El fondo que queda es un monto con hasta 2 decimales.'
    }
    if (fondo.value && fondo.value.gt(contado.value)) {
        return 'El fondo que queda no puede ser mayor que lo contado.'
    }
    if (resto.value?.gt(0) && !entregadoA.value) {
        return 'Indica a quién entregas el efectivo que no queda en la caja.'
    }
    return null
})

async function cerrar() {
    if (errorPaso2.value || enviando.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().cerrar(props.caja.id, {
        contado: contado.value.toFixed(2),
        denominaciones: denominacionesDelConteo(conteo.value),
        motivo: motivo.value || null,
        ...(fondo.value ? { fondo_siguiente: fondo.value.toFixed(2), entregado_a: resto.value?.gt(0) ? (entregadoA.value ?? null) : null } : {}),
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        if (resultado.problema.status >= 400 && resultado.problema.status < 500 && resultado.problema.status !== 409) {
            clave = nuevaClaveIdempotencia()
        }
        return
    }
    cerrado.value = resultado.data
    paso.value = 3
    void useMiCaja().refrescar()
    emit('hecho', resultado.data)
}

/** Efectivo que sale de la caja con el cierre: lo contado menos el fondo que queda. */
const aEntregar = computed(() => {
    const turno = cerrado.value
    if (!turno?.contado) {
        return null
    }
    return turno.entregado_monto ?? new Decimal(turno.contado).minus(turno.fondo_siguiente ?? '0').toFixed(2)
})

const imprimiendo = ref<FormatoImpresion | null>(null)
async function imprimirCorte(formato: FormatoImpresion) {
    imprimiendo.value = formato
    await nextTick()
    if (typeof window.print === 'function') {
        window.print()
    }
    imprimiendo.value = null
}
const formatoCaja = computed(() => impresion.formatoDe(props.caja.id))
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando && paso !== 2"
        :ui="{ content: 'sm:max-w-[61.25rem] max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none', header: 'gap-3', body: 'p-0 sm:p-0', footer: 'bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <span class="flex items-center gap-3">
                <span class="pastilla-icono hidden bg-success/10 text-success sm:flex">
                    <UIcon
                        name="i-lucide-wallet"
                        class="size-5"
                    />
                </span>
                <span class="flex flex-col">
                    <span>Cerrar {{ caja.nombre }}</span>
                    <span
                        class="text-xs font-normal text-muted"
                        data-prueba="cierre-subtitulo"
                    >
                        <span class="sm:hidden">Paso {{ paso }} de 3 · {{ PASOS[paso - 1]?.titulo }}</span>
                        <span class="hidden sm:inline">{{ subtitulo }}</span>
                    </span>
                </span>
            </span>
        </template>
        <template #description>
            <span class="sr-only">Contar el efectivo, revisar el día y cerrar la caja</span>
        </template>
        <template #actions>
            <ol
                class="hidden flex-1 items-center gap-2 px-4 md:flex"
                aria-label="Pasos del cierre"
            >
                <template
                    v-for="(p, indice) in PASOS"
                    :key="p.numero"
                >
                    <li
                        class="flex items-center gap-2 text-sm font-semibold"
                        :class="paso === p.numero && p.numero !== 3 ? 'text-primary' : paso > p.numero || (p.numero === 3 && paso === 3) ? 'text-success' : 'text-muted'"
                        :aria-current="paso === p.numero ? 'step' : undefined"
                    >
                        <span
                            class="flex size-6 items-center justify-center rounded-full text-xs"
                            :class="paso === p.numero && p.numero !== 3 ? 'bg-primary text-inverted ring-4 ring-primary/15' : paso > p.numero || (p.numero === 3 && paso === 3) ? 'bg-success/15 text-success' : 'bg-(--ax-panel) text-muted'"
                        >
                            <UIcon
                                v-if="paso > p.numero"
                                name="i-lucide-check"
                                class="size-3.5"
                            />
                            <template v-else>{{ p.numero }}</template>
                        </span>
                        {{ p.titulo }}
                    </li>
                    <li
                        v-if="indice < PASOS.length - 1"
                        class="h-px min-w-10 flex-1 bg-(--ax-borde)"
                        aria-hidden="true"
                    />
                </template>
            </ol>
            <span class="me-8 flex">
                <AyudaBoton solo-icono />
            </span>
        </template>

        <template #body>
            <!-- Paso 1: contar el efectivo. -->
            <div
                v-if="paso === 1"
                class="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_20.625rem]"
                data-prueba="cierre-paso-contar"
            >
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-2">
                        <h3 class="text-[0.9375rem] font-bold text-highlighted">
                            Cuenta el efectivo
                        </h3>
                        <span class="hidden flex-1 text-xs text-muted sm:inline">cantidad de billetes y monedas</span>
                        <span class="flex-1 sm:hidden" />
                        <UButton
                            label="Poner en cero"
                            color="primary"
                            variant="link"
                            size="sm"
                            @click="ponerEnCero"
                        />
                    </div>
                    <CajaConteo v-model="conteo" />
                </div>

                <aside
                    class="flex h-fit flex-col gap-0 rounded-2xl bg-(--ax-panel) p-4 max-lg:hidden"
                    aria-label="Efectivo en caja"
                    data-prueba="cierre-efectivo"
                >
                    <h3 class="mb-2 text-sm font-bold text-highlighted">
                        Efectivo en caja
                    </h3>
                    <ProblemaAlerta
                        v-if="problemaResumen"
                        :problema="problemaResumen"
                        :reintentar="cargarResumen"
                        :reintentando="cargando"
                    />
                    <USkeleton
                        v-else-if="cargando && !resumen"
                        class="h-32 w-full"
                    />
                    <dl
                        v-else-if="resumen"
                        class="flex flex-col divide-y divide-(--ax-borde) text-sm"
                    >
                        <div class="flex justify-between gap-2 py-2">
                            <dt class="text-muted">
                                Fondo inicial
                            </dt>
                            <dd class="font-semibold tabular-nums">
                                {{ formatearQuetzales(resumen.fondo_inicial) }}
                            </dd>
                        </div>
                        <div class="flex justify-between gap-2 py-2">
                            <dt class="text-muted">
                                Cobros en efectivo ({{ resumen.efectivo_cobrado.cantidad }})
                            </dt>
                            <dd class="font-semibold tabular-nums">
                                {{ formatearQuetzales(resumen.efectivo_cobrado.monto) }}
                            </dd>
                        </div>
                        <div
                            v-if="new Decimal(resumen.ingresos.monto).gt(resumen.ingresos.cobros_efectivo.monto)"
                            class="flex justify-between gap-2 py-2"
                        >
                            <dt class="text-muted">
                                Otros ingresos
                            </dt>
                            <dd class="font-semibold tabular-nums">
                                {{ formatearQuetzales(new Decimal(resumen.ingresos.monto).minus(resumen.ingresos.cobros_efectivo.monto)) }}
                            </dd>
                        </div>
                        <div class="flex justify-between gap-2 py-2">
                            <dt class="text-muted">
                                Retiros<template v-if="resumen.retiros.cantidad">
                                    ({{ resumen.retiros.cantidad }})
                                </template>
                            </dt>
                            <dd class="font-semibold tabular-nums">
                                {{ new Decimal(resumen.retiros.monto).isZero() ? formatearQuetzales('0.00') : `− ${formatearQuetzales(resumen.retiros.monto)}` }}
                            </dd>
                        </div>
                        <div class="flex justify-between gap-2 py-2.5">
                            <dt class="font-semibold text-highlighted">
                                Debe haber
                            </dt>
                            <dd
                                class="text-lg font-bold tabular-nums text-highlighted"
                                data-prueba="cierre-esperado"
                            >
                                {{ formatearQuetzales(resumen.esperado) }}
                            </dd>
                        </div>
                    </dl>
                    <div class="flex justify-between gap-2 border-t border-(--ax-borde) py-2.5 text-sm">
                        <span class="font-semibold text-highlighted">Contado</span>
                        <span
                            class="text-lg font-bold tabular-nums text-highlighted"
                            data-prueba="cierre-contado"
                        >{{ formatearQuetzales(contado) }}</span>
                    </div>
                    <template v-if="diferencia">
                        <div
                            class="mt-1 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5"
                            :class="diferencia.isZero() ? 'bg-success/10 text-success' : diferencia.isNegative() ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'"
                            data-prueba="cierre-diferencia"
                        >
                            <span class="flex items-center gap-1.5 text-sm font-semibold">
                                <UIcon
                                    :name="iconoDiferencia(diferencia)"
                                    class="size-4"
                                />
                                {{ diferencia.isZero() ? 'Cuadra' : diferencia.isNegative() ? 'Falta' : 'Sobra' }}
                            </span>
                            <span class="text-xl font-bold tabular-nums">{{ diferencia.isZero() ? formatearQuetzales('0.00') : `${diferencia.isNegative() ? '−' : '+'} ${formatearQuetzales(diferencia.abs())}` }}</span>
                        </div>
                        <p class="mt-2 text-xs text-muted">
                            {{ diferencia.isZero() ? 'Todo cuadra. Puedes revisar y cerrar.' : 'Vuelve a contar. Si la diferencia sigue, en el siguiente paso explicas el motivo.' }}
                        </p>
                    </template>
                    <p
                        v-else-if="problemaResumen"
                        class="mt-2 text-xs text-muted"
                    >
                        Sin el resumen no se calcula aquí la diferencia: la API la calcula al cerrar.
                    </p>
                </aside>
            </div>

            <!-- Paso 2: revisar el día. -->
            <div
                v-else-if="paso === 2"
                class="flex flex-col gap-4 p-4 sm:p-5"
                data-prueba="cierre-paso-revisar"
            >
                <h3 class="text-[0.9375rem] font-bold text-highlighted">
                    Revisa el día
                </h3>
                <ProblemaAlerta
                    v-if="problemaResumen"
                    :problema="problemaResumen"
                    :reintentar="cargarResumen"
                    :reintentando="cargando"
                />
                <div
                    v-else-if="resumen"
                    class="overflow-hidden rounded-2xl border border-(--ax-borde)"
                >
                    <div class="flex justify-between bg-(--ax-cabecera-tabla) px-4 py-2 text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
                        <span>Método</span>
                        <span>Total</span>
                    </div>
                    <ul
                        class="divide-y divide-(--ax-borde)"
                        aria-label="Cobros del turno por método"
                    >
                        <li
                            v-for="m in porMetodo"
                            :key="m.metodo"
                            class="flex items-center gap-3 px-4 py-3"
                            :data-metodo="m.metodo"
                        >
                            <span class="pastilla-icono size-9 shrink-0 bg-primary/10 text-primary">
                                <UIcon
                                    :name="m.icono"
                                    class="size-4"
                                />
                            </span>
                            <span class="flex min-w-0 flex-1 flex-col">
                                <span class="font-semibold text-highlighted">{{ m.etiqueta }}</span>
                                <span class="text-xs text-muted">{{ m.cantidad }} {{ m.cantidad === 1 ? 'cobro' : 'cobros' }}<template v-if="m.detalle"> · {{ m.detalle }}</template></span>
                            </span>
                            <UBadge
                                v-if="m.metodo === 'caja' && diferencia"
                                :label="etiquetaCuadre(diferencia)"
                                :color="colorDiferencia(diferencia)"
                                :icon="iconoDiferencia(diferencia)"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                            <UBadge
                                v-else-if="m.metodo !== 'caja'"
                                label="Informativo"
                                icon="i-lucide-info"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                            <span class="w-28 text-end font-bold tabular-nums text-highlighted">{{ formatearQuetzales(m.monto) }}</span>
                        </li>
                        <li
                            v-if="!porMetodo.length"
                            class="px-4 py-3 text-sm text-muted"
                        >
                            Sin cobros en este turno.
                        </li>
                    </ul>
                    <div class="flex items-center gap-2 border-t border-(--ax-borde) px-4 py-3">
                        <span class="font-bold text-highlighted">Total cobrado</span>
                        <span class="flex-1 text-xs text-muted">{{ resumen.cobros.cantidad }} {{ resumen.cobros.cantidad === 1 ? 'cobro' : 'cobros' }}</span>
                        <span
                            class="text-lg font-bold tabular-nums text-highlighted"
                            data-prueba="cierre-total-cobrado"
                        >{{ formatearQuetzales(resumen.cobros.monto) }}</span>
                    </div>
                </div>

                <div
                    v-if="hayDiferencia && diferencia"
                    class="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4"
                    data-prueba="cierre-motivo"
                >
                    <p class="text-sm font-bold text-warning">
                        Hay una diferencia de {{ diferencia.isNegative() ? '−' : '+' }} {{ formatearQuetzales(diferencia.abs()) }}: explica por qué
                    </p>
                    <div
                        class="flex flex-wrap gap-2"
                        role="group"
                        aria-label="Motivo de la diferencia"
                    >
                        <UButton
                            v-for="m in MOTIVOS"
                            :key="m"
                            :label="m"
                            :color="motivoTipo === m ? 'primary' : 'neutral'"
                            :variant="motivoTipo === m ? 'solid' : 'outline'"
                            :aria-pressed="motivoTipo === m"
                            class="rounded-full bg-(--ax-tarjeta)"
                            :class="motivoTipo === m ? 'bg-primary' : ''"
                            @click="motivoTipo = m"
                        />
                    </div>
                    <UTextarea
                        v-model="nota"
                        :rows="2"
                        placeholder="Nota (obligatoria)"
                        aria-label="Nota del motivo de la diferencia"
                        class="w-full"
                    />
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Fondo que queda para mañana"
                        help="Efectivo que se queda en la caja para el siguiente turno. Opcional."
                    >
                        <UInput
                            v-model="fondoSiguiente"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                            data-prueba="cierre-fondo-siguiente"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Entrega a"
                        :required="Boolean(resto?.gt(0))"
                        :help="resto?.gt(0) ? `Recibe ${formatearQuetzales(resto)} hasta depositarlo.` : 'Quien recibe el efectivo que no queda en la caja.'"
                    >
                        <USelectMenu
                            v-if="usuarios.length"
                            v-model="entregadoA"
                            :items="usuarios"
                            value-key="value"
                            placeholder="Elegir persona…"
                            icon="i-lucide-user"
                            :disabled="!fondo"
                            class="w-full"
                            data-prueba="cierre-entrega"
                        />
                        <p
                            v-else
                            class="text-sm text-muted"
                        >
                            {{ puede('usuarios.ver') ? 'No se pudo leer la lista de usuarios.' : 'Sin permiso para ver usuarios (usuarios.ver): cierra sin fondo para el siguiente turno.' }}
                        </p>
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>

            <!-- Paso 3: cerrada. -->
            <div
                v-else-if="cerrado"
                class="flex flex-col items-center gap-4 px-4 py-10 text-center sm:py-16"
                data-prueba="resultado-cierre"
            >
                <span class="flex size-20 items-center justify-center rounded-full bg-success/15 text-success">
                    <UIcon
                        name="i-lucide-check"
                        class="size-10"
                    />
                </span>
                <h3 class="text-2xl font-bold text-highlighted">
                    Caja cerrada
                </h3>
                <p class="text-sm text-muted">
                    {{ caja.nombre }}<template v-if="cerrado.cerrado_por_nombre ?? cerrado.abierto_por_nombre">
                        · {{ cerrado.cerrado_por_nombre ?? cerrado.abierto_por_nombre }}
                    </template> · {{ formatearHora(cerrado.abierto_en) }} a {{ cerrado.cerrado_en ? formatearHora(cerrado.cerrado_en) : '—' }} · corte <span class="font-mono">#{{ cerrado.id }}</span>
                </p>
                <div class="grid w-full max-w-lg grid-cols-3 gap-2">
                    <div class="flex flex-col rounded-xl bg-(--ax-panel) p-3 text-start">
                        <span class="text-xs text-muted">Cobrado</span>
                        <span class="text-lg font-bold tabular-nums text-highlighted sm:text-xl">{{ resumen ? formatearQuetzales(resumen.cobros.monto) : '—' }}</span>
                    </div>
                    <div class="flex flex-col rounded-xl bg-(--ax-panel) p-3 text-start">
                        <span class="text-xs text-muted">Efectivo a entregar</span>
                        <span
                            class="text-lg font-bold tabular-nums text-highlighted sm:text-xl"
                            data-prueba="cierre-a-entregar"
                        >{{ aEntregar ? formatearQuetzales(aEntregar) : '—' }}</span>
                    </div>
                    <div class="flex flex-col rounded-xl bg-(--ax-panel) p-3 text-start">
                        <span class="text-xs text-muted">Diferencia</span>
                        <span
                            class="text-lg font-bold tabular-nums sm:text-xl"
                            :class="colorDiferencia(cerrado.diferencia) === 'success' ? 'text-success' : colorDiferencia(cerrado.diferencia) === 'error' ? 'text-error' : 'text-warning'"
                            data-prueba="cierre-diferencia-oficial"
                        >{{ cerrado.diferencia ? (new Decimal(cerrado.diferencia).isZero() ? 'Cuadra' : `${new Decimal(cerrado.diferencia).isNegative() ? '−' : '+'} ${formatearQuetzales(new Decimal(cerrado.diferencia).abs())}`) : '—' }}</span>
                    </div>
                </div>
                <div class="flex flex-wrap justify-center gap-2">
                    <UButton
                        label="Imprimir corte (POS)"
                        :icon="ICONOS.imprimir"
                        color="neutral"
                        :variant="formatoCaja === 'pos_80' ? 'solid' : 'outline'"
                        class="rounded-full"
                        @click="imprimirCorte('pos_80')"
                    />
                    <UButton
                        label="Carta"
                        :icon="ICONOS.imprimir"
                        color="neutral"
                        :variant="formatoCaja === 'carta' ? 'solid' : 'outline'"
                        class="rounded-full"
                        @click="imprimirCorte('carta')"
                    />
                </div>
                <UButton
                    label="Listo"
                    size="lg"
                    class="glow-brand rounded-full px-8"
                    data-prueba="cierre-listo"
                    @click="abierto = false"
                />
                <CajaCorteImpresion
                    v-if="imprimiendo"
                    :caja="caja"
                    :turno="cerrado"
                    :resumen="resumen"
                    :formato="imprimiendo"
                />
            </div>
        </template>

        <template
            v-if="paso < 3"
            #footer
        >
            <div class="flex w-full flex-wrap items-center justify-between gap-3">
                <p
                    class="hidden text-sm text-muted sm:block"
                    data-prueba="cierre-pie"
                >
                    <template v-if="paso === 1">
                        Contado {{ formatearQuetzales(contado) }}<template v-if="esperado">
                            · debe haber {{ formatearQuetzales(esperado) }}
                        </template>
                    </template>
                    <template v-else>
                        Al cerrar ya no se pueden registrar cobros en esta caja.
                    </template>
                </p>
                <div
                    v-if="paso === 1"
                    class="flex w-full items-center gap-3 sm:hidden"
                >
                    <span class="text-sm text-muted">Contado</span>
                    <span class="flex-1 text-lg font-bold tabular-nums text-highlighted">{{ formatearQuetzales(contado) }}</span>
                    <UBadge
                        v-if="diferencia"
                        :label="etiquetaCuadre(diferencia)"
                        :color="colorDiferencia(diferencia)"
                        variant="subtle"
                        class="rounded-full"
                    />
                </div>
                <p
                    v-if="paso === 2 && errorPaso2"
                    class="w-full text-xs text-warning sm:w-auto"
                    data-prueba="cierre-falta"
                >
                    {{ errorPaso2 }}
                </p>
                <div class="flex w-full gap-2 sm:w-auto">
                    <UButton
                        v-if="paso === 2"
                        label="Atrás"
                        :icon="ICONOS.volver"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        :disabled="enviando"
                        @click="paso = 1"
                    />
                    <UButton
                        v-if="paso === 1"
                        label="Revisar"
                        trailing-icon="i-lucide-chevron-right"
                        class="glow-brand flex-1 justify-center rounded-full sm:flex-none"
                        data-prueba="cierre-revisar"
                        @click="paso = 2"
                    />
                    <UButton
                        v-else
                        label="Cerrar caja"
                        icon="i-lucide-check"
                        color="success"
                        class="flex-1 justify-center rounded-full sm:flex-none"
                        :loading="enviando"
                        :disabled="Boolean(errorPaso2)"
                        data-prueba="cierre-confirmar"
                        @click="cerrar"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>
