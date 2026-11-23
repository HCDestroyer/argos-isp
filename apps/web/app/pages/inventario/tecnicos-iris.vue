<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Inventario · Técnicos de Iris (tablero PendVinculosTecnicos, contrato Iris 0.14.0 §6.6, A3): cómo
 * se vincula cada técnico de Iris con su usuario de Argos para mover su bodega. Llegan solos por
 * webhook; un rechazado se corrige en Argos o en Iris y se «Concilia» (lee el técnico en Iris y
 * aplica las mismas reglas). Solo sirven para inventario: nunca autorizan cobros ni atención.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Técnicos de Iris · Inventario · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { empresaId } = useEmpresaActiva()

const vinculos = shallowRef<VinculoTecnicoIris[]>([])
const cargando = ref(false)
const leidos = ref(false)
const problema = ref<Problem | null>(null)
const busqueda = ref('')
const pestana = ref<EstadoVinculoTecnico>('rechazado')
const conciliando = ref<number | null>(null)
const resultado = ref<{ tono: 'success' | 'warning' | 'error', titulo: string, texto: string } | null>(null)

async function cargar() {
    cargando.value = true
    const r = await useVinculosTecnicos().listar()
    cargando.value = false
    leidos.value = true
    vinculos.value = r.ok ? r.data : []
    problema.value = r.ok ? null : r.problema
}

onMounted(cargar)
watch(empresaId, cargar)

const cuenta = (estado: EstadoVinculoTecnico) => vinculos.value.filter(v => v.estado === estado).length
const pestanas = computed(() => (['rechazado', 'vinculado', 'desvinculado'] as const).map(e => ({
    label: ESTADOS_VINCULO_TECNICO[e].plural,
    value: e,
    icon: ESTADOS_VINCULO_TECNICO[e].icono,
    badge: leidos.value && !problema.value ? { label: String(cuenta(e)), color: e === 'rechazado' && cuenta(e) ? 'error' as const : 'neutral' as const, variant: 'soft' as const } : undefined,
})))

const visibles = computed(() => {
    const termino = normalizarBusqueda(busqueda.value.trim())
    return vinculos.value
        .filter(v => v.estado === pestana.value)
        .filter(v => !termino || normalizarBusqueda(`${v.iris_usuario_id} ${v.id_externo ?? ''} ${v.usuario_nombre ?? ''}`).includes(termino))
})

const columnas: TableColumn<VinculoTecnicoIris>[] = [
    { accessorKey: 'iris_usuario_id', header: 'Técnico en Iris' },
    { accessorKey: 'usuario_nombre', header: 'Usuario de Argos', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado' },
    { accessorKey: 'motivo', header: 'Por qué', meta: SOLO_ESCRITORIO },
    { accessorKey: 'origen', header: 'Origen', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

const motivoDe = (motivo: string | null) => (motivo ? MOTIVOS_VINCULO_TECNICO[motivo] ?? motivo : '—')

async function conciliar(vinculo: VinculoTecnicoIris) {
    conciliando.value = vinculo.id
    resultado.value = null
    const r = await useVinculosTecnicos().conciliar(vinculo)
    conciliando.value = null
    if (!r.ok) {
        resultado.value = { tono: 'error', titulo: 'No se pudo conciliar:', texto: r.problema.detail ?? r.problema.title }
        return
    }
    const c = r.data
    if (c.resultado === 'no_encontrado') {
        resultado.value = { tono: 'warning', titulo: 'Iris no lo encontró:', texto: `${vinculo.iris_usuario_id} ya no existe en Iris. No se cambió nada.` }
    }
    else if (c.resultado === 'error') {
        resultado.value = { tono: 'error', titulo: 'No se pudo leer el técnico en Iris:', texto: `${c.motivo ? MOTIVOS_VERIFICACION[c.motivo] ?? c.motivo : 'Iris respondió con un error'}. No se cambió nada.` }
    }
    else if (c.estado === vinculo.estado) {
        resultado.value = { tono: 'success', titulo: 'Conciliado con Iris:', texto: `${vinculo.iris_usuario_id} sigue ${ESTADOS_VINCULO_TECNICO[vinculo.estado].etiqueta.toLowerCase()}${c.motivo ? ` (${motivoDe(c.motivo).toLowerCase()})` : ''}.` }
    }
    else {
        resultado.value = { tono: 'success', titulo: 'Conciliado con Iris:', texto: `${vinculo.iris_usuario_id} quedó ${c.estado ? ESTADOS_VINCULO_TECNICO[c.estado].etiqueta.toLowerCase() : 'sin cambios'}.` }
        toast.add({ title: 'Vínculo actualizado', icon: 'i-lucide-circle-check', color: 'success' })
    }
    void cargar()
}
</script>

<template>
    <PanelPagina
        id="inventario-tecnicos-iris"
        titulo="Técnicos de Iris"
        icono="i-lucide-link"
        descripcion="Cómo se vincula cada técnico de Iris con su usuario de Argos para mover su bodega"
    >
        <section class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0 lg:flex-1">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:px-4">
                <UTabs
                    v-model="pestana"
                    :items="pestanas"
                    variant="pill"
                    color="neutral"
                    :content="false"
                    class="min-w-0 max-w-full"
                    :ui="{
                        list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                        indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                        trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                        leadingIcon: 'size-4',
                    }"
                    data-prueba="pestanas-vinculos"
                />
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Técnico o usuario…"
                    aria-label="Buscar técnico o usuario"
                    class="w-full sm:w-64"
                    :ui="{ base: 'rounded-full' }"
                />
            </div>
            <div class="flex flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto">
                <UAlert
                    v-if="resultado"
                    :color="resultado.tono"
                    variant="subtle"
                    :icon="resultado.tono === 'success' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                    close
                    data-prueba="resultado-conciliar"
                    @update:open="resultado = null"
                >
                    <template #description>
                        <b>{{ resultado.titulo }}</b> {{ resultado.texto }}
                    </template>
                </UAlert>
                <UAlert
                    color="primary"
                    variant="subtle"
                    icon="i-lucide-info"
                >
                    <template #description>
                        Llegan solos desde Iris. Solo sirven para inventario (bodega del técnico): <b>nunca autorizan cobros ni atención</b>. Si uno quedó rechazado, corrige el usuario en Argos o en Iris y concílialo.
                    </template>
                </UAlert>
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
                    :empty="leidos ? (busqueda ? 'Ningún técnico coincide.' : `No hay técnicos ${ESTADOS_VINCULO_TECNICO[pestana].plural.toLowerCase()}.`) : ''"
                    class="-mx-3 sm:-mx-4"
                >
                    <template #iris_usuario_id-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col"
                            :data-vinculo="row.original.iris_usuario_id"
                        >
                            <span class="font-mono text-sm font-semibold text-highlighted">{{ row.original.iris_usuario_id }}</span>
                            <span
                                v-if="row.original.id_externo"
                                class="text-xs text-muted"
                            >id externo <span class="font-mono">{{ row.original.id_externo }}</span></span>
                            <span class="text-xs text-error lg:hidden">{{ row.original.estado !== 'vinculado' ? motivoDe(row.original.motivo) : '' }}</span>
                        </div>
                    </template>
                    <template #usuario_nombre-cell="{ row }">
                        {{ row.original.usuario_nombre ?? '—' }}
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_VINCULO_TECNICO[row.original.estado].etiqueta"
                            :icon="ESTADOS_VINCULO_TECNICO[row.original.estado].icono"
                            :color="ESTADOS_VINCULO_TECNICO[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #motivo-cell="{ row }">
                        <span :class="row.original.estado === 'rechazado' ? 'text-error' : 'text-muted'">{{ motivoDe(row.original.motivo) }}</span>
                    </template>
                    <template #origen-cell="{ row }">
                        <span class="text-xs text-muted">{{ row.original.origen === 'webhook' ? 'webhook' : 'conciliación' }} · {{ formatearFechaCorta(row.original.updated_at) }} {{ formatearHora(row.original.updated_at) }}</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('inventario.sincronizar_vinculo_tecnico')"
                            label="Conciliar"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :loading="conciliando === row.original.id"
                            :data-conciliar="row.original.iris_usuario_id"
                            @click="conciliar(row.original)"
                        />
                    </template>
                </UTable>
            </div>
        </section>
    </PanelPagina>
</template>
