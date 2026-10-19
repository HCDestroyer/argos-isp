<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha del sorteo (A3, `contratos/lealtad.md` §7, §8 y §15.3): su paso, la acción que toca (publicar
 * bases, abrir la participación, cerrar el corte, ejecutar con el valor público, entregar premios o
 * cancelar), los premios con imagen y tipo, el checklist legal con evidencia y, ya ejecutado, el
 * resultado con su verificación pública. Cada acción es su endpoint con su permiso `sorteos.*`.
 */
definePageMeta({ permiso: 'sorteos.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const sorteoId = computed(() => Number(route.params.id))
const sorteo = shallowRef<SorteoDetalle | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
/** Error de la última acción (409, 422 `bases_incompletas`, `requisito_pendiente`…), legible. */
const problemaAccion = ref<Problem | null>(null)
const catalogo = shallowRef<PremioLealtad[]>([])

useHead(() => ({ title: `${sorteo.value?.nombre ?? `Sorteo #${route.params.id}`} · ArgosIsp` }))

const editando = ref(false)
const publicando = ref(false)
const abriendo = ref(false)
const cerrandoCorte = ref(false)
const ejecutando = ref(false)
const cancelando = ref(false)
const requisitoAMarcar = shallowRef<RequisitoSorteo | null>(null)
const marcando = computed({
    get: () => requisitoAMarcar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            requisitoAMarcar.value = null
        }
    },
})
const ganadorAEntregar = shallowRef<GanadorSorteo | null>(null)
const entregando = computed({
    get: () => ganadorAEntregar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            ganadorAEntregar.value = null
        }
    },
})
const ganadorAAnular = shallowRef<GanadorSorteo | null>(null)
const anulandoEntrega = computed({
    get: () => ganadorAAnular.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            ganadorAAnular.value = null
        }
    },
})
const nombres = useNombresClientes()
let claveAccion = nuevaClaveIdempotencia()

const estado = computed(() => sorteo.value?.estado ?? 'borrador')
const acciones = computed(() => accionesSorteo(estado.value))
const puedeEditar = computed(() => puede('sorteos.gestionar') && acciones.value.includes('editar'))
const puedePublicar = computed(() => puede('sorteos.publicar') && acciones.value.includes('publicar_bases'))
const puedeAbrir = computed(() => puede('sorteos.publicar') && acciones.value.includes('abrir'))
const puedeCerrarCorte = computed(() => puede('sorteos.publicar') && acciones.value.includes('cerrar_corte'))
const puedeEjecutar = computed(() => puede('sorteos.ejecutar') && acciones.value.includes('ejecutar'))
const puedeCancelar = computed(() => puede('sorteos.publicar') && acciones.value.includes('cancelar'))
const puedeMarcar = computed(() => puede('sorteos.marcar_requisito') && estado.value !== 'cancelado')
const puedeEntregar = computed(() => puede('sorteos.entregar') && (estado.value === 'ejecutado' || estado.value === 'acta_cerrada'))
const puedeAnularEntrega = computed(() => puede('sorteos.entregar') && ESTADOS_CON_RESULTADO.includes(estado.value))
const ejecutado = computed(() => ESTADOS_CON_RESULTADO.includes(estado.value))
const puedeSubirImagen = computed(() => puede('sorteos.gestionar') && estado.value === 'borrador')
const puedeCambiarAviso = computed(() => puede('sorteos.gestionar') && ESTADOS_AVISO_PORTAL.includes(estado.value))

/* Imagen de un premio (solo en borrador). */
const premioImagen = shallowRef<PremioSorteo | null>(null)
const subiendoImagen = computed({
    get: () => premioImagen.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            premioImagen.value = null
        }
    },
})

/* Aviso en el portal: interruptor con `version`; con 409 se recarga y se avisa. */
const cambiandoAviso = ref(false)
const problemaAviso = ref<Problem | null>(null)

async function cambiarAviso(valor: boolean) {
    if (!sorteo.value) {
        return
    }
    cambiandoAviso.value = true
    problemaAviso.value = null
    const resultado = await useSorteos().cambiarAvisoPortal(sorteo.value.id, sorteo.value.version, valor)
    cambiandoAviso.value = false
    if (resultado.ok) {
        alAvanzar(resultado.data, valor ? 'El sorteo se anuncia en el portal' : 'El sorteo ya no se anuncia en el portal')
        return
    }
    problemaAviso.value = resultado.problema
    if (resultado.problema.status === 409) {
        void cargar()
    }
}

/** Lo que falta del checklist para el siguiente paso (abrir o ejecutar). */
const faltantes = computed<RequisitoSorteo['clave'][]>(() => {
    if (!sorteo.value) {
        return []
    }
    if (estado.value === 'bases_publicadas') {
        return requisitosFaltantes(sorteo.value.requisitos, 'abrir')
    }
    if (estado.value === 'participacion_abierta' || estado.value === 'corte_cerrado') {
        return requisitosFaltantes(sorteo.value.requisitos, 'ejecutar')
    }
    return []
})
const corteFuturo = computed(() => estado.value === 'participacion_abierta' && !!sorteo.value?.corte_en && new Date(sorteo.value.corte_en).getTime() > Date.now())
const premioAAnular = computed(() => (sorteo.value && ganadorAAnular.value ? premioDeGanador(sorteo.value, ganadorAAnular.value) : null))
const premioAEntregar = computed(() => (sorteo.value && ganadorAEntregar.value ? premioDeGanador(sorteo.value, ganadorAEntregar.value) : null))

function nombreCatalogo(premio: PremioSorteo): string | null {
    return premio.premio_id === null ? null : catalogo.value.find(p => p.id === premio.premio_id)?.nombre ?? `Premio #${premio.premio_id} del catálogo`
}

async function cargar() {
    cargando.value = true
    const resultado = await useSorteos().ver(sorteoId.value)
    cargando.value = false
    if (resultado.ok) {
        sorteo.value = resultado.data
        problema.value = null
    }
    else {
        sorteo.value = null
        problema.value = resultado.problema
    }
}

async function cargarCatalogo() {
    if (!puede('lealtad.ver')) {
        return
    }
    const resultado = await usePremiosLealtad().listar()
    catalogo.value = resultado.ok ? resultado.data.data : []
}

/** Una clave por apertura: reintentar tras un corte de red no repite el paso. */
function abrirConfirmacion(cual: 'publicar' | 'abrir' | 'cerrar') {
    claveAccion = nuevaClaveIdempotencia()
    problemaAccion.value = null
    const banderas = { publicar: publicando, abrir: abriendo, cerrar: cerrandoCorte }
    banderas[cual].value = true
}

/** El error del paso, legible (`requisito_pendiente` con el nombre del requisito, `bases_incompletas`…). */
async function legible(llamada: Promise<Resultado<SorteoDetalle>>): Promise<Resultado<SorteoDetalle>> {
    const resultado = await llamada
    return resultado.ok ? resultado : { ok: false, problema: problemaSorteoLegible(resultado.problema) }
}

const publicarBases = () => legible(useSorteos().publicarBases(sorteoId.value, claveAccion))
const abrirParticipacion = () => legible(useSorteos().abrir(sorteoId.value, claveAccion))
const cerrarCorte = () => legible(useSorteos().cerrarCorte(sorteoId.value, claveAccion))

function cancelar(motivo: string, clave: string) {
    return useSorteos().cancelar(sorteoId.value, motivo, clave)
}

/* Segunda PR (A3, `a3/sorteos-2`): acta, notificación, no reclamado y exportación. */
const cerrandoActa = ref(false)
const notificando = ref(false)
const ganadorNoReclamado = shallowRef<GanadorSorteo | null>(null)
const marcandoNoReclamado = computed({
    get: () => ganadorNoReclamado.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            ganadorNoReclamado.value = null
        }
    },
})
const descargandoActa = ref(false)
const exportando = ref<'csv' | 'xlsx' | null>(null)

const puedeCerrarActa = computed(() => puede('sorteos.ejecutar') && estado.value === 'ejecutado')
const puedeNoReclamado = computed(() => puede('sorteos.entregar') && (estado.value === 'ejecutado' || estado.value === 'acta_cerrada'))
const porNotificar = computed(() => (sorteo.value ? ganadoresPorNotificar(sorteo.value.ganadores) : []))
const puedeNotificar = computed(() => puedeNoReclamado.value && porNotificar.value.length > 0)
const puedeExportar = computed(() => puede('sorteos.exportar') && !!sorteo.value?.lista_hash)
/** Cerrar el acta exige la publicación de los resultados marcada (422 `requisito_pendiente`). */
const faltaPublicacion = computed(() => (sorteo.value?.requisitos.find(r => r.clave === 'publicacion_resultados')?.estado ?? 'pendiente') === 'pendiente')
/** Quién toma el premio si el ganador no lo reclama: el primer suplente en espera, como la API. */
const suplenteSiguiente = computed(() => (sorteo.value?.ganadores ?? [])
    .filter(g => g.tipo === 'suplente' && premioDeGanador(sorteo.value ?? { premios: [] }, g) === null && g.estado === 'por_notificar')
    .sort((a, b) => a.posicion - b.posicion)[0] ?? null)

function cerrarActa(constancia: string, clave: string) {
    return useSorteos().cerrarActa(sorteoId.value, constancia, clave)
}

function notificar() {
    return useSorteos().notificarGanadores(sorteoId.value, nuevaClaveIdempotencia())
}

/** El modal se cierra (y suelta al ganador) antes de `hecho`: el id se guarda al confirmar. */
let idNoReclamado: number | null = null

function marcarNoReclamado(motivo: string, clave: string) {
    const ganador = ganadorNoReclamado.value
    idNoReclamado = ganador?.id ?? null
    return ganador
        ? useSorteos().noReclamado(sorteoId.value, ganador.id, motivo, clave)
        : Promise.resolve<Resultado<SorteoDetalle>>({ ok: false, problema: { type: 'about:blank', title: 'Sin ganador', status: 0 } })
}

function alNoReclamado(nuevo: SorteoDetalle) {
    const sustituto = idNoReclamado === null ? undefined : nuevo.ganadores.find(g => g.sustituye_a === idNoReclamado)
    alAvanzar(nuevo, 'Premio no reclamado', sustituto ? `Pasó al suplente ${sustituto.posicion}.º, que ya se notificó.` : 'Sin suplentes en espera: el premio sigue lo que dicen las bases.')
}

async function descargarActa() {
    if (!puede('sorteos.ver') || !sorteo.value || descargandoActa.value) {
        return
    }
    descargandoActa.value = true
    const resultado = await useSorteos().acta(sorteo.value.id)
    descargandoActa.value = false
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo descargar el acta', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    guardarBlob(resultado.data, `acta-sorteo-${sorteo.value.id}.pdf`)
}

async function exportar(formato: 'csv' | 'xlsx') {
    if (!puede('sorteos.exportar') || !sorteo.value || exportando.value) {
        return
    }
    exportando.value = formato
    const resultado = await useSorteos().descargarParticipantes(sorteo.value.id, formato)
    exportando.value = null
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo exportar', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    guardarBlob(resultado.data, `participantes-sorteo-${sorteo.value.id}.${formato}`)
}

function alAvanzar(nuevo: SorteoDetalle, titulo: string, descripcion?: string) {
    sorteo.value = nuevo
    problemaAccion.value = null
    toast.add({ title: titulo, description: descripcion, icon: 'i-lucide-circle-check', color: 'success' })
}

function alSubirImagen(nuevo: SorteoDetalle) {
    alAvanzar(nuevo, 'Imagen del premio subida')
}

function alEjecutar(nuevo: SorteoDetalle) {
    const titulares = nuevo.ganadores.filter(g => g.tipo === 'titular').length
    alAvanzar(nuevo, 'Sorteo ejecutado', `${titulares} ${titulares === 1 ? 'titular' : 'titulares'} y ${nuevo.ganadores.length - titulares} suplentes. El resultado ya es verificable.`)
}

function alMarcar(requisitos: RequisitoSorteo[], archivo: ArchivoSorteo | null) {
    if (sorteo.value) {
        const archivos = sorteo.value.archivos ?? []
        sorteo.value = { ...sorteo.value, requisitos, archivos: archivo && !archivos.some(a => a.id === archivo.id) ? [...archivos, archivo] : archivos }
    }
    toast.add({ title: 'Requisito marcado', icon: 'i-lucide-check-square', color: 'success' })
}

function alEntregar(nuevo: SorteoDetalle) {
    alAvanzar(nuevo, nuevo.estado === 'premios_entregados' ? 'Todos los premios entregados' : 'Premio entregado')
}

function alAnularEntrega(nuevo: SorteoDetalle) {
    alAvanzar(nuevo, 'Entrega anulada: el premio se puede volver a entregar')
}

watch(sorteoId, () => {
    void cargar()
})

onMounted(() => {
    void cargar()
    void cargarCatalogo()
})
</script>

<template>
    <PanelPagina
        id="sorteo"
        :titulo="sorteo?.nombre ?? 'Sorteo'"
        icono="i-lucide-ticket"
    >
        <template #acciones>
            <UButton
                to="/lealtad/sorteos"
                icon="i-lucide-arrow-left"
                label="Sorteos"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="sorteo-error"
        />
        <div
            v-else-if="!sorteo"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-24 w-full" />
        </div>
        <div
            v-else
            class="flex flex-col gap-6"
        >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex min-w-0 flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            {{ sorteo.nombre }}
                        </h2>
                        <SorteoEstadoBadge
                            :estado="sorteo.estado"
                            data-prueba="sorteo-estado"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        Sorteo #{{ sorteo.id }}<template v-if="sorteo.fecha_sorteo">
                            · {{ formatearFechaHora(sorteo.fecha_sorteo) }}
                        </template><template v-if="sorteo.lugar">
                            · {{ sorteo.lugar }}
                        </template>
                    </p>
                    <p
                        v-if="sorteo.descripcion"
                        class="text-sm text-default"
                    >
                        {{ sorteo.descripcion }}
                    </p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="puedeEditar"
                        label="Editar"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="outline"
                        data-prueba="editar-sorteo"
                        @click="editando = true"
                    />
                    <UButton
                        v-if="puedePublicar"
                        label="Publicar bases"
                        icon="i-lucide-scroll-text"
                        data-prueba="publicar-bases"
                        @click="abrirConfirmacion('publicar')"
                    />
                    <UButton
                        v-if="puedeAbrir"
                        label="Abrir participación"
                        icon="i-lucide-ticket"
                        data-prueba="abrir-participacion"
                        @click="abrirConfirmacion('abrir')"
                    />
                    <UButton
                        v-if="puedeCerrarCorte"
                        label="Cerrar corte"
                        icon="i-lucide-list-checks"
                        data-prueba="cerrar-corte"
                        @click="abrirConfirmacion('cerrar')"
                    />
                    <UButton
                        v-if="puedeEjecutar"
                        label="Ejecutar sorteo"
                        icon="i-lucide-trophy"
                        data-prueba="ejecutar-sorteo"
                        @click="ejecutando = true"
                    />
                    <UButton
                        v-if="puedeExportar"
                        label="Participantes CSV"
                        icon="i-lucide-file-down"
                        color="neutral"
                        variant="outline"
                        :loading="exportando === 'csv'"
                        data-prueba="exportar-participantes-csv"
                        @click="exportar('csv')"
                    />
                    <UButton
                        v-if="puedeExportar"
                        label="Participantes XLSX"
                        icon="i-lucide-file-spreadsheet"
                        color="neutral"
                        variant="outline"
                        :loading="exportando === 'xlsx'"
                        data-prueba="exportar-participantes-xlsx"
                        @click="exportar('xlsx')"
                    />
                    <UButton
                        v-if="puedeCerrarActa"
                        label="Cerrar acta"
                        icon="i-lucide-file-signature"
                        data-prueba="cerrar-acta"
                        @click="cerrandoActa = true"
                    />
                    <UButton
                        v-if="puedeCancelar"
                        label="Cancelar sorteo"
                        icon="i-lucide-ban"
                        color="error"
                        variant="outline"
                        data-prueba="cancelar-sorteo"
                        @click="cancelando = true"
                    />
                </div>
            </div>

            <UAlert
                v-if="sorteo.estado === 'cancelado'"
                color="neutral"
                variant="subtle"
                icon="i-lucide-ban"
                title="Sorteo cancelado"
                :description="[sorteo.cancelado_en ? formatearFechaHora(sorteo.cancelado_en) : null, sorteo.motivo_cancelacion].filter(Boolean).join(' · ') || undefined"
                data-prueba="sorteo-cancelado"
            />
            <UAlert
                v-else-if="faltantes.length && (puedeAbrir || puedeEjecutar || estado === 'participacion_abierta')"
                color="warning"
                variant="subtle"
                icon="i-lucide-list-checks"
                :title="estado === 'bases_publicadas' ? 'Para abrir la participación falta el checklist' : 'Para ejecutar falta el checklist'"
                :description="faltantes.map(c => REQUISITOS_SORTEO[c].etiqueta).join(', ')"
                data-prueba="sorteo-faltantes"
            />
            <UAlert
                v-if="corteFuturo && sorteo.corte_en"
                color="neutral"
                variant="subtle"
                icon="i-lucide-calendar-clock"
                :title="`El corte es el ${formatearFechaHora(sorteo.corte_en)}`"
                description="Antes de esa fecha la API no cierra el corte (422 corte_no_vencido)."
            />

            <SorteoPasos :sorteo="sorteo" />

            <div
                v-if="sorteo.estado !== 'cancelado'"
                class="flex flex-col gap-2 rounded-lg border border-default p-3 sm:flex-row sm:items-center sm:justify-between"
                data-prueba="sorteo-aviso-portal"
            >
                <USwitch
                    v-if="puedeCambiarAviso"
                    :model-value="sorteo.aviso_portal ?? false"
                    :disabled="cambiandoAviso"
                    :loading="cambiandoAviso"
                    label="Anunciar en el portal del cliente"
                    description="Los clientes ven el sorteo, sus premios y sus boletos en el portal. Se puede cambiar hasta antes de ejecutar."
                    data-prueba="interruptor-aviso-portal"
                    @update:model-value="cambiarAviso"
                />
                <!-- Sin permiso o ya ejecutado: solo se informa (un interruptor deshabilitado no se lee bien). -->
                <div
                    v-else
                    class="flex flex-wrap items-center gap-2 text-sm"
                    data-prueba="aviso-portal-estado"
                >
                    <span class="font-medium text-highlighted">Portal del cliente</span>
                    <UBadge
                        :label="sorteo.aviso_portal ? 'Se anuncia' : 'No se anuncia'"
                        :icon="sorteo.aviso_portal ? 'i-lucide-megaphone' : 'i-lucide-eye-off'"
                        :color="sorteo.aviso_portal ? 'primary' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                    <span
                        v-if="ESTADOS_CON_RESULTADO.includes(sorteo.estado)"
                        class="text-muted"
                    >Ya no se puede cambiar: el sorteo se ejecutó.</span>
                </div>
            </div>
            <ProblemaAlerta
                v-if="problemaAviso"
                :problema="problemaAviso"
                data-prueba="aviso-portal-problema"
            />

            <ProblemaAlerta
                v-if="problemaAccion"
                :problema="problemaAccion"
                data-prueba="sorteo-problema-accion"
            />

            <UPageCard
                v-if="ejecutado"
                title="Resultado"
                :description="`Ejecutado el ${sorteo.ejecutado_en ? formatearFechaHora(sorteo.ejecutado_en) : '—'} con ${sorteo.participantes} participantes y ${sorteo.boletos} boletos.`"
                icon="i-lucide-trophy"
                variant="subtle"
                data-prueba="sorteo-resultado"
            >
                <div
                    v-if="puedeNotificar"
                    class="mb-4 flex flex-wrap gap-2"
                >
                    <UButton
                        v-if="puedeNotificar"
                        :label="`Notificar ganadores (${porNotificar.length})`"
                        icon="i-lucide-send"
                        size="sm"
                        data-prueba="notificar-ganadores"
                        @click="notificando = true"
                    />
                </div>
                <SorteoResultado
                    :sorteo="sorteo"
                    :puede-entregar="puedeEntregar"
                    :puede-anular-entrega="puedeAnularEntrega"
                    :puede-no-reclamado="puedeNoReclamado"
                    @entregar="ganadorAEntregar = $event"
                    @anular-entrega="ganadorAAnular = $event"
                    @no-reclamado="ganadorNoReclamado = $event"
                />
            </UPageCard>

            <UPageCard
                v-if="sorteo.acta_hash"
                title="Acta"
                :description="sorteo.acta_cerrada_en ? `Cerrada el ${formatearFechaHora(sorteo.acta_cerrada_en)}. El PDF se generó una sola vez; su SHA-256 lo identifica.` : 'El PDF se generó una sola vez; su SHA-256 lo identifica.'"
                icon="i-lucide-file-signature"
                variant="subtle"
                data-prueba="sorteo-acta"
            >
                <div class="flex flex-col gap-3">
                    <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="SHA-256 del acta"
                            :valor="sorteo.acta_hash"
                            mono
                            class="min-w-0 [&_dd]:break-all"
                            data-prueba="acta-hash"
                        />
                        <DatoFicha
                            etiqueta="Constancia del notario o delegado"
                            :valor="sorteo.acta_constancia ?? null"
                        />
                    </dl>
                    <UButton
                        v-if="puede('sorteos.ver')"
                        label="Descargar acta (PDF)"
                        icon="i-lucide-file-down"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="self-start"
                        :loading="descargandoActa"
                        data-prueba="descargar-acta"
                        @click="descargarActa"
                    />
                </div>
            </UPageCard>

            <UPageCard
                title="Premios"
                :description="sorteo.premios.length ? `${titularesSorteo(sorteo.premios)} titulares y ${sorteo.suplentes} suplentes · valor total ${formatearQuetzales(valorPremiosSorteo(sorteo.premios))}` : 'Aún sin premios.'"
                icon="i-lucide-gift"
                variant="subtle"
            >
                <div
                    v-if="sorteo.premios.length"
                    class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    data-prueba="sorteo-premios"
                >
                    <SorteoPremioTarjeta
                        v-for="premio in sorteo.premios"
                        :key="premio.id"
                        :sorteo-id="sorteo.id"
                        :premio="premio"
                        :catalogo="nombreCatalogo(premio)"
                        :puede-subir-imagen="puedeSubirImagen"
                        @subir-imagen="premioImagen = $event"
                    />
                </div>
            </UPageCard>

            <UPageCard
                title="Checklist legal"
                description="Lo que exige la ley para cada paso, con su evidencia."
                icon="i-lucide-scale"
                variant="subtle"
                data-prueba="sorteo-checklist"
            >
                <SorteoRequisitos
                    :sorteo-id="sorteo.id"
                    :archivos="sorteo.archivos ?? []"
                    :requisitos="sorteo.requisitos"
                    :puede-marcar="puedeMarcar"
                    :faltantes="faltantes"
                    @marcar="requisitoAMarcar = $event"
                />
            </UPageCard>

            <div class="grid gap-6 lg:grid-cols-2">
                <UPageCard
                    title="Bases"
                    icon="i-lucide-scroll-text"
                    variant="subtle"
                >
                    <dl class="grid grid-cols-1 gap-3">
                        <DatoFicha
                            etiqueta="Mecánica"
                            :valor="typeof sorteo.bases.mecanica === 'string' ? sorteo.bases.mecanica : null"
                        />
                        <DatoFicha
                            etiqueta="Regla de participación (la ve el cliente)"
                            :valor="typeof sorteo.bases.regla_participacion === 'string' ? sorteo.bases.regla_participacion : null"
                        />
                        <DatoFicha
                            etiqueta="Plazo para reclamar"
                            :valor="typeof sorteo.bases.plazo_reclamo_dias === 'number' ? `${sorteo.bases.plazo_reclamo_dias} días` : null"
                        />
                        <DatoFicha
                            etiqueta="Premios no reclamados"
                            :valor="typeof sorteo.bases.no_reclamados === 'string' ? sorteo.bases.no_reclamados : null"
                        />
                        <DatoFicha
                            etiqueta="Publicación de resultados"
                            :valor="typeof sorteo.bases.publicacion_resultados === 'string' ? sorteo.bases.publicacion_resultados : null"
                        />
                        <DatoFicha
                            etiqueta="Fuente del valor público"
                            :valor="typeof sorteo.bases.fuente_valor_publico === 'string' ? sorteo.bases.fuente_valor_publico : null"
                            data-prueba="sorteo-fuente-valor"
                        />
                        <DatoFicha
                            etiqueta="Resolución de la Gobernación"
                            :valor="typeof sorteo.bases.resolucion_gobernacion === 'string' ? sorteo.bases.resolucion_gobernacion : null"
                        />
                        <DatoFicha
                            v-if="sorteo.bases_hash"
                            etiqueta="Hash de las bases (SHA-256)"
                            :valor="sorteo.bases_hash"
                            mono
                            class="min-w-0 [&_dd]:break-all"
                        />
                        <DatoFicha
                            v-if="sorteo.compromiso"
                            etiqueta="Compromiso de la semilla"
                            :valor="sorteo.compromiso"
                            mono
                            class="min-w-0 [&_dd]:break-all"
                            data-prueba="sorteo-compromiso"
                        />
                    </dl>
                    <UButton
                        v-if="sorteo.bases_hash"
                        :to="useSorteos().urlPublica(sorteo.id, 'bases')"
                        target="_blank"
                        rel="noopener"
                        label="Bases públicas"
                        icon="i-lucide-external-link"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="mt-3 self-start"
                    />
                </UPageCard>

                <UPageCard
                    title="Participación"
                    icon="i-lucide-users"
                    variant="subtle"
                >
                    <dl class="grid grid-cols-2 gap-3">
                        <DatoFicha
                            etiqueta="Participan desde"
                            :valor="sorteo.inscripcion_desde ? formatearFecha(sorteo.inscripcion_desde) : null"
                        />
                        <DatoFicha
                            etiqueta="Corte"
                            :valor="sorteo.corte_en ? formatearFechaHora(sorteo.corte_en) : null"
                        />
                        <DatoFicha
                            etiqueta="Boletos por servicio"
                            :valor="sorteo.criterios.boletos_por_servicio"
                        />
                        <DatoFicha
                            etiqueta="Boletos por puntos"
                            :valor="sorteo.criterios.admite_canje ? 'Sí' : 'No'"
                        />
                        <template v-if="sorteo.lista_hash">
                            <DatoFicha
                                etiqueta="Participantes"
                                :valor="sorteo.participantes"
                                data-prueba="sorteo-participantes"
                            />
                            <DatoFicha
                                etiqueta="Boletos"
                                :valor="sorteo.boletos"
                            />
                            <DatoFicha
                                etiqueta="Hash de la lista"
                                :valor="sorteo.lista_hash"
                                mono
                                class="col-span-2 min-w-0 [&_dd]:break-all"
                            />
                        </template>
                    </dl>
                    <p
                        v-if="!sorteo.lista_hash"
                        class="mt-3 text-xs text-muted"
                    >
                        Sin inscripción: al cerrar el corte participan los clientes con servicios activos y sin facturas vencidas{{ sorteo.criterios.admite_canje ? ', más los boletos canjeados con puntos' : '' }}.
                    </p>
                </UPageCard>
            </div>

            <ConfirmacionModal
                v-model:open="publicando"
                titulo="Publicar bases"
                efecto="Congela las bases, los criterios y los premios con su hash y publica el compromiso de la semilla. Desde aquí no se pueden cambiar."
                confirmar="Publicar bases"
                icono="i-lucide-scroll-text"
                color="primary"
                :ejecutar="publicarBases"
                @hecho="alAvanzar($event, 'Bases publicadas', 'Las bases quedan congeladas con su hash.')"
            />
            <ConfirmacionModal
                v-model:open="abriendo"
                titulo="Abrir participación"
                efecto="Los clientes empiezan a ganar boletos (y a canjearlos con puntos, si se admite). Exige el requisito de bases publicadas (DIACO)."
                confirmar="Abrir participación"
                icono="i-lucide-ticket"
                color="primary"
                :ejecutar="abrirParticipacion"
                @hecho="alAvanzar($event, 'Participación abierta')"
            />
            <ConfirmacionModal
                v-model:open="cerrandoCorte"
                titulo="Cerrar corte"
                efecto="Toma la foto de los participantes: un seudónimo por cliente con sus boletos y el hash de la lista. Ya no entra nadie."
                confirmar="Cerrar corte"
                icono="i-lucide-list-checks"
                color="primary"
                :ejecutar="cerrarCorte"
                @hecho="alAvanzar($event, 'Corte cerrado', `${$event.participantes} participantes con ${$event.boletos} boletos.`)"
            />
            <AccionMotivoModal
                v-model:open="cancelando"
                titulo="Cancelar sorteo"
                :descripcion="sorteo.nombre"
                efecto="El sorteo queda cancelado con su motivo y se publica la cancelación. No se puede deshacer."
                confirmar="Cancelar sorteo"
                placeholder="Ej.: la Gobernación no autorizó el sorteo a tiempo"
                :ejecutar="cancelar"
                @hecho="alAvanzar($event, 'Sorteo cancelado')"
            />
            <AccionMotivoModal
                v-if="puedeCerrarActa"
                v-model:open="cerrandoActa"
                titulo="Cerrar acta"
                :descripcion="sorteo.nombre"
                :efecto="faltaPublicacion
                    ? 'Antes marque «Resultados publicados» en el checklist: la API no cierra el acta sin la publicación (422).'
                    : 'Genera una sola vez el PDF del acta (bases, checklist, hashes, semilla, valor público con su fuente y evidencia, ganadores y asistentes) con su SHA-256. Después no cambia.'"
                confirmar="Cerrar acta"
                icono="i-lucide-file-signature"
                color="primary"
                placeholder="Firma o constancia del notario o delegado (nombre, colegiado, fecha)"
                :ejecutar="cerrarActa"
                @hecho="alAvanzar($event, 'Acta cerrada', $event.estado === 'premios_entregados' ? 'Con todos los premios resueltos, el sorteo queda con los premios entregados.' : 'Ya se puede descargar el PDF con su hash.')"
            />
            <ConfirmacionModal
                v-if="puedeNotificar"
                v-model:open="notificando"
                titulo="Notificar ganadores"
                :efecto="`Avisa a ${porNotificar.length} ${porNotificar.length === 1 ? 'ganador' : 'ganadores'} con su premio y el plazo para reclamar (${typeof sorteo.bases.plazo_reclamo_dias === 'number' ? sorteo.bases.plazo_reclamo_dias : 30} días, según las bases). Quien ya fue notificado no recibe otro aviso.`"
                confirmar="Notificar"
                icono="i-lucide-send"
                color="primary"
                :ejecutar="notificar"
                @hecho="alAvanzar($event, 'Ganadores notificados')"
            />
            <AccionMotivoModal
                v-if="puedeNoReclamado"
                v-model:open="marcandoNoReclamado"
                titulo="Premio no reclamado"
                :descripcion="ganadorNoReclamado ? `${ganadorNoReclamado.posicion}.º · ${nombres.nombre(ganadorNoReclamado.cliente_id)}` : undefined"
                :efecto="suplenteSiguiente
                    ? `El premio pasa al suplente ${suplenteSiguiente.posicion}.º (${nombres.nombre(suplenteSiguiente.cliente_id)}), que se notifica en el mismo paso. El resultado del sorteo no cambia.`
                    : 'No quedan suplentes en espera: el premio queda no reclamado y sigue lo que dicen las bases.'"
                confirmar="Dar por no reclamado"
                icono="i-lucide-user-x"
                color="warning"
                placeholder="Ej.: no se presentó en el plazo de 30 días"
                :ejecutar="marcarNoReclamado"
                @hecho="alNoReclamado"
            />
            <SorteoFormulario
                v-model:open="editando"
                :sorteo="sorteo"
                @hecho="alAvanzar($event, 'Sorteo guardado')"
            />
            <SorteoEjecutarModal
                v-model:open="ejecutando"
                :sorteo="sorteo"
                @hecho="alEjecutar"
            />
            <SorteoMarcarRequisitoModal
                v-model:open="marcando"
                :sorteo-id="sorteo.id"
                :requisito="requisitoAMarcar"
                @hecho="alMarcar"
            />
            <SorteoEntregarModal
                v-model:open="entregando"
                :sorteo-id="sorteo.id"
                :ganador="ganadorAEntregar"
                :premio="premioAEntregar"
                :nombre="ganadorAEntregar ? nombres.nombre(ganadorAEntregar.cliente_id) : ''"
                :empresa-id="sorteo.empresa_id"
                :unidades-usadas="unidadesEntregadas(sorteo.ganadores)"
                @hecho="alEntregar"
            />
            <SorteoImagenPremioModal
                v-if="puedeSubirImagen"
                v-model:open="subiendoImagen"
                :sorteo-id="sorteo.id"
                :premio="premioImagen"
                @hecho="alSubirImagen"
            />
            <SorteoAnularEntregaModal
                v-if="puedeAnularEntrega"
                v-model:open="anulandoEntrega"
                :sorteo-id="sorteo.id"
                :ganador="ganadorAAnular"
                :premio="premioAAnular"
                :nombre="ganadorAAnular ? nombres.nombre(ganadorAAnular.cliente_id) : ''"
                @hecho="alAnularEntrega"
            />
        </div>
    </PanelPagina>
</template>
