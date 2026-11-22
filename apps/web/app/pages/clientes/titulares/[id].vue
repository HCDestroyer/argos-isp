<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Detalle de una revisión de titular empresa (contrato Iris 0.14.1, A1): los datos del
 * representante, las fotos de su documento (se piden solo al abrir este detalle) y las empresas
 * candidatas. «Aprobar» pasa el servicio a la empresa (con varias, eliges cuál) y «Rechazar» lo deja
 * con su titular; las dos piden motivo y la `version` leída (409 si alguien decidió antes). Cada
 * vista del detalle y de cada foto queda en la bitácora. Al decidir, la API borra el documento y
 * las fotos: aquí se dice, no se inventan.
 */
definePageMeta({ permiso: 'clientes.ver_identidad' })

const route = useRoute()
const { puede, enlace } = usePermisos()
const toast = useToast()

const revisionId = computed(() => Number(route.params.id))

const revision = shallowRef<RevisionTitularEmpresaDetalle | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `Revisión de titular #${route.params.id} · ArgosIsp` }))

const pendiente = computed(() => revision.value?.estado === 'pendiente')
const variosCandidatos = computed(() => (revision.value?.candidatos.length ?? 0) > 1)
const puedeAprobar = computed(() => pendiente.value && puede('servicios.aprobar_titular_empresa'))
const puedeRechazar = computed(() => pendiente.value && puede('servicios.rechazar_titular_empresa'))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useTitularesEmpresa().ver(revisionId.value)
    cargando.value = false
    if (!resultado.ok) {
        revision.value = null
        problema.value = resultado.problema
        return
    }
    revision.value = resultado.data
    void cargarFotos()
    void cargarCandidatos()
}

/* Fotos del documento del representante: `Blob` con la cookie de sesión y URL de objeto que se libera al salir. */
type Parte = 'frente' | 'reverso'
const fotos = reactive<Record<Parte, { url: string | null, cargando: boolean, problema: Problem | null }>>({
    frente: { url: null, cargando: false, problema: null },
    reverso: { url: null, cargando: false, problema: null },
})

function liberarFotos() {
    for (const parte of ['frente', 'reverso'] as const) {
        if (fotos[parte].url) {
            URL.revokeObjectURL(fotos[parte].url)
            fotos[parte].url = null
        }
    }
}

async function cargarFoto(parte: Parte) {
    const actual = revision.value
    const tiene = parte === 'frente' ? actual?.tiene_frente : actual?.tiene_reverso
    if (!actual || !tiene) {
        return
    }
    fotos[parte].cargando = true
    fotos[parte].problema = null
    const resultado = await useTitularesEmpresa().foto(actual.id, parte)
    fotos[parte].cargando = false
    if (!resultado.ok) {
        fotos[parte].problema = resultado.problema
        return
    }
    if (fotos[parte].url) {
        URL.revokeObjectURL(fotos[parte].url)
    }
    fotos[parte].url = URL.createObjectURL(resultado.data)
}

function cargarFotos() {
    liberarFotos()
    void cargarFoto('frente')
    void cargarFoto('reverso')
}

const partesFoto = computed(() => {
    const actual = revision.value
    if (!actual) {
        return []
    }
    return [
        { parte: 'frente' as const, etiqueta: 'Frente', tiene: actual.tiene_frente },
        { parte: 'reverso' as const, etiqueta: 'Reverso', tiene: actual.tiene_reverso },
    ].filter(f => f.tiene)
})

/* Candidatas: el nombre y si sigue verificado vienen de su ficha (`clientes.ver`); sin el permiso, solo el número. */
const candidatos = shallowRef<Record<number, Cliente | null>>({})
const problemaCandidatos = ref<Problem | null>(null)

async function cargarCandidatos() {
    candidatos.value = {}
    problemaCandidatos.value = null
    const actual = revision.value
    if (!actual || !puede('clientes.ver')) {
        return
    }
    const ids = [...new Set([...actual.candidatos, actual.de_cliente_id, ...(actual.cliente_asignado_id ? [actual.cliente_asignado_id] : [])])]
    const resultados = await Promise.all(ids.map(id => useClientes().ver(id)))
    const leidos: Record<number, Cliente | null> = {}
    resultados.forEach((resultado, indice) => {
        const id = ids[indice]
        if (id === undefined) {
            return
        }
        // 404: el cliente anterior se elimina al aprobar si no tenía historia.
        leidos[id] = resultado.ok ? resultado.data : null
        if (!resultado.ok && resultado.problema.status !== 404) {
            problemaCandidatos.value = resultado.problema
        }
    })
    candidatos.value = leidos
}

function nombreCliente(id: number): string {
    return candidatos.value[id]?.nombre ?? `Cliente #${id}`
}

/* Aprobar: con varias candidatas se elige una; el motivo queda en la bitácora. */
const aprobarAbierto = ref(false)
const rechazarAbierto = ref(false)
const idAprobar = useId()
const idRechazar = useId()
const estadoAprobar = reactive<EntradaAprobarTitular>({ cliente_id: undefined, motivo: '' })
const estadoRechazar = reactive({ motivo: '' })
const enviando = ref(false)
const problemaAccion = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const esquemaAprobar = computed(() => esquemaAprobarTitular(variosCandidatos.value))

const opcionesCandidatos = computed<RadioGroupItem[]>(() => (revision.value?.candidatos ?? []).map((id) => {
    const cliente = candidatos.value[id]
    return {
        label: nombreCliente(id),
        description: cliente ? `${cliente.codigo} · NIT ${formatearDocumento('nit', cliente.nit_cui)}${cliente.nit_verificado_en ? ' · verificado' : ' · ya no está verificado'}` : `Cliente #${id}`,
        value: id,
    }
}))

function abrirAprobar() {
    estadoAprobar.cliente_id = variosCandidatos.value ? undefined : revision.value?.candidatos[0]
    estadoAprobar.motivo = ''
    problemaAccion.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
    aprobarAbierto.value = true
}

function abrirRechazar() {
    estadoRechazar.motivo = ''
    problemaAccion.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
    rechazarAbierto.value = true
}

/** Lo que devuelve la API al decidir: el resumen; el documento y las fotos ya se borraron. */
function alDecidir(resumen: RevisionTitularEmpresa) {
    const actual = revision.value
    if (!actual) {
        return
    }
    liberarFotos()
    revision.value = {
        ...actual,
        ...resumen,
        decision_motivo: resumen.estado === 'aprobada' ? estadoAprobar.motivo.trim() : estadoRechazar.motivo.trim(),
        representante: { documento_tipo: actual.representante.documento_tipo, documento_numero: null, nombre: null },
        tiene_frente: false,
        tiene_reverso: false,
    }
}

async function aprobar(evento: FormSubmitEvent<{ cliente_id?: number, motivo: string }>) {
    const actual = revision.value
    if (!actual) {
        return
    }
    enviando.value = true
    problemaAccion.value = null
    const datos: DatosAprobarTitular = { motivo: evento.data.motivo, version: actual.version }
    if (evento.data.cliente_id !== undefined) {
        datos.cliente_id = evento.data.cliente_id
    }
    const resultado = await useTitularesEmpresa().aprobar(actual.id, datos, claveIdempotencia)
    enviando.value = false
    if (!resultado.ok) {
        problemaAccion.value = resultado.problema
        return
    }
    aprobarAbierto.value = false
    alDecidir(resultado.data.revision)
    void cargarCandidatos()
    toast.add({
        title: 'Cambio de titular aprobado',
        description: `El servicio #${resultado.data.servicio_id} pasó a ${nombreCliente(resultado.data.titular.cliente_id)}${resultado.data.de_cliente_eliminado ? '; el titular anterior se eliminó (no tenía historia)' : ''}.`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
}

async function rechazar(evento: FormSubmitEvent<{ motivo: string }>) {
    const actual = revision.value
    if (!actual) {
        return
    }
    enviando.value = true
    problemaAccion.value = null
    const resultado = await useTitularesEmpresa().rechazar(actual.id, { motivo: evento.data.motivo, version: actual.version }, claveIdempotencia)
    enviando.value = false
    if (!resultado.ok) {
        problemaAccion.value = resultado.problema
        return
    }
    rechazarAbierto.value = false
    alDecidir(resultado.data)
    toast.add({ title: 'Cambio de titular rechazado', description: 'El servicio sigue con su titular.', icon: 'i-lucide-circle-x', color: 'success' })
}

/** Tras un 409 o una revisión ya decidida: se cierra el diálogo y se vuelve a leer. */
async function recargarTrasConflicto() {
    aprobarAbierto.value = false
    rechazarAbierto.value = false
    await cargar()
}

const debeRecargar = computed(() => {
    const tipo = problemaAccion.value?.type ?? ''
    return problemaAccion.value?.status === 409 || tipo.endsWith(':revision_no_pendiente')
})

watch(revisionId, cargar)
onMounted(cargar)
onBeforeUnmount(liberarFotos)
</script>

<template>
    <PanelPagina
        id="titular-empresa"
        :titulo="revision?.razon_social ?? `Revisión #${route.params.id}`"
        icono="i-lucide-building-2"
    >
        <template #acciones>
            <UButton
                to="/clientes/titulares"
                icon="i-lucide-arrow-left"
                label="Revisiones"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
            <UButton
                v-if="puedeRechazar"
                label="Rechazar"
                icon="i-lucide-circle-x"
                color="error"
                variant="outline"
                class="hidden rounded-full sm:inline-flex"
                data-prueba="rechazar-revision"
                @click="abrirRechazar"
            />
            <UButton
                v-if="puedeAprobar"
                label="Aprobar"
                icon="i-lucide-circle-check"
                color="success"
                class="glow-brand hidden rounded-full px-5 sm:inline-flex"
                data-prueba="aprobar-revision"
                @click="abrirAprobar"
            />
        </template>

        <div
            v-if="cargando && !revision"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-24 w-full rounded-[1.375rem]" />
            <USkeleton class="h-64 w-full rounded-[1.375rem]" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Revisión no encontrada"
            :description="`No existe una revisión con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a las revisiones', to: '/clientes/titulares', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="revision"
            class="flex flex-col gap-4 pb-20 sm:pb-0"
        >
            <!-- Franja: estado, motivo de la revisión, NIT y servicio. -->
            <section class="surface-card flex flex-col gap-3 rounded-[1.375rem] p-4 sm:p-5">
                <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                        :label="ESTADOS_REVISION_TITULAR[revision.estado].etiqueta"
                        :icon="ESTADOS_REVISION_TITULAR[revision.estado].icono"
                        :color="ESTADOS_REVISION_TITULAR[revision.estado].color"
                        variant="subtle"
                        class="rounded-full"
                        data-prueba="estado-revision"
                    />
                    <UBadge
                        :label="MOTIVOS_REVISION_TITULAR[revision.motivo_revision].etiqueta"
                        :icon="revision.motivo_revision === 'varios_candidatos' ? 'i-lucide-copy' : 'i-lucide-user-plus'"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                    />
                </div>
                <p class="text-sm text-default">
                    {{ MOTIVOS_REVISION_TITULAR[revision.motivo_revision].descripcion }}
                </p>
                <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DatoFicha
                        etiqueta="NIT"
                        :valor="formatearNitNormalizado(revision.nit)"
                        mono
                    />
                    <DatoFicha etiqueta="Servicio por instalar">
                        <ULink
                            v-if="enlace(`/servicios/${revision.servicio_id}`)"
                            :to="enlace(`/servicios/${revision.servicio_id}`)"
                            class="text-primary"
                        >
                            Servicio #{{ revision.servicio_id }}
                        </ULink>
                        <template v-else>
                            Servicio #{{ revision.servicio_id }}
                        </template>
                    </DatoFicha>
                    <DatoFicha etiqueta="Titular al pedirlo">
                        <ULink
                            v-if="candidatos[revision.de_cliente_id] && enlace(`/clientes/${revision.de_cliente_id}`)"
                            :to="enlace(`/clientes/${revision.de_cliente_id}`)"
                            class="text-primary"
                        >
                            {{ nombreCliente(revision.de_cliente_id) }}
                        </ULink>
                        <template v-else>
                            {{ nombreCliente(revision.de_cliente_id) }}
                        </template>
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Pedido el"
                        :valor="formatearFechaHora(revision.created_at)"
                    />
                </dl>
            </section>

            <UAlert
                v-if="revision.estado !== 'pendiente'"
                :color="ESTADOS_REVISION_TITULAR[revision.estado].color"
                variant="subtle"
                :icon="ESTADOS_REVISION_TITULAR[revision.estado].icono"
                :title="revision.estado === 'aprobada' && revision.cliente_asignado_id ? `Aprobada: el servicio pasó a ${nombreCliente(revision.cliente_asignado_id)}` : `Revisión ${ESTADOS_REVISION_TITULAR[revision.estado].etiqueta.toLowerCase()}`"
                :description="[revision.decidida_en ? `El ${formatearFechaHora(revision.decidida_en)}` : null, revision.decision_motivo].filter(Boolean).join(' · ') || undefined"
                data-prueba="decision-revision"
            />

            <div class="grid gap-4 lg:grid-cols-2">
                <!-- Representante y solicitud. -->
                <section
                    class="surface-card flex flex-col gap-4 rounded-[1.375rem] p-4 sm:p-5"
                    aria-labelledby="titulo-representante"
                >
                    <h2
                        id="titulo-representante"
                        class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
                    >
                        Representante
                    </h2>
                    <UAlert
                        v-if="!revision.representante.documento_numero && !revision.representante.nombre"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-shield-off"
                        title="Datos borrados al decidir"
                        description="Argos borra el documento, el nombre y las fotos del representante cuando la revisión se decide."
                    />
                    <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="Nombre"
                            :valor="revision.representante.nombre"
                            data-prueba="representante-nombre"
                        />
                        <DatoFicha
                            :etiqueta="DOCUMENTOS_REPRESENTANTE[revision.representante.documento_tipo]"
                            :valor="revision.representante.documento_numero"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Relación con la empresa"
                            :valor="revision.relacion"
                        />
                        <DatoFicha
                            etiqueta="Razón social que dio"
                            :valor="revision.razon_social"
                        />
                        <DatoFicha
                            etiqueta="Teléfono"
                            :valor="revision.telefono"
                        />
                        <DatoFicha
                            etiqueta="Correo"
                            :valor="revision.email"
                        />
                        <DatoFicha
                            etiqueta="Motivo de quien lo pidió"
                            :valor="revision.motivo"
                            class="whitespace-pre-line sm:col-span-2"
                        />
                        <DatoFicha
                            v-if="revision.origen_id"
                            etiqueta="Origen"
                            :valor="revision.origen_tipo === 'orden_iris' ? `Orden ${revision.origen_id} de Iris` : revision.origen_id"
                        />
                    </dl>
                </section>

                <!-- Fotos del documento: se piden solo aquí y cada una queda en la bitácora. -->
                <section
                    class="surface-card flex flex-col gap-4 rounded-[1.375rem] p-4 sm:p-5"
                    aria-labelledby="titulo-fotos"
                >
                    <h2
                        id="titulo-fotos"
                        class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
                    >
                        Documento del representante
                    </h2>
                    <UEmpty
                        v-if="!partesFoto.length"
                        icon="i-lucide-image-off"
                        title="Sin fotos"
                        :description="pendiente ? 'La solicitud no trae fotos.' : 'Las fotos se borraron al decidir.'"
                        variant="naked"
                        size="sm"
                    />
                    <div
                        v-else
                        class="grid gap-3 sm:grid-cols-2"
                    >
                        <figure
                            v-for="foto in partesFoto"
                            :key="foto.parte"
                            class="flex flex-col gap-1.5"
                            :data-prueba="`foto-${foto.parte}`"
                        >
                            <figcaption class="text-xs font-medium text-muted">
                                {{ foto.etiqueta }}
                            </figcaption>
                            <ProblemaAlerta
                                v-if="fotos[foto.parte].problema"
                                :problema="fotos[foto.parte].problema!"
                                :reintentar="() => cargarFoto(foto.parte)"
                                :reintentando="fotos[foto.parte].cargando"
                            />
                            <USkeleton
                                v-else-if="!fotos[foto.parte].url"
                                class="aspect-[3/2] w-full rounded-xl"
                            />
                            <img
                                v-else
                                :src="fotos[foto.parte].url ?? undefined"
                                :alt="`${foto.etiqueta} del documento del representante`"
                                class="aspect-[3/2] w-full rounded-xl object-contain ring ring-(--ax-borde)"
                            >
                        </figure>
                    </div>
                    <p class="text-xs text-muted">
                        Cada vez que abres esta revisión queda registrado en la bitácora con tu usuario.
                    </p>
                </section>
            </div>

            <!-- Empresas candidatas. -->
            <section
                class="surface-card flex flex-col gap-2 rounded-[1.375rem] p-4 sm:p-5"
                aria-labelledby="titulo-candidatos"
            >
                <h2
                    id="titulo-candidatos"
                    class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
                >
                    {{ variosCandidatos ? 'Empresas con ese NIT verificado' : 'Empresa con ese NIT verificado' }}
                </h2>
                <ProblemaAlerta
                    v-if="problemaCandidatos"
                    :problema="problemaCandidatos"
                    :reintentar="cargarCandidatos"
                />
                <ul
                    class="-mx-2 flex flex-col divide-y divide-(--ax-borde)"
                    data-prueba="candidatos"
                >
                    <ListaItem
                        v-for="id in revision.candidatos"
                        :key="id"
                        :titulo="nombreCliente(id)"
                        :subtitulo="candidatos[id] ? `${candidatos[id]!.codigo} · NIT ${formatearDocumento('nit', candidatos[id]!.nit_cui)}` : undefined"
                        icono="i-lucide-building-2"
                        :to="candidatos[id] ? enlace(`/clientes/${id}`) : undefined"
                    >
                        <template #derecha>
                            <UBadge
                                v-if="revision.cliente_asignado_id === id"
                                label="Asignada"
                                icon="i-lucide-circle-check"
                                color="success"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                            <UBadge
                                v-else-if="candidatos[id] && !candidatos[id]!.nit_verificado_en"
                                label="Ya no está verificado"
                                icon="i-lucide-badge-alert"
                                color="warning"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                        </template>
                    </ListaItem>
                </ul>
            </section>

            <!-- Teléfono: las acciones fijas abajo. -->
            <div
                v-if="puedeAprobar || puedeRechazar"
                class="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-(--ax-borde) bg-(--ax-tarjeta) p-3 sm:hidden"
                data-prueba="barra-revision"
            >
                <UButton
                    v-if="puedeRechazar"
                    label="Rechazar"
                    icon="i-lucide-circle-x"
                    color="error"
                    variant="outline"
                    size="lg"
                    class="rounded-full"
                    @click="abrirRechazar"
                />
                <UButton
                    v-if="puedeAprobar"
                    label="Aprobar"
                    icon="i-lucide-circle-check"
                    color="success"
                    size="lg"
                    block
                    class="flex-1 rounded-full"
                    @click="abrirAprobar"
                />
            </div>
        </div>

        <UModal
            v-model:open="aprobarAbierto"
            title="Aprobar cambio de titular"
            :description="revision ? `Servicio #${revision.servicio_id} · ${revision.razon_social}` : undefined"
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    :id="idAprobar"
                    :schema="esquemaAprobar"
                    :state="estadoAprobar"
                    class="flex flex-col gap-4"
                    @submit="aprobar"
                >
                    <UFormField
                        v-if="variosCandidatos"
                        label="¿A qué empresa pasa el servicio?"
                        name="cliente_id"
                        required
                    >
                        <URadioGroup
                            v-model="estadoAprobar.cliente_id"
                            :items="opcionesCandidatos"
                            variant="card"
                            data-prueba="elegir-candidato"
                        />
                    </UFormField>
                    <p
                        v-else-if="revision"
                        class="text-sm text-default"
                    >
                        El servicio pasa a <strong>{{ nombreCliente(revision.candidatos[0] ?? 0) }}</strong> y el representante queda registrado en esa empresa.
                    </p>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                        help="Queda en la bitácora con tu usuario."
                    >
                        <UTextarea
                            v-model="estadoAprobar.motivo"
                            :rows="3"
                            placeholder="Ej.: confirmé con la gerencia que es su representante legal"
                            class="w-full"
                            data-prueba="motivo-aprobar"
                        />
                    </UFormField>
                    <UAlert
                        v-if="problemaAccion"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="problemaAccion.status === 409 ? 'Alguien decidió antes' : 'No se pudo aprobar'"
                        :description="mensajeErrorRevision(problemaAccion)"
                        :actions="debeRecargar ? [{ label: 'Volver a cargar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: recargarTrasConflicto }] : undefined"
                        data-prueba="error-revision"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        :icon="ICONOS.cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="aprobarAbierto = false"
                    />
                    <UButton
                        type="submit"
                        :form="idAprobar"
                        label="Aprobar"
                        icon="i-lucide-circle-check"
                        color="success"
                        :loading="enviando"
                        data-prueba="confirmar-aprobar"
                    />
                </div>
            </template>
        </UModal>

        <UModal
            v-model:open="rechazarAbierto"
            title="Rechazar cambio de titular"
            :description="revision ? `Servicio #${revision.servicio_id} · ${revision.razon_social}` : undefined"
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    :id="idRechazar"
                    :schema="esquemaRechazarTitular"
                    :state="estadoRechazar"
                    class="flex flex-col gap-4"
                    @submit="rechazar"
                >
                    <p class="text-sm text-default">
                        El servicio sigue con su titular actual y Argos borra el documento y las fotos del representante.
                    </p>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                        help="Queda en la bitácora con tu usuario."
                    >
                        <UTextarea
                            v-model="estadoRechazar.motivo"
                            :rows="3"
                            placeholder="Ej.: la persona no aparece como representante en la patente"
                            class="w-full"
                            data-prueba="motivo-rechazar"
                        />
                    </UFormField>
                    <UAlert
                        v-if="problemaAccion"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="problemaAccion.status === 409 ? 'Alguien decidió antes' : 'No se pudo rechazar'"
                        :description="mensajeErrorRevision(problemaAccion)"
                        :actions="debeRecargar ? [{ label: 'Volver a cargar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: recargarTrasConflicto }] : undefined"
                        data-prueba="error-revision"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        :icon="ICONOS.cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="rechazarAbierto = false"
                    />
                    <UButton
                        type="submit"
                        :form="idRechazar"
                        label="Rechazar"
                        icon="i-lucide-circle-x"
                        color="error"
                        :loading="enviando"
                        data-prueba="confirmar-rechazar"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
