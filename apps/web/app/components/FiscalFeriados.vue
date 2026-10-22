<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Feriados de un año (`GET /fiscal/feriados?anio=`, `fiscal.ver`): días inhábiles para los plazos
 * fiscales de toda la instalación, además de sábados y domingos. La tabla arranca vacía: cada feriado
 * lo confirma el contador. Agregar o retirar (`fiscal.configurar`, alcance global) recalcula el
 * calendario fiscal de todas las empresas.
 */
const { puede } = usePermisos()
const { alcanceGlobal } = useEmpresaActiva()
const toast = useToast()

const anioActual = Number(hoyGuatemala().slice(0, 4))
const anio = ref(anioActual)
const itemsAnio = [anioActual - 1, anioActual, anioActual + 1].map(a => ({ label: String(a), value: a }))

const datos = shallowRef<FeriadosFiscales | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const abierto = ref(false)
const retirando = shallowRef<FeriadoFiscal | null>(null)

const puedeEditar = computed(() => puede('fiscal.configurar') && alcanceGlobal.value)

const columnas: TableColumn<FeriadoFiscal>[] = [
    { accessorKey: 'fecha', header: 'Fecha' },
    { accessorKey: 'nombre', header: 'Feriado', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'origen', header: 'Origen', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]
const columnasHistorial: TableColumn<FeriadoFiscal>[] = [
    { accessorKey: 'fecha', header: 'Fecha' },
    { accessorKey: 'activo', header: 'Cambio' },
    { accessorKey: 'motivo', header: 'Motivo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'created_at', header: 'Registrado', meta: SOLO_ANCHO },
]

async function cargar() {
    // La pestaña ya exige `fiscal.ver`; la guardia deja explícito el permiso de la lectura.
    if (!puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    const resultado = await useFeriadosFiscales().listar(anio.value)
    cargando.value = false
    datos.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : problemaCalendarioLegible(resultado.problema)
}

function agregar() {
    retirando.value = null
    abierto.value = true
}

function retirar(feriado: FeriadoFiscal) {
    retirando.value = feriado
    abierto.value = true
}

function alTerminar(feriado: FeriadoAgregado) {
    const { calendario } = feriado
    const errores = calendario.errores.length ? ` · ${calendario.errores.length} con error (se reintenta en la próxima corrida)` : ''
    toast.add({
        title: feriado.activo ? 'Feriado agregado' : 'Feriado retirado',
        description: `${feriado.nombre} · ${formatearFecha(feriado.fecha)}. Calendario recalculado en ${calendario.empresas} ${calendario.empresas === 1 ? 'empresa' : 'empresas'}: ${calendario.actualizadas} ${calendario.actualizadas === 1 ? 'vencimiento movido' : 'vencimientos movidos'}${errores}.`,
        icon: 'i-lucide-flag',
        color: calendario.errores.length ? 'warning' : 'success',
    })
    void cargar()
}

watch(anio, cargar)
onMounted(cargar)
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="fiscal-feriados"
    >
        <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-user-check"
            title="Confirmar con contador"
            description="Los feriados no vienen precargados: sin filas, solo sábados y domingos son inhábiles. Agregue cada feriado que el contador confirme (asuetos oficiales y los que declare el Ejecutivo). Valen para todas las empresas."
            data-prueba="feriados-confirmar-contador"
        />

        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <UFormField
                label="Año"
                class="sm:w-36"
            >
                <USelect
                    v-model="anio"
                    :items="itemsAnio"
                    class="w-full"
                    data-prueba="feriados-anio"
                />
            </UFormField>
            <div
                v-if="puede('fiscal.configurar')"
                class="flex flex-col items-start gap-1 sm:items-end"
            >
                <UButton
                    label="Agregar feriado"
                    icon="i-lucide-plus"
                    :disabled="!puedeEditar"
                    data-prueba="abrir-feriado"
                    @click="agregar"
                />
                <span
                    v-if="!alcanceGlobal"
                    class="text-xs text-muted"
                    data-prueba="feriados-sin-alcance"
                >Los feriados son de toda la instalación: hace falta alcance global.</span>
            </div>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <template v-else>
            <UTable
                :data="datos?.vigentes ?? []"
                :columns="columnas"
                :loading="cargando"
                data-prueba="tabla-feriados"
            >
                <template #fecha-cell="{ row }">
                    <div
                        class="flex flex-col"
                        :data-feriado="row.original.fecha"
                    >
                        <span class="text-sm tabular-nums text-highlighted">{{ formatearFecha(row.original.fecha) }}</span>
                        <span class="text-xs capitalize text-muted">{{ diaSemana(row.original.fecha) }}</span>
                    </div>
                </template>
                <template #nombre-cell="{ row }">
                    <div class="flex min-w-0 flex-col">
                        <span class="text-sm text-highlighted">{{ row.original.nombre }}</span>
                        <span class="text-xs text-muted">{{ row.original.motivo }}</span>
                    </div>
                </template>
                <template #origen-cell="{ row }">
                    <UBadge
                        :label="row.original.origen === 'paquete' ? 'Paquete' : 'Usuario'"
                        :color="row.original.origen === 'paquete' ? 'info' : 'neutral'"
                        variant="subtle"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puedeEditar"
                        icon="i-lucide-flag-off"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Retirar feriado del ${formatearFecha(row.original.fecha)}`"
                        @click="retirar(row.original)"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-flag"
                        :title="datos ? `Sin feriados en ${datos.anio}` : 'Sin feriados'"
                        description="Solo sábados y domingos corren los vencimientos al siguiente día hábil."
                        variant="naked"
                    />
                </template>
            </UTable>

            <UPageCard
                v-if="datos && datos.historial.length"
                title="Historial de altas y retiros"
                variant="subtle"
            >
                <UTable
                    :data="datos.historial"
                    :columns="columnasHistorial"
                    data-prueba="tabla-feriados-historial"
                >
                    <template #fecha-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm tabular-nums">{{ formatearFecha(row.original.fecha) }}</span>
                            <span class="text-xs text-muted">{{ row.original.nombre }}</span>
                        </div>
                    </template>
                    <template #activo-cell="{ row }">
                        <UBadge
                            :label="row.original.activo ? 'Agregado' : 'Retirado'"
                            :color="row.original.activo ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #motivo-cell="{ row }">
                        <span class="text-xs text-muted">{{ row.original.motivo }}</span>
                    </template>
                    <template #created_at-cell="{ row }">
                        <span class="text-xs text-muted">{{ formatearFechaHora(row.original.created_at) }}</span>
                    </template>
                </UTable>
            </UPageCard>
        </template>

        <FeriadoModal
            v-if="puedeEditar"
            v-model:open="abierto"
            :retirar="retirando"
            :anio="anio"
            @hecho="alTerminar"
        />
    </div>
</template>
