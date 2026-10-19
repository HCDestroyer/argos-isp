<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Anuncios del portal de la empresa activa (A5, `contratos/anuncios.md`): promociones en el inicio
 * del portal y en la página de corte. Lista con su estado y vigencia; crear (`anuncios.administrar`)
 * abre el formulario con la vista previa y lleva a la ficha, donde se publica, archiva y se ven
 * las métricas.
 */
definePageMeta({ permiso: 'anuncios.ver' })

useHead({ title: 'Anuncios · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
/** Crear usa la empresa activa: con varias y «Todas» elegida, la API responde 422 `empresa_requerida`. */
const { conSelector: variasEmpresas, empresaId, nombre: nombreEmpresa } = useEmpresaActiva()
const sinEmpresa = computed(() => variasEmpresas.value && empresaId.value === null)

const TODOS = 'todos'
const estado = ref<EstadoAnuncio | typeof TODOS>(typeof route.query.estado === 'string' && Object.hasOwn(ESTADOS_ANUNCIO, route.query.estado) ? route.query.estado as EstadoAnuncio : TODOS)
const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...(Object.keys(ESTADOS_ANUNCIO) as EstadoAnuncio[]).map(e => ({ label: ESTADOS_ANUNCIO[e].etiqueta, value: e, icon: ESTADOS_ANUNCIO[e].icono })),
]

const lista = usePaginacionCursor(cursor => useAnuncios().listar(estado.value === TODOS ? {} : { estado: estado.value }, cursor))

const columnas = computed<TableColumn<Anuncio>[]>(() => [
    { accessorKey: 'titulo', header: 'Anuncio', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { accessorKey: 'audiencia', header: 'Audiencia', meta: SOLO_ANCHO },
    ...(variasEmpresas.value ? [{ accessorKey: 'empresa_id', header: 'Empresa', meta: SOLO_ESCRITORIO }] : []),
    { id: 'vigencia', header: 'Vigencia', meta: SOLO_ESCRITORIO },
    { accessorKey: 'orden', header: 'Orden', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right tabular-nums sm:table-cell' } } },
])

const formularioAbierto = ref(false)

async function alCrear(anuncio: Anuncio) {
    toast.add({ title: 'Anuncio creado en borrador', description: `${anuncio.titulo}: agrega la imagen y publícalo cuando esté listo.`, icon: 'i-lucide-circle-check', color: 'success' })
    await navigateTo(`/anuncios/${anuncio.id}`)
}

watch(estado, async (valor) => {
    await router.replace({ query: valor === TODOS ? {} : { estado: valor } })
    await lista.recargar()
})

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="anuncios"
        titulo="Anuncios"
        icono="i-lucide-megaphone"
    >
        <template #acciones>
            <UButton
                v-if="puede('anuncios.administrar')"
                label="Nuevo anuncio"
                icon="i-lucide-plus"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo anuncio"
                :disabled="sinEmpresa"
                data-prueba="nuevo-anuncio"
                @click="formularioAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="max-w-3xl text-sm text-muted">
                Promociones de la empresa en el inicio del portal y en la página de corte. Solo se ven publicadas, dentro de su vigencia y para los clientes de su audiencia.
            </p>
            <UAlert
                v-if="sinEmpresa && puede('anuncios.administrar')"
                color="neutral"
                variant="subtle"
                icon="i-lucide-building-2"
                title="Elige una empresa para crear anuncios"
                description="Cada anuncio es de una empresa: con «Todas» se ven los de todas, pero para crear uno elige la empresa en el selector de arriba."
                data-prueba="anuncio-sin-empresa"
            />
            <USelect
                v-model="estado"
                :items="itemsEstado"
                aria-label="Filtrar por estado"
                class="w-full sm:w-56"
                data-prueba="filtro-estado-anuncio"
            />

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="problemaAnuncioLegible(lista.problema.value)"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-anuncios"
                >
                    <template #titulo-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <ULink
                                :to="`/anuncios/${row.original.id}`"
                                class="flex items-center gap-1.5 text-sm font-medium text-highlighted hover:text-primary"
                            >
                                <UIcon
                                    v-if="row.original.imagen"
                                    name="i-lucide-image"
                                    class="size-4 shrink-0 text-muted"
                                    aria-label="Con imagen"
                                />
                                {{ row.original.titulo }}
                            </ULink>
                            <span
                                v-if="row.original.texto"
                                class="line-clamp-1 text-xs text-muted"
                            >{{ row.original.texto }}</span>
                            <span class="flex flex-wrap gap-1 text-xs text-muted">
                                <span
                                    v-for="lugar in row.original.lugares"
                                    :key="lugar"
                                    class="inline-flex items-center gap-1"
                                >
                                    <UIcon
                                        :name="LUGARES_ANUNCIO[lugar].icono"
                                        class="size-3"
                                    />{{ LUGARES_ANUNCIO[lugar].etiqueta }}
                                </span>
                            </span>
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <div class="flex flex-col items-start gap-1">
                            <UBadge
                                :label="ESTADOS_ANUNCIO[row.original.estado].etiqueta"
                                :icon="ESTADOS_ANUNCIO[row.original.estado].icono"
                                :color="ESTADOS_ANUNCIO[row.original.estado].color"
                                variant="subtle"
                                size="sm"
                                :data-estado="row.original.estado"
                            />
                            <span
                                v-if="row.original.vigente"
                                class="text-xs text-success"
                            >Se ve ahora</span>
                            <span
                                v-else-if="motivoNoVigente(row.original)"
                                class="text-xs text-warning"
                            >{{ motivoNoVigente(row.original) }}</span>
                        </div>
                    </template>
                    <template #audiencia-cell="{ row }">
                        <span class="text-sm">{{ AUDIENCIAS_ANUNCIO[row.original.audiencia].etiqueta }}</span>
                    </template>
                    <template #empresa_id-cell="{ row }">
                        <span class="text-sm">{{ nombreEmpresa(row.original.empresa_id) }}</span>
                    </template>
                    <template #vigencia-cell="{ row }">
                        <span class="text-sm text-muted">{{ vigenciaAnuncio(row.original) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-megaphone"
                            :title="estado === TODOS ? 'Todavía no hay anuncios' : `Sin anuncios en ${ESTADOS_ANUNCIO[estado].etiqueta.toLowerCase()}`"
                            description="Sin anuncios publicados, el portal y la página de corte se ven como siempre."
                            variant="naked"
                        />
                    </template>
                </UTable>

                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <AnuncioFormulario
            v-if="puede('anuncios.administrar')"
            v-model:open="formularioAbierto"
            @guardado="alCrear"
        />
    </PanelPagina>
</template>
