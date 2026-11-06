<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { RadioGroupItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Cambiar el tipo de conexión de un router con sus servicios, o unificarlos
 * (`contratos/tipo-conexion-router.md` §3). Antes de aplicar se lee la vista previa
 * (`GET /routers/:id/vista-previa-tipo-conexion?tipo=`): qué servicios cambian, qué les falta
 * (bloquea) y qué se completa solo, más los bloqueos del router. «Cambiar» llama
 * `POST /routers/:id/cambiar-tipo-conexion` (`routers.cambiar_tipo_conexion`) con la `version` del
 * router que trajo la vista previa: un 409 pide recargarla y el 422
 * `tipo_conexion_servicios_incompletos` marca a cada servicio lo que le falta. Con el tipo actual es
 * «unificar»: solo pasan los que difieren.
 */
const props = defineProps<{
    router: RouterNas
    /** Tipo con el que abre: otro para cambiar, el actual para unificar. */
    tipoInicial: TipoConexion
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    cambiado: [resultado: ResultadoCambiarTipoConexion]
}>()

const toast = useToast()
const { enlace } = usePermisos()

const tipo = ref<TipoConexion>(props.tipoInicial)
const motivo = ref('')
const vista = shallowRef<VistaPreviaTipoConexion | null>(null)
const cargando = ref(false)
const problemaVista = ref<Problem | null>(null)
const aplicando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const esquemaMotivo = z.string().trim().refine(v => v === '' || (v.length >= 3 && v.length <= 500), 'De 3 a 500 caracteres')
const errorMotivo = computed(() => {
    const resultado = esquemaMotivo.safeParse(motivo.value)
    return resultado.success ? null : (resultado.error.issues[0]?.message ?? null)
})

const itemsTipo = computed<RadioGroupItem[]>(() => itemsTipoConexionRouter(esSinRadius(props.router)).map(item => ({
    ...item,
    label: item.value === props.router.tipo_conexion ? `${item.label} (actual)` : item.label,
})))

const unificar = computed(() => tipo.value === props.router.tipo_conexion)
const cambian = computed(() => (vista.value?.servicios ?? []).filter(s => s.cambia))
const faltantes = computed(() => faltantesDeProblema(problema.value))
const conflicto = computed(() => problema.value?.status === 409)
const sinCambios = computed(() => unificar.value && vista.value !== null && cambian.value.length === 0)
const puedeAplicar = computed(() => vista.value !== null && vista.value.tipo === tipo.value && vista.value.aplicable
    && !sinCambios.value && !errorMotivo.value && !cargando.value)

/** Lo que le falta a un servicio: lo del 422 (lo último que dijo la API) o lo de la vista previa. */
function lineasFalta(servicio: ServicioVistaPreviaTipo): string[] {
    return faltantes.value.get(servicio.servicio_id)
        ?? servicio.faltan.map((falta, indice) => `${FALTAS_TIPO[falta]}: ${servicio.mensajes[indice] ?? ''}`.trim())
}

let lectura = 0
async function cargar() {
    const pedido = ++lectura
    cargando.value = true
    problemaVista.value = null
    const resultado = await useRouters().vistaPreviaTipoConexion(props.router.id, tipo.value)
    if (pedido !== lectura) {
        return
    }
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problemaVista.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    tipo.value = props.tipoInicial
    motivo.value = ''
    problema.value = null
    vista.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
    void cargar()
}, { immediate: true })

watch(tipo, () => {
    if (abierto.value) {
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
        void cargar()
    }
})

/** 409: la vista previa (y su `router_version`) otra vez, con una clave nueva. */
async function recargar() {
    problema.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
    await cargar()
}

async function aplicar() {
    const actual = vista.value
    if (!actual || !puedeAplicar.value) {
        return
    }
    aplicando.value = true
    problema.value = null
    const texto = motivo.value.trim()
    const resultado = await useRouters().cambiarTipoConexion(props.router.id, {
        version: actual.router_version,
        tipo_conexion: tipo.value,
        ...(texto ? { motivo: texto } : {}),
    }, claveIdempotencia)
    aplicando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    emit('cambiado', resultado.data)
    const n = resultado.data.servicios.length
    toast.add({
        title: resultado.data.de === resultado.data.a ? `${props.router.nombre}: servicios unificados` : `${props.router.nombre} ahora es ${TIPOS_CONEXION[resultado.data.a].etiqueta}`,
        description: n === 0 ? 'Ningún servicio tuvo que cambiar.' : `${n} ${n === 1 ? 'servicio pasó' : 'servicios pasaron'} a ${TIPOS_CONEXION[resultado.data.a].etiqueta}.`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
}

/** 422 de faltantes: revisar la vista previa otra vez; fallo del servidor o de red: reintentar. */
const accionProblema = computed(() => {
    const status = problema.value?.status ?? 0
    if (faltantes.value.size) {
        return { accion: recargar, etiqueta: 'Revisar otra vez' }
    }
    return status >= 500 || status === 0 ? { accion: aplicar, etiqueta: 'Reintentar' } : null
})
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="unificar ? `Unificar servicios de ${router.nombre}` : `Cambiar tipo de conexión de ${router.nombre}`"
        description="Uno por router: todos sus servicios lo usan. Revisa qué cambia antes de aplicar."
        :dismissible="!aplicando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="tipo-conexion-modal"
            >
                <UFormField
                    label="Tipo de conexión"
                    name="tipo_conexion"
                >
                    <URadioGroup
                        v-model="tipo"
                        :items="itemsTipo"
                        variant="card"
                        class="w-full"
                        :ui="{ fieldset: 'grid gap-2 sm:grid-cols-3' }"
                        data-prueba="tipo-conexion-elegir"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problemaVista"
                    :problema="problemaVista"
                    :reintentar="cargar"
                    :reintentando="cargando"
                    data-prueba="tipo-conexion-vista-error"
                />
                <USkeleton
                    v-else-if="cargando || !vista"
                    class="h-32 w-full"
                />
                <template v-else>
                    <div
                        class="flex flex-wrap gap-1.5"
                        data-prueba="tipo-conexion-resumen"
                    >
                        <UBadge
                            :label="`${vista.resumen.servicios} ${vista.resumen.servicios === 1 ? 'servicio' : 'servicios'}`"
                            icon="i-lucide-users"
                            color="neutral"
                            variant="subtle"
                        />
                        <UBadge
                            :label="`${vista.resumen.cambian} ${vista.resumen.cambian === 1 ? 'cambia' : 'cambian'}`"
                            icon="i-lucide-arrow-right-left"
                            :color="vista.resumen.cambian ? 'info' : 'neutral'"
                            variant="subtle"
                        />
                        <UBadge
                            v-if="vista.resumen.con_faltantes"
                            :label="`${vista.resumen.con_faltantes} con datos faltantes`"
                            icon="i-lucide-circle-alert"
                            color="error"
                            variant="subtle"
                        />
                        <UBadge
                            v-if="vista.resumen.difieren_del_router"
                            :label="`${vista.resumen.difieren_del_router} no usan el tipo del router`"
                            icon="i-lucide-split"
                            color="warning"
                            variant="subtle"
                        />
                    </div>

                    <UAlert
                        v-for="bloqueo in vista.bloqueos"
                        :key="bloqueo.codigo"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-ban"
                        title="No se puede aplicar"
                        :description="bloqueo.mensaje"
                        data-prueba="tipo-conexion-bloqueo"
                    />
                    <p
                        v-if="sinCambios"
                        class="text-sm text-muted"
                        data-prueba="tipo-conexion-sin-cambios"
                    >
                        Todos los servicios ya usan {{ TIPOS_CONEXION[tipo].etiqueta }}: no hay nada que unificar.
                    </p>
                    <p
                        v-else-if="!cambian.length"
                        class="text-sm text-muted"
                    >
                        Ningún servicio tiene que cambiar: solo cambia el tipo del router (los servicios nuevos lo tomarán).
                    </p>
                    <ul
                        v-else
                        class="flex max-h-80 flex-col divide-y divide-default overflow-y-auto rounded-lg border border-default"
                        data-prueba="tipo-conexion-servicios"
                    >
                        <li
                            v-for="servicio in cambian"
                            :key="servicio.servicio_id"
                            class="flex flex-col gap-1.5 px-3 py-2"
                            :data-servicio="servicio.servicio_id"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <ULink
                                    :to="enlace(`/servicios/${servicio.servicio_id}`)"
                                    class="min-w-0 truncate text-sm font-medium text-highlighted hover:underline"
                                >
                                    {{ servicio.cliente_nombre }}<span
                                        v-if="servicio.user_ppp"
                                        class="font-mono text-muted"
                                    > · {{ servicio.user_ppp }}</span>
                                </ULink>
                                <span class="flex items-center gap-1 text-xs text-muted">
                                    {{ TIPOS_CONEXION[servicio.tipo_conexion].corta }}
                                    <UIcon
                                        name="i-lucide-arrow-right"
                                        class="size-3.5"
                                    />
                                    {{ TIPOS_CONEXION[vista.tipo].corta }}
                                </span>
                            </div>
                            <ul
                                v-if="lineasFalta(servicio).length"
                                class="flex flex-col gap-1"
                            >
                                <li
                                    v-for="(linea, indice) in lineasFalta(servicio)"
                                    :key="indice"
                                    class="flex items-start gap-1.5 text-xs text-error"
                                    data-prueba="tipo-conexion-falta"
                                >
                                    <UIcon
                                        name="i-lucide-circle-alert"
                                        class="mt-0.5 size-3.5 shrink-0"
                                    />
                                    <span>{{ linea }}</span>
                                </li>
                            </ul>
                            <div
                                v-if="servicio.se_completa.length"
                                class="flex flex-wrap gap-1"
                            >
                                <UBadge
                                    v-for="completa in servicio.se_completa"
                                    :key="completa"
                                    :label="COMPLETA_TIPO[completa]"
                                    icon="i-lucide-wand-sparkles"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                            </div>
                        </li>
                    </ul>
                    <p
                        v-if="vista.resumen.con_faltantes"
                        class="text-xs text-muted"
                    >
                        Completa lo que falta en cada servicio (abre su ficha) y vuelve a revisar: nada se aplica a medias.
                    </p>
                    <p
                        v-if="cambian.length"
                        class="text-xs text-muted"
                    >
                        Cada servicio se pasa con su auditoría; el router recibe la configuración nueva y las sesiones de los que cambian se reconectan.
                    </p>

                    <UFormField
                        label="Motivo"
                        name="motivo"
                        hint="Opcional"
                        :error="errorMotivo ?? undefined"
                        help="Queda en la bitácora."
                    >
                        <UTextarea
                            v-model="motivo"
                            :rows="2"
                            :maxlength="500"
                            autoresize
                            class="w-full"
                            data-prueba="tipo-conexion-motivo"
                        />
                    </UFormField>
                </template>

                <UAlert
                    v-if="problema && conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="El router cambió mientras revisabas"
                    description="No se aplicó nada. Recarga la vista previa y revísala otra vez."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: recargar }]"
                    data-prueba="tipo-conexion-conflicto"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    :reintentar="accionProblema?.accion"
                    :etiqueta-reintentar="accionProblema?.etiqueta"
                    :reintentando="aplicando"
                    data-prueba="tipo-conexion-error"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="aplicando"
                    @click="abierto = false"
                />
                <UButton
                    :label="unificar ? 'Unificar' : `Cambiar a ${TIPOS_CONEXION[tipo].etiqueta}`"
                    :icon="unificar ? 'i-lucide-merge' : 'i-lucide-arrow-right-left'"
                    :loading="aplicando"
                    :disabled="!puedeAplicar"
                    data-prueba="tipo-conexion-aplicar"
                    @click="aplicar"
                />
            </div>
        </template>
    </UModal>
</template>
