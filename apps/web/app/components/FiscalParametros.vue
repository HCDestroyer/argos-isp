<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Parámetros fiscales de la empresa activa, vigentes a una fecha (`GET /fiscal/parametros?fecha=`):
 * valor, de dónde sale (empresa / instalación / global / paquete), fuente de la investigación y la
 * marca «confirmar con contador» cuando el valor no está verificado.
 */
const { puede } = usePermisos()
const toast = useToast()

const fecha = ref(hoyGuatemala())
const busqueda = ref('')
const soloPorConfirmar = ref(false)
const datos = shallowRef<ParametroFiscal[]>([])
const cargando = ref(false)
const leidos = ref(false)
const problema = ref<Problem | null>(null)

const claveHistorial = ref<string | null>(null)
const historialAbierto = ref(false)
const historial = useTemplateRef('historial')
const editando = shallowRef<ParametroFiscal | null>(null)
const valorAbierto = ref(false)

const columnas: TableColumn<ParametroFiscal>[] = [
    { accessorKey: 'clave', header: 'Parámetro' },
    { accessorKey: 'valor', header: 'Valor vigente' },
    { accessorKey: 'nivel', header: 'Fuente', meta: SOLO_ANCHO },
    { accessorKey: 'vigente_desde', header: 'Desde', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

const porConfirmar = computed(() => datos.value.filter(p => p.pendiente_confirmar).length)
const visibles = computed(() => {
    const texto = busqueda.value.trim().toLowerCase()
    return datos.value
        .filter(p => !soloPorConfirmar.value || p.pendiente_confirmar)
        .filter(p => !texto || p.clave.includes(texto) || p.descripcion.toLowerCase().includes(texto))
})

async function cargar() {
    // La página ya exige `fiscal.ver`; la guardia deja explícito el permiso de la lectura.
    if (!puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    const resultado = await useParametrosFiscales().listar(fecha.value || undefined)
    cargando.value = false
    leidos.value = true
    datos.value = resultado.ok ? resultado.data.parametros : []
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

function verHistorial(parametro: ParametroFiscal) {
    claveHistorial.value = parametro.clave
    historialAbierto.value = true
}

function nuevoValor(parametro: ParametroFiscal) {
    editando.value = parametro
    valorAbierto.value = true
}

function alGuardar(valor: ValorParametroCreado) {
    toast.add({
        title: `${valor.clave} actualizado`,
        description: `Nuevo valor desde ${formatearFecha(valor.vigente_desde)} (${valor.nivel === 'global' ? 'global' : 'de la empresa'}); lo anterior no cambia.`,
        icon: 'i-lucide-check',
        color: 'success',
    })
    void cargar()
    if (historialAbierto.value) {
        void historial.value?.cargar()
    }
}

watch(fecha, cargar)
onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <UFormField
                label="Vigentes al"
                class="sm:w-44"
            >
                <UInput
                    v-model="fecha"
                    type="date"
                    class="w-full"
                />
            </UFormField>
            <UInput
                v-model="busqueda"
                icon="i-lucide-search"
                placeholder="Buscar parámetro…"
                aria-label="Buscar parámetro"
                class="w-full sm:max-w-xs"
            />
            <USwitch
                v-model="soloPorConfirmar"
                :label="`Solo por confirmar con contador${leidos && !problema ? ` (${porConfirmar})` : ''}`"
                class="sm:ml-auto"
            />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="visibles"
            :columns="columnas"
            :loading="cargando"
            :empty="leidos ? 'Ningún parámetro con este filtro.' : ''"
        >
            <template #clave-cell="{ row }">
                <div
                    class="flex min-w-0 flex-col gap-1 whitespace-normal"
                    :data-parametro="row.original.clave"
                >
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="font-mono text-sm font-medium text-highlighted">{{ row.original.clave }}</span>
                        <UBadge
                            v-if="row.original.pendiente_confirmar"
                            label="Confirmar con contador"
                            icon="i-lucide-user-check"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                        <UBadge
                            v-if="row.original.alcance === 'N'"
                            label="Ley"
                            icon="i-lucide-lock"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                    </div>
                    <span class="line-clamp-2 text-xs text-muted">{{ row.original.descripcion }}</span>
                    <span
                        v-if="row.original.nivel"
                        class="text-xs text-muted sm:hidden"
                    >{{ NIVELES_FISCALES[row.original.nivel].etiqueta }}<template v-if="row.original.vigente_desde"> · desde {{ formatearFecha(row.original.vigente_desde) }}</template></span>
                </div>
            </template>
            <template #valor-cell="{ row }">
                <span
                    :class="['line-clamp-4 font-mono text-sm break-all whitespace-normal', row.original.valor === null ? 'text-warning' : 'text-highlighted']"
                    :title="row.original.tipo === 'json' ? formatearValorFiscal('json', row.original.valor) : undefined"
                >{{ formatearValorFiscal(row.original.tipo, row.original.valor, row.original.clave) }}</span>
            </template>
            <template #nivel-cell="{ row }">
                <div class="flex flex-col gap-1">
                    <UBadge
                        v-if="row.original.nivel"
                        :label="NIVELES_FISCALES[row.original.nivel].etiqueta"
                        :color="NIVELES_FISCALES[row.original.nivel].color"
                        variant="subtle"
                        size="sm"
                        class="w-fit"
                    />
                    <span class="max-w-56 truncate text-xs text-muted">{{ row.original.fuente }}</span>
                </div>
            </template>
            <template #vigente_desde-cell="{ row }">
                {{ formatearFecha(row.original.vigente_desde) }}
            </template>
            <template #acciones-cell="{ row }">
                <div class="flex justify-end gap-1">
                    <UButton
                        icon="i-lucide-history"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Historial de ${row.original.clave}`"
                        @click="verHistorial(row.original)"
                    />
                    <UButton
                        v-if="editableEnLista(row.original) && puede('fiscal.editar_parametros')"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Nuevo valor de ${row.original.clave}`"
                        @click="nuevoValor(row.original)"
                    />
                </div>
            </template>
        </UTable>

        <ParametroHistorial
            ref="historial"
            v-model:open="historialAbierto"
            :clave="claveHistorial"
            @nuevo="nuevoValor"
        />
        <ParametroValorModal
            v-if="puede('fiscal.editar_parametros')"
            v-model:open="valorAbierto"
            :parametro="editando"
            @hecho="alGuardar"
        />
    </div>
</template>
