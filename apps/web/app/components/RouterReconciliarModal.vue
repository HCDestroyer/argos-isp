<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { VistaPreviaReconciliar } from '~/types/controlVelocidad'
import type { EstadoReconciliacion, ReconciliacionEstado } from '~/types/reconciliacion'

/**
 * «Reconciliar ahora» con vista previa (`routers.reconciliar`, `contratos/control-velocidad.md` §9–§10):
 * primero `GET /routers/:id/vista-previa-reconciliar` (lee el router sin escribir) con lo que se
 * crea, cambia, mueve y borra por grupo (servicio, velocidad, corte), la deriva de la red de acceso
 * administrada (`red_acceso[]`) y los conflictos entre formas de limitar (`conflictos[]`, solo
 * informan); al confirmar,
 * `POST /routers/:id/reconciliar`, que encola el trabajo (202 `ReconciliacionEncolada`; con
 * `encolado: false` ya había uno en curso, no es un error, y se sigue ese). Con el `job_id` sondea
 * `GET /routers/:id/reconciliaciones/:job_id` cada 2 s mientras el modal esté abierto y el trabajo
 * esté en cola o en curso, y muestra cómo terminó: cambios aplicados, errores por operación, fallo
 * con «Reintentar» (vuelve a la vista previa) o resultado desconocido. Al terminar emite
 * `reconciliado` para que el padre recargue lo que muestra del router. Si el router no responde o
 * no tiene credenciales, se ve el error de la API y «Reintentar». Quien lo abre comprueba el permiso.
 */
const props = defineProps<{
    router: Pick<RouterNas, 'id' | 'nombre'>
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    /** El trabajo terminó (completada, fallida o desconocida): el padre recarga lo que muestra. */
    reconciliado: [estado: ReconciliacionEstado]
}>()

/** Cada cuánto se pregunta por el trabajo. */
const INTERVALO_SONDEO_MS = 2_000
/** Tras este tiempo en cola sin que el worker lo tome, se avisa. */
const AVISO_EN_ESPERA_MS = 30_000
const EN_PROCESO: EstadoReconciliacion[] = ['en_espera', 'en_curso']

const vista = shallowRef<VistaPreviaReconciliar | null>(null)
const cargando = ref(false)
const problemaVista = ref<Problem | null>(null)
const aplicando = ref(false)
const problema = ref<Problem | null>(null)
const resultado = shallowRef<ReconciliacionEncolada | null>(null)
/** Último estado leído del trabajo; `null` mientras llega la primera respuesta. */
const estado = shallowRef<ReconciliacionEstado | null>(null)
const problemaEstado = ref<Problem | null>(null)
/** Cuándo se encoló (reloj del panel) y la hora del último sondeo: miden la espera en cola. */
const encoladoDesde = ref(0)
const ahora = ref(0)

type Cambio = VistaPreviaReconciliar['cambios'][number]

const GRUPOS: Record<Cambio['grupo'], { etiqueta: string, icono: string }> = {
    corte: { etiqueta: 'Corte', icono: 'i-lucide-shield-off' },
    velocidad: { etiqueta: 'Velocidad', icono: 'i-lucide-gauge' },
    servicio: { etiqueta: 'Servicios', icono: 'i-lucide-user' },
}
const ACCIONES: Record<Cambio['accion'], string> = { crear: 'Crea', actualizar: 'Cambia', mover: 'Mueve', borrar: 'Borra' }

const numero = { class: { th: 'w-0 text-right', td: 'w-0 text-right tabular-nums' } }
const columnas: TableColumn<VistaPreviaReconciliar['menus'][number]>[] = [
    { accessorKey: 'ruta', header: 'Menú de RouterOS' },
    { accessorKey: 'crear', header: 'Crea', meta: numero },
    { accessorKey: 'actualizar', header: 'Cambia', meta: numero },
    { accessorKey: 'mover', header: 'Mueve', meta: numero },
    { accessorKey: 'borrar', header: 'Borra', meta: numero },
]

/** Deriva de la red de acceso administrada (VLAN, perfil y servidor PPPoE; `red-acceso.md` §6). */
const redAcceso = computed(() => vista.value?.red_acceso ?? [])
/** Formas de limitar que chocan en el router: solo informan, Argos nunca borra lo ajeno. */
const conflictos = computed(() => vista.value?.conflictos ?? [])
const hayCambios = computed(() => Boolean(vista.value?.cambios.length) || redAcceso.value.length > 0)

const grupos = computed(() => (Object.keys(GRUPOS) as Cambio['grupo'][])
    .map(grupo => ({ grupo, cambios: vista.value?.cambios.filter(c => c.grupo === grupo) ?? [] }))
    .filter(g => g.cambios.length))

async function cargar() {
    cargando.value = true
    problemaVista.value = null
    const respuesta = await useControlVelocidad().vistaPreviaReconciliar(props.router.id)
    cargando.value = false
    vista.value = respuesta.ok ? respuesta.data : null
    problemaVista.value = respuesta.ok ? null : respuesta.problema
}

let temporizador: ReturnType<typeof setTimeout> | null = null
/** Sube al detener el sondeo: una respuesta que llega después se descarta. */
let generacion = 0

function detenerSondeo() {
    generacion++
    if (temporizador) {
        clearTimeout(temporizador)
        temporizador = null
    }
}

async function sondear(jobId: string) {
    const propia = generacion
    temporizador = null
    const respuesta = await useRouters().estadoReconciliacion(props.router.id, jobId)
    if (propia !== generacion || !abierto.value) {
        return
    }
    ahora.value = Date.now()
    if (!respuesta.ok) {
        problemaEstado.value = respuesta.problema
        return
    }
    problemaEstado.value = null
    estado.value = respuesta.data
    if (EN_PROCESO.includes(respuesta.data.estado)) {
        temporizador = setTimeout(() => void sondear(jobId), INTERVALO_SONDEO_MS)
        return
    }
    emit('reconciliado', respuesta.data)
}

function reanudarSondeo() {
    if (resultado.value) {
        detenerSondeo()
        void sondear(resultado.value.job_id)
    }
}

/** El estado que se muestra: en cola hasta que llega la primera respuesta. */
const fase = computed<EstadoReconciliacion>(() => estado.value?.estado ?? 'en_espera')
const enProceso = computed(() => EN_PROCESO.includes(fase.value))
const esperaLarga = computed(() => fase.value === 'en_espera' && ahora.value - encoladoDesde.value > AVISO_EN_ESPERA_MS)
const erroresParciales = computed(() => (estado.value?.estado === 'completada' ? estado.value.errores : []))

const tituloCompletada = computed(() => {
    const cambios = estado.value?.cambios ?? 0
    if (cambios === 0) {
        return 'El router ya estaba como debe'
    }
    return cambios === 1 ? 'Listo: 1 cambio aplicado en el router' : `Listo: ${cambios} cambios aplicados en el router`
})

function reiniciar() {
    detenerSondeo()
    vista.value = null
    resultado.value = null
    estado.value = null
    problema.value = null
    problemaEstado.value = null
}

/** «Reintentar» de una reconciliación fallida: vuelve a leer el router y a mostrar la vista previa. */
function volverAVistaPrevia() {
    reiniciar()
    void cargar()
}

watch(abierto, (valor) => {
    reiniciar()
    if (valor) {
        void cargar()
    }
}, { immediate: true })

onBeforeUnmount(detenerSondeo)

async function reconciliar() {
    aplicando.value = true
    problema.value = null
    const respuesta = await useRouters().reconciliar(props.router.id)
    aplicando.value = false
    if (!respuesta.ok) {
        problema.value = respuesta.problema
        return
    }
    resultado.value = respuesta.data
    estado.value = null
    encoladoDesde.value = Date.now()
    ahora.value = encoladoDesde.value
    detenerSondeo()
    void sondear(respuesta.data.job_id)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Reconciliar ahora · ${router.nombre}`"
        description="Argos lee el router y deja colas, perfiles, árbol y reglas de corte como deben estar. Primero ves qué cambiaría; nada se escribe hasta confirmar."
        :dismissible="!aplicando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="reconciliar-modal"
            >
                <USkeleton
                    v-if="cargando"
                    class="h-40 w-full"
                />
                <ProblemaAlerta
                    v-else-if="problemaVista"
                    :problema="problemaVista"
                    :reintentar="cargar"
                    :reintentando="cargando"
                    data-prueba="reconciliar-error-vista"
                />
                <template v-else-if="resultado">
                    <UAlert
                        v-if="!resultado.encolado"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-clock"
                        title="Ya había una reconciliación pedida"
                        description="No se encoló otra: abajo se ve en qué va la que ya estaba."
                        data-prueba="reconciliar-en-curso"
                    />
                    <ProblemaAlerta
                        v-if="problemaEstado"
                        :problema="problemaEstado"
                        :reintentar="reanudarSondeo"
                        data-prueba="reconciliar-error-estado"
                    />
                    <UAlert
                        v-else-if="enProceso"
                        color="info"
                        variant="subtle"
                        :title="fase === 'en_curso' ? 'Aplicando en el router…' : 'En cola…'"
                        :description="fase === 'en_curso'
                            ? `El worker aplica en ${router.nombre} lo que viste en la vista previa, por su API.`
                            : 'El trabajo espera a que el worker de Argos lo tome.'"
                        :data-estado="fase"
                        data-prueba="reconciliar-encolado"
                    >
                        <template #leading>
                            <UIcon
                                name="i-lucide-loader-circle"
                                class="size-5 shrink-0 animate-spin"
                            />
                        </template>
                    </UAlert>
                    <UAlert
                        v-else-if="fase === 'completada' && !erroresParciales.length"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        :title="tituloCompletada"
                        :description="estado?.terminado_en ? `Terminó el ${formatearFechaHora(estado.terminado_en)}. Cada comando queda en los eventos de red del router.` : 'Cada comando queda en los eventos de red del router.'"
                        data-estado="completada"
                        data-prueba="reconciliar-resultado"
                    />
                    <UAlert
                        v-else-if="fase === 'completada'"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :title="erroresParciales.length === 1 ? 'Terminó con 1 error' : `Terminó con ${erroresParciales.length} errores`"
                        data-estado="completada_con_errores"
                        data-prueba="reconciliar-resultado"
                    >
                        <template #description>
                            <p>
                                Estas operaciones no se pudieron aplicar; lo demás sí se aplicó en el router{{ estado?.cambios ? ` (${estado.cambios} ${estado.cambios === 1 ? 'cambio' : 'cambios'})` : '' }}.
                            </p>
                            <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                                <li
                                    v-for="(fallo, indice) in erroresParciales"
                                    :key="indice"
                                    class="break-words [overflow-wrap:anywhere]"
                                    data-prueba="reconciliar-error-operacion"
                                >
                                    <span class="font-mono text-xs">{{ fallo.operacion }}</span> — {{ fallo.mensaje }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <UAlert
                        v-else-if="fase === 'fallida'"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-x"
                        title="La reconciliación falló"
                        :description="estado?.error ?? 'El worker no dijo por qué.'"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', onClick: volverAVistaPrevia }]"
                        data-estado="fallida"
                        data-prueba="reconciliar-resultado"
                    />
                    <UAlert
                        v-else
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-circle-help"
                        title="No se pudo saber el resultado; revisa los eventos de red del router."
                        data-estado="desconocida"
                        data-prueba="reconciliar-resultado"
                    />
                    <UAlert
                        v-if="esperaLarga && !problemaEstado"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-hourglass"
                        title="El worker no ha tomado el trabajo. Revisa que el servicio worker de Argos esté corriendo."
                        data-prueba="reconciliar-espera-larga"
                    />
                </template>
                <template v-else-if="vista">
                    <UAlert
                        v-if="vista.error"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-unplug"
                        title="No se pudo leer el router"
                        :description="vista.error"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', loading: cargando, onClick: cargar }]"
                        data-prueba="reconciliar-sin-lectura"
                    />
                    <UAlert
                        v-else-if="!hayCambios"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        title="El router ya está como Argos lo espera"
                        description="No hay nada que crear, cambiar, mover ni borrar."
                        data-prueba="reconciliar-sin-cambios"
                    />
                    <template v-else>
                        <UTable
                            v-if="vista.menus.length"
                            :data="vista.menus"
                            :columns="columnas"
                            tabindex="0"
                            aria-label="Cambios por menú de RouterOS"
                            data-prueba="reconciliar-menus"
                        />
                        <section
                            v-for="g in grupos"
                            :key="g.grupo"
                            class="flex flex-col gap-1.5"
                            :data-prueba="`reconciliar-grupo-${g.grupo}`"
                        >
                            <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
                                <UIcon
                                    :name="GRUPOS[g.grupo].icono"
                                    class="size-4"
                                />
                                {{ GRUPOS[g.grupo].etiqueta }} · {{ g.cambios.length }}
                            </span>
                            <ul class="flex flex-col divide-y divide-default surface-card">
                                <li
                                    v-for="(cambio, indice) in g.cambios"
                                    :key="indice"
                                    class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                >
                                    <span class="min-w-0 break-all font-mono text-xs">{{ cambio.ruta }} · {{ cambio.clave }}</span>
                                    <UBadge
                                        :label="ACCIONES[cambio.accion]"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </li>
                            </ul>
                        </section>
                        <section
                            v-if="redAcceso.length"
                            class="flex flex-col gap-1.5"
                            data-prueba="reconciliar-red-acceso"
                        >
                            <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
                                <UIcon
                                    name="i-lucide-cable"
                                    class="size-4"
                                />
                                Red de acceso · {{ redAcceso.length }}
                            </span>
                            <ul class="flex flex-col divide-y divide-default surface-card">
                                <li
                                    v-for="(cambio, indice) in redAcceso"
                                    :key="indice"
                                    class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                >
                                    <span class="min-w-0 break-all font-mono text-xs">{{ cambio.ruta }} · {{ cambio.clave }}</span>
                                    <UBadge
                                        :label="ACCIONES[cambio.accion]"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </li>
                            </ul>
                            <p class="text-xs text-muted">
                                Solo lo administrado por Argos: lo adoptado y lo ajeno no se tocan.
                            </p>
                        </section>
                    </template>
                    <UAlert
                        v-for="conflicto in conflictos"
                        :key="conflicto.codigo"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-swords"
                        :title="conflicto.mensaje"
                        :data-conflicto="conflicto.codigo"
                    >
                        <template #description>
                            <p class="text-xs">
                                Solo informa: Argos nunca borra lo que no es suyo. Revísalo en el router.
                            </p>
                            <ul
                                v-if="conflicto.objetos.length"
                                class="mt-1 flex flex-col gap-0.5 font-mono text-xs"
                            >
                                <li
                                    v-for="objeto in conflicto.objetos"
                                    :key="objeto"
                                    class="break-all"
                                >
                                    {{ objeto }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <UAlert
                        v-if="vista.avisos.length"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="Avisos"
                        data-prueba="reconciliar-avisos"
                    >
                        <template #description>
                            <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                                <li
                                    v-for="(aviso, indice) in vista.avisos"
                                    :key="indice"
                                    class="break-words [overflow-wrap:anywhere]"
                                >
                                    {{ aviso }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        :reintentar="reconciliar"
                        :reintentando="aplicando"
                        data-prueba="reconciliar-error"
                    />
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <UButton
                    :label="resultado ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="aplicando"
                    class="justify-center"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!resultado"
                    label="Reconciliar ahora"
                    icon="i-lucide-refresh-cw"
                    :loading="aplicando"
                    :disabled="!vista || !!vista.error || !hayCambios"
                    class="justify-center"
                    data-prueba="reconciliar-confirmar"
                    @click="reconciliar"
                />
            </div>
        </template>
    </UModal>
</template>
