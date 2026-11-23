<script setup lang="ts">
/**
 * Índice de la configuración (tablero Configuracion, con el submenú de secciones de los tableros
 * OperConfig*): las secciones del grupo «Configuración» del menú por categoría (subgrupos de
 * `navegacion.ts`), con buscador. Cada tarjeta respeta el permiso de su página; una categoría sin
 * nada permitido no aparece. Las pastillas («2 empresas», «Contingencia activa», «3 plantillas»)
 * salen de la API y solo aparecen si se pudieron leer.
 */
definePageMeta({ permiso: ['empresas.ver', 'fiscal.ver', 'fel.ver', 'empresa.ver', 'plantillas.ver', 'documentos.ver', 'cuentas_bancarias.ver', 'bancos.ver', 'campos_personalizados.editar', 'portal_corte.ver', 'nodos_portal.administrar', 'inventario.configurar', 'usuarios.ver', 'roles.ver', 'tokens.ver', 'notificaciones.ver', 'horus.ver', 'iris.ver', 'sistema.ver_salud', 'sistema.ver_registro', 'sistema.ver_almacenamiento', 'apariencia.ver'] })

useHead({ title: 'Configuración · ArgosIsp' })

const { puede } = usePermisos()
const { empresaId } = useEmpresaActiva()
const busqueda = ref('')

/** Descripciones cortas del tablero por categoría. */
const FRASES: Record<string, string> = {
    'config-empresa': 'Quién factura y cómo',
    'config-cobro': 'Cuándo se factura, cuándo se corta y cómo se cobra',
    'config-red': 'Qué ve el cliente cortado y cómo se sostiene la red',
    'config-acceso': 'Quién entra y qué puede hacer',
    'config-sistema': 'Cómo está el servidor y cómo se ve Argos',
    'config-avisos': 'Avisos al cliente y sistemas conectados',
}

/** Tono de la pastilla del icono por sección (tablero Configuracion). */
const TONOS: Record<string, string> = {
    'fel': 'tono-aviso',
    'plantillas': 'tono-1',
    'aviso-cobro': 'tono-1',
    'cuentas-bancarias': 'tono-1',
    'proveedores-cobro': 'tono-1',
    'portal-corte': 'tono-error',
    'notificaciones': 'tono-1',
    'notificaciones-plantillas': 'tono-1',
    'integracion-iris': 'tono-exito',
    'integraciones': 'tono-exito',
}

const pastillas = reactive<Record<string, { texto: string, color: 'neutral' | 'warning' }>>({})

async function cargarPastillas() {
    const tareas: Promise<void>[] = []
    if (puede('empresas.ver')) {
        tareas.push(useEmpresas().listar(true).then((r) => {
            if (r.ok) {
                pastillas.empresas = { texto: r.data.length === 1 ? '1 empresa' : `${r.data.length} empresas`, color: 'neutral' }
            }
        }))
    }
    if (puede('plantillas.ver')) {
        tareas.push(usePlantillas().listar().then((r) => {
            if (r.ok) {
                pastillas.plantillas = { texto: r.data.length === 1 ? '1 plantilla' : `${r.data.length} plantillas`, color: 'neutral' }
            }
        }))
    }
    if (puede('fel.ver') && empresaId.value !== null) {
        tareas.push(useFel().configuracion(empresaId.value).then((r) => {
            if (r.ok && r.data.contingencia_activa) {
                pastillas.fel = { texto: 'Contingencia activa', color: 'warning' }
            }
        }))
    }
    await Promise.all(tareas)
}

onMounted(() => void cargarPastillas())

const categorias = computed(() => {
    const grupo = GRUPOS_PANEL.find(g => g.id === 'configuracion')
    const termino = normalizarBusqueda(busqueda.value.trim())
    return (grupo?.subgrupos ?? [])
        .map(subgrupo => ({
            ...subgrupo,
            frase: FRASES[subgrupo.id] ?? subgrupo.descripcion,
            secciones: subgrupo.secciones
                .filter(seccion => puede(seccion.permiso))
                .filter(seccion => !termino || normalizarBusqueda(`${seccion.etiqueta} ${seccion.descripcion} ${subgrupo.etiqueta}`).includes(termino)),
        }))
        .filter(subgrupo => subgrupo.secciones.length > 0)
})
</script>

<template>
    <ConfiguracionMarco
        id="configuracion"
        titulo="Configuración"
        descripcion="Todo lo que se ajusta una vez y casi no se toca, ordenado por tema."
        sin-tarjeta
        indice
    >
        <template #acciones>
            <UInput
                v-model="busqueda"
                icon="i-lucide-search"
                placeholder="Buscar: FEL, plantillas, roles…"
                aria-label="Buscar en la configuración"
                class="w-full sm:w-72"
                data-prueba="buscar-configuracion"
            />
        </template>

        <div class="flex min-w-0 flex-col gap-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pe-1">
            <section
                v-for="categoria in categorias"
                :key="categoria.id"
                class="flex flex-col gap-3"
                :aria-labelledby="`titulo-${categoria.id}`"
                :data-prueba="`categoria-${categoria.id}`"
            >
                <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h2
                        :id="`titulo-${categoria.id}`"
                        class="text-xs font-bold tracking-[0.06em] text-highlighted uppercase"
                    >
                        {{ categoria.etiqueta }}
                    </h2>
                    <p class="text-xs text-muted">
                        {{ categoria.frase }}
                    </p>
                </div>
                <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    <ULink
                        v-for="seccion in categoria.secciones"
                        :key="seccion.id"
                        :to="seccion.ruta"
                        class="tarjeta-interactiva flex items-start gap-3 surface-card rounded-2xl p-4"
                        :data-tarjeta-config="seccion.id"
                    >
                        <span
                            class="pastilla-icono pastilla-tono"
                            :class="TONOS[seccion.id] ?? 'tono-marca'"
                        >
                            <UIcon
                                :name="seccion.icono"
                                class="size-5"
                            />
                        </span>
                        <span class="flex min-w-0 flex-col gap-1">
                            <span class="text-sm font-semibold text-highlighted">{{ seccion.etiqueta }}</span>
                            <span class="line-clamp-2 text-xs text-muted">{{ seccion.descripcion }}</span>
                            <UBadge
                                v-if="pastillas[seccion.id]"
                                :label="pastillas[seccion.id]?.texto"
                                :color="pastillas[seccion.id]?.color"
                                variant="subtle"
                                size="sm"
                                class="self-start"
                            />
                        </span>
                    </ULink>
                </div>
            </section>

            <UEmpty
                v-if="!categorias.length"
                icon="i-lucide-search-x"
                title="Nada coincide con la búsqueda"
                description="Prueba con otra palabra: «correo», «FEL», «roles», «portal»…"
                :actions="[{ label: 'Borrar búsqueda', icon: 'i-lucide-x', color: 'neutral', variant: 'subtle', onClick: () => { busqueda = '' } }]"
                variant="naked"
            />
        </div>
    </ConfiguracionMarco>
</template>
