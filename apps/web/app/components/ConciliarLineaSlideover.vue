<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Concilia una línea del extracto (`POST /bancos/conciliaciones`, `bancos.conciliar`) con
 * movimientos del libro sin conciliar de la cuenta, depósitos de caja en tránsito hacia ella o
 * traslados que llegan a ella. Lo elegido debe sumar el monto de la línea (la API responde 422
 * `conciliacion_descuadrada` si no); se propone el de igual monto y referencia.
 */
const props = defineProps<{
    linea: LineaExtracto
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [conciliacion: Conciliacion]
}>()

const partidas = shallowRef<PartidaConciliable[]>([])
const elegidas = ref<string[]>([])
const cargando = ref(false)
const problemaCarga = ref<Problem | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const seleccion = computed(() => partidas.value.filter(p => elegidas.value.includes(p.clave)))
const diferencia = computed(() => diferenciaConciliacion(props.linea, seleccion.value))
const ETIQUETAS: Record<PartidaConciliable['tipo'], string> = { movimiento: 'Libro', deposito: 'Depósito', traslado: 'Traslado' }

async function cargar() {
    cargando.value = true
    problemaCarga.value = null
    const transito = useFondosEnTransito()
    const [movimientos, depositos, traslados] = await Promise.all([
        useConciliaciones().sinConciliar(props.linea.cuenta_id),
        transito.depositos('en_transito', undefined, 200),
        transito.traslados('en_transito', undefined, 200),
    ])
    cargando.value = false
    const fallo = (!movimientos.ok ? movimientos.problema : null) ?? (!depositos.ok ? depositos.problema : null) ?? (!traslados.ok ? traslados.problema : null)
    if (fallo || !movimientos.ok || !depositos.ok || !traslados.ok) {
        partidas.value = []
        problemaCarga.value = fallo
        return
    }
    partidas.value = [
        ...movimientos.data.map((m): PartidaConciliable => ({ clave: `m${m.movimiento_id}`, tipo: 'movimiento', id: m.movimiento_id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto })),
        ...depositos.data.data.filter(d => d.cuenta_id === props.linea.cuenta_id).map((d): PartidaConciliable => ({ clave: `d${d.id}`, tipo: 'deposito', id: d.id, fecha: d.fecha, descripcion: `Depósito #${d.id} · boleta ${d.boleta} · ${d.caja_nombre}`, monto: d.monto })),
        ...traslados.data.data.filter(t => t.cuenta_destino_id === props.linea.cuenta_id).map((t): PartidaConciliable => ({ clave: `t${t.id}`, tipo: 'traslado', id: t.id, fecha: t.fecha, descripcion: `Traslado #${t.id} · ${t.referencia} · desde ${t.cuenta_origen_codigo}`, monto: t.monto })),
    ]
    elegidas.value = sugerenciaConciliacion(props.linea, partidas.value).map(p => p.clave)
}

function alternar(clavePartida: string, valor: boolean | 'indeterminate') {
    const resto = elegidas.value.filter(c => c !== clavePartida)
    elegidas.value = valor === true ? [...resto, clavePartida] : resto
}

watch(abierto, (valor) => {
    if (valor) {
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargar()
    }
}, { immediate: true })

async function conciliar() {
    enviando.value = true
    problema.value = null
    const resultado = await useConciliaciones().conciliar(cuerpoConciliacion(props.linea.id, seleccion.value), clave)
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
    <USlideover
        v-model:open="abierto"
        title="Conciliar línea"
        :description="`${formatearFecha(linea.fecha)} · ${linea.descripcion}${linea.referencia ? ` · ${linea.referencia}` : ''} · ${montoConSigno(linea.monto)}`"
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <ProblemaAlerta
                    v-if="problemaCarga"
                    :problema="problemaCarga"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <USkeleton
                    v-else-if="cargando"
                    class="h-40 w-full"
                />
                <UEmpty
                    v-else-if="!partidas.length"
                    icon="i-lucide-search-x"
                    title="Nada que conciliar en esta cuenta"
                    description="Si la línea no tiene documento (comisión, interés), usa Registrar."
                    variant="naked"
                />
                <ul
                    v-else
                    class="flex flex-col divide-y divide-default rounded-lg border border-default"
                    data-prueba="partidas-conciliables"
                >
                    <li
                        v-for="partida in partidas"
                        :key="partida.clave"
                        class="flex items-center justify-between gap-3 px-3 py-2"
                    >
                        <UCheckbox
                            :model-value="elegidas.includes(partida.clave)"
                            :label="partida.descripcion"
                            :description="`${ETIQUETAS[partida.tipo]} · ${formatearFecha(partida.fecha)}`"
                            :data-partida="partida.clave"
                            @update:model-value="alternar(partida.clave, $event)"
                        />
                        <span class="shrink-0 tabular-nums text-sm font-medium">{{ montoConSigno(partida.monto) }}</span>
                    </li>
                </ul>

                <div
                    class="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-2 text-sm"
                    data-prueba="diferencia-conciliacion"
                >
                    <span class="text-muted">Línea − elegido</span>
                    <UBadge
                        :label="diferencia.isZero() ? 'Cuadra' : formatearQuetzales(diferencia)"
                        :color="diferencia.isZero() ? 'success' : 'warning'"
                        :icon="diferencia.isZero() ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
                        variant="subtle"
                    />
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                    data-prueba="conciliar-error"
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
                    label="Conciliar"
                    icon="i-lucide-link"
                    :loading="enviando"
                    :disabled="!seleccion.length"
                    data-prueba="conciliar-confirmar"
                    @click="conciliar"
                />
            </div>
        </template>
    </USlideover>
</template>
