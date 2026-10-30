<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Detalle de un perfil de QoS (`GET /qos/perfiles/:id`, `contratos/qos.md`): sus clases (activas
 * primero, por orden) con prioridad, garantizado, tope y un resumen de reglas; sus advertencias; y
 * los routers que lo usan con el costo contra el límite de hojas. Con `qos.gestionar`: agregar y
 * editar clases (modal), activar y desactivar (resto no se desactiva) y copiar el perfil.
 */
definePageMeta({ permiso: 'qos.ver' })

const route = useRoute()
const perfilId = computed(() => Number(route.params.id))
const { puede } = usePermisos()
const toast = useToast()
const { nombre: nombreEmpresa } = useEmpresaActiva()

const perfil = shallowRef<PerfilQosDetalle | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${perfil.value?.nombre ?? 'Perfil de QoS'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = Number.isInteger(perfilId.value) && perfilId.value > 0 ? await useQos().ver(perfilId.value) : null
    cargando.value = false
    perfil.value = resultado?.ok ? resultado.data : null
    problema.value = resultado && !resultado.ok ? resultado.problema : null
}

onMounted(cargar)

const clases = computed(() => perfil.value?.clases ?? [])
const activas = computed(() => clases.value.filter(c => c.activa))
const sumaGarantizado = computed(() => activas.value.reduce((t, c) => t + c.garantizado_pct, 0))

const columnas: TableColumn<ClaseQos>[] = [
    { accessorKey: 'orden', header: 'Orden', meta: { class: { th: 'w-0', td: 'w-0 tabular-nums' } } },
    { accessorKey: 'nombre', header: 'Clase', meta: { class: { td: 'whitespace-normal min-w-40' } } },
    { accessorKey: 'prioridad', header: 'Prioridad', meta: { class: { th: 'w-0 text-right', td: 'w-0 text-right tabular-nums' } } },
    { accessorKey: 'garantizado_pct', header: 'Garantizado', meta: { class: { th: 'hidden w-0 text-right sm:table-cell', td: 'hidden w-0 text-right tabular-nums sm:table-cell' } } },
    { accessorKey: 'tope_pct', header: 'Tope', meta: { class: { th: 'hidden w-0 text-right sm:table-cell', td: 'hidden w-0 text-right tabular-nums sm:table-cell' } } },
    { id: 'reglas', header: 'Reglas', meta: { class: { th: 'hidden lg:table-cell', td: 'hidden whitespace-normal lg:table-cell' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const usosColumnas: TableColumn<UsoPerfilQos>[] = [
    { accessorKey: 'nombre', header: 'Router' },
    { accessorKey: 'planes_qos', header: 'Planes con QoS', meta: { class: { th: 'w-0 text-right', td: 'w-0 text-right tabular-nums' } } },
    { id: 'costo', header: 'Costo' },
]

/* Clase: alta y edición. */
const claseAbierta = ref(false)
const editando = shallowRef<ClaseQos | null>(null)

function abrirClase(clase: ClaseQos | null) {
    editando.value = clase
    claseAbierta.value = true
}

function alGuardar(clase: ClaseQos, nueva: boolean) {
    toast.add({ title: nueva ? `Clase ${clase.nombre} creada` : `Clase ${clase.nombre} actualizada`, description: 'Los routers que usan el perfil se reconcilian solos.', icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
}

/* Activar y desactivar. */
const estadoAbierto = ref(false)
const aCambiar = shallowRef<ClaseQos | null>(null)
let claveEstado = nuevaClaveIdempotencia()

function pedirCambio(clase: ClaseQos) {
    aCambiar.value = clase
    claveEstado = nuevaClaveIdempotencia()
    estadoAbierto.value = true
}

function cambiarEstado() {
    const clase = aCambiar.value
    if (!clase) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin clase', status: 0 } })
    }
    return useQos().cambiarEstado(clase, !clase.activa, claveEstado)
}

function alCambiar(clase: ClaseQos) {
    toast.add({ title: clase.activa ? `${clase.nombre} activada` : `${clase.nombre} desactivada`, description: 'Los routers que usan el perfil se reconcilian solos.', icon: clase.activa ? 'i-lucide-circle-check' : 'i-lucide-circle-off', color: clase.activa ? 'success' : 'neutral' })
    void cargar()
}

/* Copiar el perfil. */
const copiarAbierto = ref(false)
const perfiles = shallowRef<PerfilQos[]>([])

async function abrirCopiar() {
    const resultado = await useQos().todos()
    perfiles.value = resultado.ok ? resultado.data : perfil.value ? [perfil.value] : []
    copiarAbierto.value = true
}

function alCopiar(nuevo: PerfilQos) {
    toast.add({ title: `Perfil ${nuevo.nombre} creado`, description: `${nuevo.clases.length} clases copiadas.`, icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(`/red/qos/${nuevo.id}`)
}

watch(perfilId, () => void cargar())
</script>

<template>
    <PanelPagina
        id="perfil-qos"
        :titulo="perfil?.nombre ?? 'Perfil de QoS'"
        icono="i-lucide-list-ordered"
    >
        <template #acciones>
            <UButton
                v-if="perfil && puede('qos.gestionar')"
                label="Copiar perfil"
                icon="i-lucide-copy-plus"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Copiar perfil"
                data-prueba="copiar-perfil"
                @click="abrirCopiar"
            />
            <UButton
                to="/red/qos"
                icon="i-lucide-arrow-left"
                label="Perfiles"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <USkeleton
            v-if="cargando && !perfil"
            class="h-40 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-list-ordered"
            title="Perfil no encontrado"
            :description="`No existe un perfil de QoS con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a perfiles', to: '/red/qos', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="perfil"
            class="mx-auto flex w-full max-w-5xl flex-col gap-6"
        >
            <section
                class="surface-card flex flex-col gap-3 p-4 sm:p-6"
                aria-label="Datos del perfil"
            >
                <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                        v-if="perfil.predeterminado"
                        label="Predeterminado"
                        icon="i-lucide-star"
                        color="primary"
                        variant="subtle"
                    />
                    <UBadge
                        :label="perfil.empresa_id === null ? 'Común a todas las empresas' : nombreEmpresa(perfil.empresa_id)"
                        icon="i-lucide-building-2"
                        color="neutral"
                        variant="outline"
                    />
                    <span class="text-xs text-muted">Versión {{ perfil.version }}</span>
                </div>
                <p
                    v-if="perfil.descripcion"
                    class="text-sm text-muted"
                >
                    {{ perfil.descripcion }}
                </p>
                <p class="text-sm">
                    <span class="font-medium text-highlighted tabular-nums">{{ activas.length }}</span> de 8 clases activas ·
                    garantizado <span
                        class="font-medium tabular-nums"
                        :class="sumaGarantizado > 100 ? 'text-error' : 'text-highlighted'"
                        data-prueba="suma-garantizado"
                    >{{ sumaGarantizado }} %</span> de 100 %
                </p>
            </section>

            <QosAyuda />

            <div
                v-if="perfil.advertencias.length"
                class="flex flex-col gap-2"
                data-prueba="advertencias-perfil"
            >
                <UAlert
                    v-for="advertencia in perfil.advertencias"
                    :key="advertencia.regla"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="TITULOS_ADVERTENCIA_QOS[advertencia.regla] ?? 'Advertencia'"
                    :description="advertencia.mensaje"
                    :data-advertencia="advertencia.regla"
                />
            </div>

            <section
                class="flex flex-col gap-3"
                aria-labelledby="titulo-clases"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2
                        id="titulo-clases"
                        class="text-base font-semibold text-highlighted"
                    >
                        Clases
                    </h2>
                    <UButton
                        v-if="puede('qos.gestionar')"
                        label="Nueva clase"
                        icon="i-lucide-plus"
                        size="sm"
                        :disabled="activas.length >= QOS_MAX_CLASES"
                        data-prueba="nueva-clase"
                        @click="abrirClase(null)"
                    />
                </div>
                <UTable
                    :data="clases"
                    :columns="columnas"
                    :loading="cargando"
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-clases"
                >
                    <template #orden-cell="{ row }">
                        <span class="text-muted">{{ row.original.es_resto || esDescargaQos(row.original) ? '—' : row.original.orden }}</span>
                    </template>
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-clase="row.original.nombre"
                        >
                            <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                {{ row.original.nombre }}
                                <UBadge
                                    :label="row.original.activa ? 'Activa' : 'Inactiva'"
                                    :icon="row.original.activa ? 'i-lucide-circle-check' : 'i-lucide-circle-off'"
                                    :color="row.original.activa ? 'success' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                            <span class="flex items-center gap-1 text-xs text-muted">
                                <UIcon
                                    :name="tipoClase(row.original).icono"
                                    class="size-3.5 shrink-0"
                                />
                                {{ tipoClase(row.original).etiqueta }}
                                <span class="sm:hidden">· garantizado {{ row.original.garantizado_pct }} % · tope {{ row.original.tope_pct === null ? '—' : `${row.original.tope_pct} %` }}</span>
                            </span>
                            <span class="text-xs text-muted lg:hidden">{{ resumenReglas(row.original, clases) }}</span>
                        </div>
                    </template>
                    <template #garantizado_pct-cell="{ row }">
                        {{ row.original.garantizado_pct }} %
                    </template>
                    <template #tope_pct-cell="{ row }">
                        {{ row.original.tope_pct === null ? 'Sin tope' : `${row.original.tope_pct} %` }}
                    </template>
                    <template #reglas-cell="{ row }">
                        <span class="text-xs">{{ resumenReglas(row.original, clases) }}</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <div
                            v-if="puede('qos.gestionar')"
                            class="flex justify-end gap-1"
                        >
                            <UButton
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar ${row.original.nombre}`"
                                :data-prueba="`editar-clase-${row.original.id}`"
                                @click="abrirClase(row.original)"
                            />
                            <UButton
                                v-if="!row.original.es_resto"
                                :icon="row.original.activa ? 'i-lucide-circle-off' : 'i-lucide-circle-play'"
                                :color="row.original.activa ? 'warning' : 'success'"
                                variant="ghost"
                                size="sm"
                                :aria-label="row.original.activa ? `Desactivar ${row.original.nombre}` : `Activar ${row.original.nombre}`"
                                :data-prueba="`estado-clase-${row.original.id}`"
                                @click="pedirCambio(row.original)"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-list-ordered"
                            title="El perfil no tiene clases"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <section
                class="flex flex-col gap-3"
                aria-labelledby="titulo-routers-qos"
            >
                <h2
                    id="titulo-routers-qos"
                    class="text-base font-semibold text-highlighted"
                >
                    Routers que lo usan
                </h2>
                <p class="text-sm text-muted">
                    Solo cuestan los planes con el extra «Prioridad por clases (QoS)»: hojas = planes × 2 estados × 2 sentidos × clases activas.
                </p>
                <UTable
                    :data="perfil.routers"
                    :columns="usosColumnas"
                    data-prueba="tabla-routers-qos"
                >
                    <template #nombre-cell="{ row }">
                        <ULink
                            :to="puede('routers.ver') ? `/routers/${row.original.router_id}` : undefined"
                            class="text-sm font-medium text-highlighted"
                        >
                            {{ row.original.nombre }}
                        </ULink>
                    </template>
                    <template #costo-cell="{ row }">
                        <QosCosto :uso="row.original" />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-router"
                            :title="perfil.predeterminado ? 'Ningún router activo' : 'Ningún router usa este perfil'"
                            description="Se elige en la ficha del router, en «Prioridad por clases (QoS)»."
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>
        </div>

        <QosClaseModal
            v-if="perfil && puede('qos.gestionar')"
            v-model:open="claseAbierta"
            :perfil-id="perfil.id"
            :clase="editando"
            :clases="clases"
            @guardado="alGuardar"
            @recargar="cargar"
        />
        <ConfirmacionModal
            v-if="aCambiar && puede('qos.gestionar')"
            v-model:open="estadoAbierto"
            :titulo="aCambiar.activa ? `Desactivar ${aCambiar.nombre}` : `Activar ${aCambiar.nombre}`"
            :efecto="aCambiar.activa ? 'Sus conexiones pasan a la clase que siga en el orden (o a resto). No se borra: puedes volver a activarla.' : 'Vuelve a clasificar conexiones. Se revisa el perfil y el costo en cada router que lo usa.'"
            :confirmar="aCambiar.activa ? 'Desactivar' : 'Activar'"
            :icono="aCambiar.activa ? 'i-lucide-circle-off' : 'i-lucide-circle-play'"
            :color="aCambiar.activa ? 'warning' : 'primary'"
            :ejecutar="cambiarEstado"
            @hecho="alCambiar"
        />
        <QosPerfilModal
            v-if="perfil && puede('qos.gestionar')"
            v-model:open="copiarAbierto"
            :perfiles="perfiles"
            :copiar-de="perfil.id"
            @creado="alCopiar"
        />
    </PanelPagina>
</template>
