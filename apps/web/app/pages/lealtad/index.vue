<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Programa de lealtad de la empresa activa (A3, `contratos/lealtad.md` §15.1): ver, crear, editar,
 * activar y desactivar con motivo (`lealtad.configurar`), y sus reglas para ganar puntos.
 */
definePageMeta({ permiso: 'lealtad.ver' })

useHead({ title: 'Lealtad · ArgosIsp' })

const toast = useToast()
const { puede, enlace } = usePermisos()

const programa = shallowRef<ProgramaLealtad | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const problemaActivar = ref<Problem | null>(null)
const activando = ref(false)

const editandoPrograma = ref(false)
const desactivando = ref(false)

const reglas = usePaginacionCursor(cursor => (programa.value ? useReglasLealtad().listar({ programa_id: programa.value.id }, cursor) : Promise.resolve({ ok: true as const, data: { data: [], nextCursor: null } })))
const reglaEditada = shallowRef<ReglaLealtad | null>(null)
const reglaAbierta = ref(false)

const columnas: TableColumn<ReglaLealtad>[] = [
    { accessorKey: 'tipo', header: 'Regla' },
    { accessorKey: 'puntos', header: 'Puntos', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'activa', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

async function cargar() {
    cargando.value = true
    const resultado = await useProgramasLealtad().actual()
    cargando.value = false
    programa.value = resultado.ok ? resultado.data.programa : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok && resultado.data.programa) {
        void reglas.recargar()
    }
}

async function activar() {
    if (!programa.value) {
        return
    }
    activando.value = true
    problemaActivar.value = null
    const resultado = await useProgramasLealtad().activar(programa.value.id, nuevaClaveIdempotencia())
    activando.value = false
    if (!resultado.ok) {
        problemaActivar.value = resultado.problema
        return
    }
    programa.value = resultado.data
    toast.add({ title: 'Programa activado', description: `${resultado.data.nombre}: los clientes empiezan a ganar puntos desde hoy.`, icon: 'i-lucide-circle-check', color: 'success' })
}

function desactivar(motivo: string, clave: string) {
    if (!programa.value) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin programa', status: 0 } })
    }
    return useProgramasLealtad().desactivar(programa.value.id, motivo, clave)
}

function alDesactivar(actual: ProgramaLealtad) {
    programa.value = actual
    toast.add({ title: 'Programa desactivado', description: 'Los puntos ganados se conservan; no se otorgan nuevos.', icon: 'i-lucide-circle-pause', color: 'neutral' })
}

function alGuardarPrograma(actual: ProgramaLealtad) {
    const nuevo = programa.value === null
    programa.value = actual
    toast.add({ title: nuevo ? 'Programa creado' : 'Programa actualizado', description: nuevo ? 'Queda inactivo hasta que lo actives.' : actual.nombre, icon: 'i-lucide-circle-check', color: 'success' })
    void reglas.recargar()
}

function abrirRegla(regla: ReglaLealtad | null) {
    reglaEditada.value = regla
    reglaAbierta.value = true
}

function alGuardarRegla(regla: ReglaLealtad) {
    toast.add({ title: reglaEditada.value ? 'Regla actualizada' : 'Regla creada', description: `${TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta} · ${formatearPuntos(regla.puntos)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void reglas.recargar()
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="lealtad"
        titulo="Lealtad"
        icono="i-lucide-gem"
    >
        <template #acciones>
            <UButton
                :to="enlace('/lealtad/referidos')"
                label="Referidos"
                icon="i-lucide-user-plus"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Referidos"
            />
        </template>

        <div class="flex flex-col gap-6">
            <USkeleton
                v-if="cargando && !programa"
                class="h-40 w-full"
            />
            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="programa-error-carga"
            />
            <UEmpty
                v-else-if="!programa"
                icon="i-lucide-gem"
                title="Esta empresa no tiene programa de lealtad"
                description="Los clientes ganan puntos por pagar a tiempo, su antigüedad, referir clientes o pagar por adelantado."
                :actions="puede('lealtad.configurar') ? [{ label: 'Crear programa', icon: 'i-lucide-plus', onClick: () => { editandoPrograma = true } }] : []"
                data-prueba="sin-programa"
            />
            <template v-else>
                <UPageCard
                    variant="subtle"
                    data-prueba="programa"
                >
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div class="flex flex-col gap-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <h2 class="text-lg font-semibold text-highlighted">
                                        {{ programa.nombre }}
                                    </h2>
                                    <UBadge
                                        :label="programa.activo ? 'Activo' : 'Inactivo'"
                                        :color="programa.activo ? 'success' : 'neutral'"
                                        :icon="programa.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                                        variant="subtle"
                                        data-prueba="estado-programa"
                                    />
                                </div>
                                <p class="text-sm text-muted">
                                    Vigente desde {{ formatearFecha(programa.vigente_desde) }}{{ programa.vigente_hasta ? ` hasta ${formatearFecha(programa.vigente_hasta)}` : '' }} · versión {{ programa.version }}
                                </p>
                            </div>
                            <div
                                v-if="puede('lealtad.configurar')"
                                class="flex flex-wrap gap-2"
                            >
                                <UButton
                                    label="Editar"
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="outline"
                                    @click="editandoPrograma = true"
                                />
                                <UButton
                                    v-if="programa.activo"
                                    label="Desactivar"
                                    icon="i-lucide-circle-pause"
                                    color="error"
                                    variant="outline"
                                    data-prueba="desactivar-programa"
                                    @click="desactivando = true"
                                />
                                <UButton
                                    v-else
                                    label="Activar"
                                    icon="i-lucide-circle-play"
                                    :loading="activando"
                                    data-prueba="activar-programa"
                                    @click="activar"
                                />
                            </div>
                        </div>
                        <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                            <DatoFicha
                                etiqueta="Valor del punto"
                                :valor="formatearQuetzales(programa.valor_punto)"
                            />
                            <DatoFicha
                                etiqueta="Diferimiento (NIIF 15)"
                                :valor="programa.diferimiento ? `Sí · pasivo Q ${programa.valor_pasivo_punto} por punto` : 'No: solo indicador'"
                            />
                            <DatoFicha
                                etiqueta="Canje esperado"
                                :valor="`${programa.canje_esperado_pct} %`"
                            />
                            <DatoFicha
                                etiqueta="Vencimiento"
                                :valor="programa.vencimiento_meses ? `${programa.vencimiento_meses} meses · aviso ${programa.aviso_vencimiento_dias} días antes` : 'No vencen'"
                            />
                            <DatoFicha
                                etiqueta="Mínimo para canjear"
                                :valor="formatearPuntos(programa.minimo_canje)"
                            />
                            <DatoFicha
                                etiqueta="Términos"
                                :valor="programa.terminos || 'Sin términos publicados'"
                                class="col-span-2 whitespace-pre-line lg:col-span-3"
                            />
                        </dl>
                        <ProblemaAlerta
                            v-if="problemaActivar"
                            :problema="problemaActivar"
                            data-prueba="activar-error"
                        />
                    </div>
                </UPageCard>

                <section class="flex flex-col gap-2">
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Reglas para ganar puntos
                        </h3>
                        <UButton
                            v-if="puede('lealtad.configurar')"
                            label="Nueva regla"
                            icon="i-lucide-plus"
                            size="sm"
                            data-prueba="nueva-regla"
                            @click="abrirRegla(null)"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="reglas.problema.value"
                        :problema="reglas.problema.value"
                        :reintentar="reglas.recargar"
                        :reintentando="reglas.cargando.value"
                    />
                    <template v-else>
                        <UTable
                            :data="reglas.filas.value"
                            :columns="columnas"
                            :loading="reglas.cargando.value"
                            data-prueba="tabla-reglas-lealtad"
                        >
                            <template #tipo-cell="{ row }">
                                <div class="flex min-w-0 items-start gap-2 whitespace-normal">
                                    <UIcon
                                        :name="TIPOS_REGLA_LEALTAD[row.original.tipo].icono"
                                        class="mt-0.5 size-4 shrink-0 text-muted"
                                    />
                                    <div class="flex min-w-0 flex-col">
                                        <span class="text-sm font-medium text-highlighted">{{ TIPOS_REGLA_LEALTAD[row.original.tipo].etiqueta }}</span>
                                        <span class="text-xs text-muted">{{ resumenCondiciones(row.original) }}</span>
                                        <span
                                            v-if="row.original.tope_por_cliente"
                                            class="text-xs text-muted"
                                        >Tope {{ row.original.tope_por_cliente }} por {{ row.original.periodo_tope === 'anio' ? 'año' : 'mes' }}</span>
                                        <span class="text-xs text-muted">Desde {{ formatearFecha(row.original.vigente_desde) }}{{ row.original.vigente_hasta ? ` hasta ${formatearFecha(row.original.vigente_hasta)}` : '' }}</span>
                                    </div>
                                </div>
                            </template>
                            <template #puntos-cell="{ row }">
                                <div class="flex flex-col items-end">
                                    <span class="tabular-nums font-medium text-highlighted">{{ formatearPuntos(row.original.puntos) }}</span>
                                    <span class="text-xs text-muted tabular-nums">{{ formatearQuetzales(new Decimal(programa.valor_punto).times(row.original.puntos)) }}</span>
                                </div>
                            </template>
                            <template #activa-cell="{ row }">
                                <UBadge
                                    :label="row.original.activa ? 'Activa' : 'Inactiva'"
                                    :color="row.original.activa ? 'success' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                />
                            </template>
                            <template #acciones-cell="{ row }">
                                <UButton
                                    v-if="puede('lealtad.configurar')"
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="`Editar la regla ${TIPOS_REGLA_LEALTAD[row.original.tipo].etiqueta}`"
                                    @click="abrirRegla(row.original)"
                                />
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-list-plus"
                                    title="Sin reglas"
                                    description="Sin reglas activas nadie gana puntos aunque el programa esté activo."
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <PaginacionCursor
                            :pagina="reglas.pagina.value"
                            :hay-anterior="reglas.hayAnterior.value"
                            :hay-siguiente="reglas.haySiguiente.value"
                            :cargando="reglas.cargando.value"
                            :filas="reglas.filas.value.length"
                            @anterior="reglas.anterior"
                            @siguiente="reglas.siguiente"
                        />
                    </template>
                </section>
            </template>
        </div>

        <ProgramaLealtadModal
            v-if="puede('lealtad.configurar')"
            v-model:open="editandoPrograma"
            :programa="programa"
            @hecho="alGuardarPrograma"
        />
        <ReglaLealtadModal
            v-if="programa && puede('lealtad.configurar')"
            v-model:open="reglaAbierta"
            :programa="programa"
            :regla="reglaEditada"
            @hecho="alGuardarRegla"
        />
        <AccionMotivoModal
            v-model:open="desactivando"
            titulo="Desactivar programa"
            :descripcion="programa?.nombre"
            efecto="Los clientes dejan de ganar puntos desde hoy. Los puntos ganados se conservan y los reversos siguen aplicándose."
            confirmar="Desactivar"
            icono="i-lucide-circle-pause"
            placeholder="Ej.: se rediseña el programa para el próximo año"
            :ejecutar="desactivar"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
