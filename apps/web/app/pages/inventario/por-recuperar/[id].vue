<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Declarar no recuperado (tablero PendIntentosRecuperacion, contrato Iris 0.14.0 §3.10 y §4.5, A3):
 * los intentos de recuperación del equipo, del más nuevo al más viejo, con su verificación con Iris
 * (al abrir se vuelve a verificar), y a la derecha «¿Se puede declarar?»: técnicos distintos que
 * cuentan contra el mínimo, contactos registrados en el panel y el botón «Declarar no recuperado»
 * (`inventario.cobrar_equipo`). Los intentos anteriores a la verificación los decide una persona
 * (`inventario.decidir_intento_recuperacion`). El técnico nunca decide pérdidas ni cobros.
 */
definePageMeta({ permiso: 'inventario.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
const unidadId = computed(() => Number(route.params.id))

const unidad = shallowRef<UnidadInventarioDetalle | null>(null)
const problemaUnidad = ref<Problem | null>(null)
const datos = shallowRef<IntentosRecuperacionDeUnidad | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const verificando = ref(false)

useHead(() => ({ title: `Declarar no recuperado${unidad.value ? ` · ${unidad.value.producto_nombre}` : ''} · ArgosIsp` }))

async function cargarUnidad() {
    const r = await useUnidadesInventario().ver(unidadId.value)
    unidad.value = r.ok ? r.data : null
    problemaUnidad.value = r.ok ? null : r.problema
}

/** Al abrir (y con «Volver a verificar con Iris»): verifica los pendientes; sin permiso, solo lee. */
async function cargar(verificar = true) {
    const conIris = verificar && puede('inventario.verificar_operacion_iris')
    cargando.value = !datos.value
    verificando.value = conIris
    const r = conIris ? await useIntentosRecuperacion().verificar(unidadId.value) : await useIntentosRecuperacion().listar(unidadId.value)
    cargando.value = false
    verificando.value = false
    if (r.ok) {
        datos.value = r.data
        problema.value = null
        return
    }
    // Si Iris o la verificación fallan, la lista guardada se muestra igual y el error queda arriba.
    if (conIris) {
        const leida = await useIntentosRecuperacion().listar(unidadId.value)
        datos.value = leida.ok ? leida.data : null
    }
    problema.value = r.problema
}

onMounted(() => {
    void cargarUnidad()
    void cargar()
})

const minimo = computed(() => datos.value?.tecnicos_minimos ?? 2)
const tecnicos = computed(() => datos.value?.tecnicos_que_cuentan ?? 0)
const contactos = computed(() => datos.value?.contactos ?? 0)
const anteriores = computed(() => datos.value?.intentos.filter(i => i.verificacion === 'anterior') ?? [])
const sePuede = computed(() => datos.value !== null && (tecnicos.value >= minimo.value || contactos.value >= 1))
const porRecuperar = computed(() => unidad.value?.estado === 'por_recuperar')
const textoFalta = computed(() => {
    const faltan = Math.max(0, minimo.value - tecnicos.value)
    const partes = [`Hacen falta ${faltan} ${faltan === 1 ? 'intento de un técnico distinto' : 'intentos de técnicos distintos'} o 1 contacto registrado.`]
    if (anteriores.value.length) {
        partes.push(`Decide ${anteriores.value.length === 1 ? `el intento #${anteriores.value[0]!.intento_n}` : 'los intentos anteriores'} o registra un contacto.`)
    }
    return partes.join(' ')
})

/* Decidir un intento anterior */
const decidirAbierto = ref(false)
const aDecidir = shallowRef<IntentoRecuperacionVerificado | null>(null)

function decidir(intento: IntentoRecuperacionVerificado) {
    aDecidir.value = intento
    decidirAbierto.value = true
}

function alDecidir(decision: DecisionIntentoRecuperacion) {
    toast.add({ title: decision.verificacion === 'aceptado' ? 'Intento aceptado: cuenta' : 'Intento descartado', icon: 'i-lucide-circle-check', color: 'success' })
    void cargar(false)
}

/* Contacto y declaración */
const contactoAbierto = ref(false)
const declararAbierto = ref(false)

function alContacto() {
    toast.add({ title: 'Contacto registrado', icon: 'i-lucide-circle-check', color: 'success' })
    void cargar(false)
}

async function alDeclarar(resultado: UnidadNoRecuperada) {
    toast.add({
        title: 'Declarado no recuperado',
        description: resultado.cobro_id ? 'Se cobrará al cliente el cargo «Equipo no devuelto».' : 'Sin cobro al cliente.',
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    await navigateTo('/inventario/por-recuperar')
}

/* Ver en Iris y en el mapa */
const abriendo = ref<number | null>(null)

async function verEnIris(intento: IntentoRecuperacionVerificado) {
    if (!intento.origen_externo_id) {
        return
    }
    abriendo.value = intento.id
    const r = await useIris().abrir('orden', intento.origen_externo_id)
    abriendo.value = null
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    window.open(r.data.url, '_blank', 'noopener')
}

const mapa = (i: IntentoRecuperacionVerificado) => `https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=18/${i.lat}/${i.lng}`
const coordenadas = (i: IntentoRecuperacionVerificado) => `${Number(i.lat).toFixed(4)}, ${Number(i.lng).toFixed(4)} · ±${Math.round(Number(i.precision_m))} m`
</script>

<template>
    <PanelPagina
        id="inventario-declarar"
        :titulo="unidad ? `Declarar no recuperado · ${unidad.producto_nombre}` : 'Declarar no recuperado'"
        icono="i-lucide-undo-2"
        encabezado-propio
    >
        <div
            class="flex min-w-0 items-start gap-3"
            data-prueba="encabezado-declarar"
        >
            <span class="pastilla-icono pastilla-tono tono-aviso size-11 shrink-0 rounded-xl">
                <UIcon
                    name="i-lucide-router"
                    class="size-5"
                />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
                <div class="flex flex-wrap items-center gap-2">
                    <h1 class="text-xl font-bold tracking-[-0.02em] text-highlighted sm:text-[1.75rem]">
                        Declarar no recuperado<template v-if="unidad">
                            · {{ unidad.producto_nombre }}
                        </template>
                    </h1>
                    <AyudaBoton solo-icono />
                </div>
                <ProblemaAlerta
                    v-if="problemaUnidad"
                    :problema="problemaUnidad"
                    :reintentar="cargarUnidad"
                />
                <p
                    v-else-if="unidad"
                    class="flex flex-wrap items-center gap-x-1.5 text-sm text-muted"
                >
                    <span class="font-mono">{{ identificacionUnidad(unidad) }}</span>
                    <span v-if="unidad.servicio_id">· Servicio #{{ unidad.servicio_id }}</span>
                    <UBadge
                        :label="ESTADOS_EQUIPO[estadoEquipoDe(unidad)].etiqueta"
                        :icon="ESTADOS_EQUIPO[estadoEquipoDe(unidad)].icono"
                        :color="ESTADOS_EQUIPO[estadoEquipoDe(unidad)].color"
                        variant="subtle"
                        size="sm"
                        data-prueba="estado-unidad"
                    />
                </p>
            </div>
        </div>

        <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:px-4">
                    <h2 class="text-base font-semibold text-highlighted">
                        Intentos de recuperación <span class="text-xs font-normal text-muted">del más nuevo al más viejo</span>
                    </h2>
                    <UButton
                        v-if="puede('inventario.verificar_operacion_iris')"
                        label="Volver a verificar con Iris"
                        icon="i-lucide-refresh-cw"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :loading="verificando"
                        data-prueba="verificar-iris"
                        @click="cargar()"
                    />
                </div>
                <div class="flex flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto">
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        :reintentar="() => cargar()"
                        :reintentando="verificando || cargando"
                    />
                    <USkeleton
                        v-if="cargando && !datos"
                        class="h-24 w-full rounded-2xl"
                    />
                    <template v-else-if="datos">
                        <UAlert
                            color="primary"
                            variant="subtle"
                            icon="i-lucide-info"
                            :description="datos.aviso"
                        />
                        <ul
                            class="flex flex-col gap-2.5"
                            data-prueba="intentos"
                        >
                            <li
                                v-for="intento in datos.intentos"
                                :key="intento.id"
                                class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) p-3 sm:flex-row"
                                :data-intento="intento.intento_n"
                            >
                                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--ax-panel) font-bold text-muted">#{{ intento.intento_n }}</span>
                                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span class="text-base font-semibold text-highlighted">{{ MOTIVOS_INTENTO[intento.motivo] }} <span class="text-xs font-normal text-muted">· {{ formatearFechaCorta(intento.fecha) }} {{ formatearHora(intento.fecha) }}</span></span>
                                    <span class="text-xs text-muted">
                                        Técnico: <b class="text-highlighted">{{ intento.actor_tecnico_nombre ?? 'sin nombre' }}</b> · {{ coordenadas(intento) }}
                                    </span>
                                    <span
                                        v-if="intento.nota"
                                        class="text-xs text-muted"
                                    >«{{ intento.nota }}»</span>
                                    <div class="flex flex-wrap gap-x-3">
                                        <UButton
                                            v-if="intento.origen_externo_id && puede('iris.abrir')"
                                            label="Ver foto en Iris"
                                            icon="i-lucide-camera"
                                            variant="link"
                                            size="sm"
                                            class="px-0"
                                            :loading="abriendo === intento.id"
                                            @click="verEnIris(intento)"
                                        />
                                        <UButton
                                            label="Ver en el mapa"
                                            icon="i-lucide-map-pin"
                                            variant="link"
                                            size="sm"
                                            class="px-0"
                                            :to="mapa(intento)"
                                            target="_blank"
                                        />
                                    </div>
                                </div>
                                <div class="flex min-w-0 flex-col gap-1.5 sm:w-64">
                                    <div class="flex flex-wrap items-center justify-between gap-2">
                                        <UBadge
                                            :label="VERIFICACIONES_INTENTO[intento.verificacion ?? 'no_aplica'].etiqueta"
                                            :icon="VERIFICACIONES_INTENTO[intento.verificacion ?? 'no_aplica'].icono"
                                            :color="VERIFICACIONES_INTENTO[intento.verificacion ?? 'no_aplica'].color"
                                            variant="subtle"
                                            size="sm"
                                            data-prueba="verificacion"
                                        />
                                        <UBadge
                                            :label="intento.cuenta ? 'Cuenta' : 'No cuenta'"
                                            :icon="intento.cuenta ? 'i-lucide-check' : 'i-lucide-circle-slash'"
                                            :color="intento.cuenta ? 'success' : 'neutral'"
                                            variant="soft"
                                            size="sm"
                                            data-prueba="cuenta"
                                        />
                                    </div>
                                    <span class="text-xs text-muted">{{ detalleVerificacion(intento) }}</span>
                                    <div
                                        v-if="intento.verificacion === 'anterior' && puede('inventario.decidir_intento_recuperacion')"
                                        class="flex flex-wrap gap-2"
                                    >
                                        <UButton
                                            label="Decidir"
                                            icon="i-lucide-scale"
                                            color="neutral"
                                            variant="outline"
                                            size="sm"
                                            data-prueba="decidir"
                                            @click="decidir(intento)"
                                        />
                                    </div>
                                </div>
                            </li>
                            <li v-if="!datos.intentos.length">
                                <UEmpty
                                    icon="i-lucide-undo-2"
                                    title="Sin intentos de recuperación"
                                    description="Los técnicos los registran desde la orden de retiro en Iris."
                                    variant="naked"
                                />
                            </li>
                        </ul>
                    </template>
                </div>
            </section>

            <aside class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0">
                <h2 class="flex items-center gap-2 border-b border-(--ax-borde) p-3 text-base font-semibold text-highlighted sm:px-4">
                    <UIcon
                        name="i-lucide-shield-check"
                        class="size-4"
                    />
                    ¿Se puede declarar?
                </h2>
                <div class="flex flex-1 flex-col gap-3 p-3 sm:p-4">
                    <USkeleton
                        v-if="!datos"
                        class="h-32 w-full"
                    />
                    <template v-else>
                        <div class="flex flex-col gap-2 rounded-2xl border border-(--ax-borde) p-3">
                            <div class="flex items-center justify-between gap-2 text-sm">
                                <span class="text-muted">Técnicos distintos que cuentan</span>
                                <b
                                    class="text-highlighted"
                                    data-prueba="tecnicos-cuentan"
                                >{{ tecnicos }} de {{ minimo }}</b>
                            </div>
                            <UProgress
                                :model-value="Math.min(tecnicos, minimo)"
                                :max="minimo"
                                :color="tecnicos >= minimo ? 'success' : 'warning'"
                                size="sm"
                            />
                        </div>
                        <div class="flex flex-col gap-2 rounded-2xl border border-(--ax-borde) p-3">
                            <div class="flex items-center justify-between gap-2 text-sm">
                                <span class="text-muted">Contactos con el cliente (panel)</span>
                                <b
                                    class="text-highlighted"
                                    data-prueba="contactos"
                                >{{ Math.min(contactos, 1) }} de 1</b>
                            </div>
                            <UProgress
                                :model-value="Math.min(contactos, 1)"
                                :max="1"
                                :color="contactos >= 1 ? 'success' : 'warning'"
                                size="sm"
                            />
                            <UButton
                                v-if="puede('inventario.registrar_contacto_recuperacion') && porRecuperar"
                                label="Registrar un contacto"
                                icon="i-lucide-phone"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="self-start"
                                data-prueba="registrar-contacto"
                                @click="contactoAbierto = true"
                            />
                        </div>
                        <UAlert
                            v-if="!sePuede"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-triangle-alert"
                            title="Todavía no."
                            :description="textoFalta"
                            data-prueba="todavia-no"
                        />
                        <UAlert
                            v-else
                            color="success"
                            variant="subtle"
                            icon="i-lucide-circle-check"
                            title="Ya se puede declarar."
                            :description="tecnicos >= minimo ? `Hay intentos de ${tecnicos} técnicos distintos que cuentan.` : 'Hay un contacto con el cliente registrado.'"
                            data-prueba="ya-se-puede"
                        />
                        <p class="text-xs text-muted">
                            El técnico nunca decide pérdidas ni cobros: la declaración la hace una persona en el panel y ofrece cobrar «Equipo no devuelto».
                        </p>
                    </template>
                </div>
                <PanelBarraAccion
                    v-if="puede('inventario.cobrar_equipo') && porRecuperar"
                    class="lg:border-t lg:border-(--ax-borde) lg:p-4"
                >
                    <UButton
                        label="Declarar no recuperado"
                        icon="i-lucide-triangle-alert"
                        color="error"
                        block
                        size="lg"
                        :disabled="!sePuede"
                        :title="sePuede ? undefined : textoFalta"
                        data-prueba="declarar"
                        @click="declararAbierto = true"
                    />
                </PanelBarraAccion>
            </aside>
        </div>

        <IntentoDecidirModal
            v-model:open="decidirAbierto"
            :intento="aDecidir"
            @hecho="alDecidir"
        />
        <EquipoContactoModal
            v-model:open="contactoAbierto"
            :unidad="unidad"
            @hecho="alContacto"
        />
        <EquipoNoRecuperadoModal
            v-model:open="declararAbierto"
            :unidad="unidad"
            :pendiente="datos ? { intentos: datos.intentos.length, tecnicos_distintos: tecnicos, contactos } : null"
            @hecho="alDeclarar"
        />
    </PanelPagina>
</template>
