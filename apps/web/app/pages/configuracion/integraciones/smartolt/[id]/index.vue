<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de una instancia de SmartOLT (tableros PendSmartoltDetalle y PendSmartoltMovil): datos de
 * la cuenta (token `***`), empresas que la usan, última prueba (cuánto tardó y quién) y sus OLT, cada
 * una con el selector para ligarla a una OLT de la red de acceso de Argos y sus perfiles por plan.
 * «Probar conexión» y «Sincronizar OLT» son la misma llamada a SmartOLT. Una compartida, sin alcance
 * global, se ve sin poder cambiarla.
 */
definePageMeta({ permiso: 'smartolt.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
const { alcanceGlobal, nombre, empresas } = useEmpresaActiva()
const id = computed(() => Number(route.params.id))

const instancia = shallowRef<InstanciaSmartOlt | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const probando = ref(false)
const cambiando = ref(false)
const ligadasPorNombre = ref<number[]>([])
const ultimaPrueba = shallowRef<PruebaInstanciaSmartOlt | null>(null)

useHead(() => ({ title: `${instancia.value?.nombre ?? 'Instancia'} · SmartOLT · ArgosIsp` }))

/** Solo lectura: compartida y sin alcance global (la API respondería 403). */
const soloLectura = computed(() => Boolean(instancia.value?.compartida && !alcanceGlobal.value))
const presentacion = computed(() => (instancia.value ? estadoInstancia(instancia.value) : null))

async function cargar() {
    cargando.value = true
    const r = await useSmartOlt().ver(id.value)
    cargando.value = false
    instancia.value = r.ok ? r.data : null
    problema.value = r.ok ? null : r.problema
}

async function probar() {
    if (!instancia.value) {
        return
    }
    probando.value = true
    const r = await useSmartOlt().probar(instancia.value.id)
    probando.value = false
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    instancia.value = r.data.instancia
    ultimaPrueba.value = r.data
    ligadasPorNombre.value = r.data.vinculadas_por_nombre.map(v => v.id)
    if (r.data.ok) {
        sincronizadoAbierto.value = true
    }
    else {
        toast.add({ title: 'SmartOLT no respondió', description: r.data.error ?? undefined, icon: 'i-lucide-circle-alert', color: 'error' })
    }
}

async function cambiar(cambios: CambiosInstanciaSmartOlt, mensaje: string) {
    if (!instancia.value) {
        return
    }
    cambiando.value = true
    const r = await useSmartOlt().editar(instancia.value.id, instancia.value.version, cambios)
    cambiando.value = false
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        void cargar()
        return false
    }
    instancia.value = r.data
    toast.add({ title: mensaje, icon: 'i-lucide-circle-check', color: 'success' })
    return true
}

/* Apagar (con confirmación) y encender. */
const apagarAbierto = ref(false)
async function apagar() {
    if (await cambiar({ activo: false }, 'Instancia apagada')) {
        apagarAbierto.value = false
    }
}

/* Eliminar (con confirmación; 409 instancia_en_uso). */
const eliminarAbierto = ref(false)
const problemaEliminar = ref<Problem | null>(null)
async function eliminar() {
    if (!instancia.value) {
        return
    }
    cambiando.value = true
    const r = await useSmartOlt().eliminar(instancia.value.id)
    cambiando.value = false
    if (!r.ok) {
        problemaEliminar.value = r.problema
        return
    }
    eliminarAbierto.value = false
    toast.add({ title: 'Instancia eliminada', icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo('/configuracion/integraciones?ver=smartolt')
}

const sincronizadoAbierto = ref(false)

/* OLT de Argos para ligar (`red_acceso.ver`) y las ya ligadas en cualquier instancia visible. */
const oltsArgos = shallowRef<Olt[] | null>(null)
const ligadasEnOtras = shallowRef<Map<number, string>>(new Map())

async function cargarOltsArgos() {
    if (!puede('red_acceso.ver')) {
        return
    }
    const r = await useOlts().listar()
    oltsArgos.value = r.ok ? r.data.data : null
    const todas = await useSmartOlt().listar()
    if (todas.ok) {
        ligadasEnOtras.value = new Map(todas.data.flatMap(i => i.olts.filter(o => o.olt).map(o => [o.olt!.id, o.nombre ?? o.smartolt_olt_id] as [number, string])))
    }
}

function itemsLigar(olt: OltSmartOlt) {
    const lista = (oltsArgos.value ?? []).map((o) => {
        const ligadaA = ligadasEnOtras.value.get(o.id)
        const otraEmpresa = o.empresa_id !== null && instancia.value?.empresa_id !== null && instancia.value?.empresa_id !== undefined && o.empresa_id !== instancia.value.empresa_id
        const ocupada = ligadaA !== undefined && olt.olt?.id !== o.id
        return {
            label: o.nombre,
            value: o.id,
            icon: 'i-lucide-server',
            description: otraEmpresa ? 'De otra empresa: no se puede ligar aquí' : ocupada ? `Ya ligada a ${ligadaA}` : o.empresa_id === null ? 'Compartida' : nombre(o.empresa_id),
            disabled: otraEmpresa || ocupada,
        }
    })
    return lista
}

/* Mientras se liga o se recarga, los selectores quedan deshabilitados: las opciones «Ya ligada a…» salen de la recarga. */
const ligando = ref(false)

async function ligar(olt: OltSmartOlt, oltArgosId: number | null) {
    ligando.value = true
    try {
        const r = await useSmartOlt().vincular(olt.id, oltArgosId)
        if (!r.ok) {
            toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
            return
        }
        ligadasPorNombre.value = ligadasPorNombre.value.filter(x => x !== olt.id)
        // primero se recarga y después se avisa: quien ve el aviso ya encuentra las opciones al día
        await Promise.all([cargar(), cargarOltsArgos()])
        toast.add({ title: oltArgosId ? `${olt.nombre ?? olt.smartolt_olt_id} ligada a ${r.data.olt?.nombre}` : 'Vínculo quitado', icon: 'i-lucide-link', color: 'success' })
    }
    finally {
        ligando.value = false
    }
}

function menuOlt(olt: OltSmartOlt): DropdownMenuItem[] {
    return [
        { label: 'Perfiles por plan', icon: 'i-lucide-list', onSelect: () => abrirPerfiles(olt) },
        ...(olt.olt ? [{ label: 'Quitar vínculo', icon: 'i-lucide-unlink', color: 'error' as const, onSelect: () => void ligar(olt, null) }] : []),
    ]
}

/* Perfiles de una OLT (plan → preset). */
const planes = shallowRef<Plan[]>([])
const perfilesDe = ref<OltSmartOlt | null>(null)
const perfiles = ref<Array<{ plan_id: number | null, authorization_preset_id: number, pon_type: 'gpon' | 'epon' }>>([])
const perfilesAbierto = computed({
    get: () => perfilesDe.value !== null,
    set: (v) => {
        if (!v) {
            perfilesDe.value = null
        }
    },
})
const itemsPlanes = computed(() => [{ label: 'Cualquier plan', value: 0 }, ...planes.value.map(p => ({ label: p.nombre, value: p.id }))])
const nombrePlan = (planId: number | null) => (planId === null ? 'Cualquier plan' : planes.value.find(p => p.id === planId)?.nombre ?? `Plan ${planId}`)

function abrirPerfiles(olt: OltSmartOlt) {
    perfilesDe.value = olt
    perfiles.value = olt.perfiles.map(p => ({ ...p }))
}

async function guardarPerfiles() {
    const actual = instancia.value
    const olt = perfilesDe.value
    if (!actual || !olt) {
        return
    }
    const invalido = perfiles.value.some(p => !Number.isInteger(p.authorization_preset_id) || p.authorization_preset_id < 1)
    if (invalido) {
        toast.add({ title: 'Revisa los perfiles', description: 'El preset es un número desde 1.', icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const todos = actual.olts.flatMap(o => (o.id === olt.id ? perfiles.value : o.perfiles).map(p => ({ smartolt_olt_id: o.smartolt_olt_id, ...p })))
    if (await cambiar({ perfiles: todos }, 'Perfiles guardados')) {
        perfilesDe.value = null
    }
}

const editable = computed(() => puede('smartolt.editar_instancia') && !soloLectura.value)

onMounted(async () => {
    await cargar()
    void cargarOltsArgos()
    if (puede('planes.ver')) {
        const r = await usePlanes().listar()
        planes.value = r.ok ? r.data.data : []
    }
})
</script>

<template>
    <ConfiguracionMarco
        id="smartolt-instancia"
        :titulo="instancia?.nombre ?? 'Instancia de SmartOLT'"
        :descripcion="instancia ? hostDe(instancia.url) : undefined"
        volver="/configuracion/integraciones?ver=smartolt"
    >
        <template #acciones>
            <template v-if="instancia && !soloLectura">
                <UButton
                    v-if="editable && instancia.activo"
                    label="Apagar"
                    icon="i-lucide-power"
                    color="neutral"
                    variant="outline"
                    data-prueba="instancia-apagar"
                    @click="apagarAbierto = true"
                />
                <UButton
                    v-else-if="editable"
                    label="Encender"
                    icon="i-lucide-power"
                    color="neutral"
                    variant="outline"
                    :loading="cambiando"
                    data-prueba="instancia-encender"
                    @click="cambiar({ activo: true }, 'Instancia encendida')"
                />
                <UButton
                    v-if="puede('smartolt.probar_instancia')"
                    label="Probar conexión"
                    icon="i-lucide-refresh-cw"
                    :loading="probando"
                    class="glow-brand"
                    data-prueba="instancia-probar"
                    @click="probar"
                />
            </template>
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!instancia || !presentacion"
            class="h-96 w-full"
        />
        <div
            v-else
            class="flex min-w-0 flex-col gap-3"
            data-prueba="instancia-detalle"
        >
            <div class="flex flex-wrap items-center gap-2">
                <UBadge
                    :label="presentacion.etiqueta"
                    :icon="presentacion.icono"
                    :color="presentacion.color"
                    variant="subtle"
                    data-prueba="instancia-estado"
                />
                <UBadge
                    v-if="instancia.compartida"
                    label="Compartida"
                    icon="i-lucide-globe"
                    color="info"
                    variant="subtle"
                />
                <UBadge
                    v-if="!instancia.activo"
                    label="Apagada"
                    icon="i-lucide-power"
                    color="neutral"
                    variant="subtle"
                />
            </div>

            <UAlert
                v-if="soloLectura"
                color="info"
                variant="subtle"
                icon="i-lucide-lock"
                data-prueba="instancia-solo-lectura"
            >
                <template #description>
                    <b>Instancia compartida.</b> La usan todas las empresas y solo la cambia quien tiene acceso a todas. Tú la puedes ver, pero no cambiarla ni ligar sus OLT: eso lo hace un administrador global.
                </template>
            </UAlert>
            <UAlert
                v-else-if="instancia.prueba_ok === false"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :actions="editable ? [{ label: 'Cambiar token', color: 'neutral', variant: 'outline', to: `/configuracion/integraciones/smartolt/${instancia.id}/editar` }] : []"
                data-prueba="instancia-aviso-falla"
            >
                <template #description>
                    <b>La última prueba falló.</b> {{ instancia.prueba_error }}. Mientras no funcione no se autorizan ONU nuevas con esta instancia ni se lee su estado. Cambia el token o revisa que la clave no esté limitada a otra zona.
                </template>
            </UAlert>
            <UAlert
                v-else-if="instancia.prueba_ok === null"
                color="info"
                variant="subtle"
                icon="i-lucide-info"
                data-prueba="instancia-aviso-sin-probar"
            >
                <template #description>
                    <b>Todavía no se ha probado.</b> Prueba la conexión para comprobar el token y traer las OLT de esta cuenta.
                </template>
            </UAlert>

            <div class="grid min-w-0 gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
                <div class="flex min-w-0 flex-col gap-3">
                    <ConfiguracionBloque
                        titulo="Datos de la cuenta"
                        icono="i-lucide-user-round"
                        :accion="editable ? 'Editar' : undefined"
                        :accion-a="`/configuracion/integraciones/smartolt/${instancia.id}/editar`"
                    >
                        <ConfiguracionFila etiqueta="Nombre en Argos">
                            <b>{{ instancia.nombre }}</b>
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Subdominio"
                            :valor="hostDe(instancia.url)"
                            mono
                        />
                        <ConfiguracionFila etiqueta="Token">
                            <span class="flex items-center gap-2"><span class="font-mono">***</span>
                                <UButton
                                    v-if="editable"
                                    label="Cambiar"
                                    variant="link"
                                    size="sm"
                                    class="p-0"
                                    :to="`/configuracion/integraciones/smartolt/${instancia.id}/editar`"
                                /></span>
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Encendida"
                            ayuda="Argos la usa para autorizar y ver ONU"
                        >
                            <USwitch
                                :model-value="instancia.activo"
                                :disabled="!editable || cambiando"
                                aria-label="Encendida"
                                data-prueba="instancia-encendida"
                                @update:model-value="v => (v ? cambiar({ activo: true }, 'Instancia encendida') : (apagarAbierto = true))"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-if="instancia.nota"
                            etiqueta="Nota"
                            :valor="instancia.nota"
                        />
                        <UButton
                            v-if="puede('smartolt.eliminar_instancia') && !soloLectura"
                            label="Eliminar esta instancia"
                            icon="i-lucide-trash-2"
                            color="error"
                            variant="link"
                            class="mt-1 self-start p-0"
                            data-prueba="instancia-eliminar"
                            @click="problemaEliminar = null; eliminarAbierto = true"
                        />
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        titulo="Empresas que la usan"
                        icono="i-lucide-building"
                    >
                        <template v-if="instancia.compartida">
                            <ConfiguracionFila
                                v-for="e in empresas"
                                :key="e.id"
                                :etiqueta="e.nombre_comercial"
                            >
                                <UBadge
                                    label="Compartida"
                                    icon="i-lucide-globe"
                                    color="info"
                                    variant="subtle"
                                    size="sm"
                                />
                            </ConfiguracionFila>
                            <p class="pt-1 text-xs text-muted">
                                Todas las empresas de la instalación pueden usarla. Los servicios de cada una siguen con su empresa.
                            </p>
                        </template>
                        <template v-else>
                            <ConfiguracionFila :etiqueta="nombre(instancia.empresa_id)">
                                <UBadge
                                    label="Dueña"
                                    icon="i-lucide-check"
                                    color="success"
                                    variant="subtle"
                                    size="sm"
                                />
                            </ConfiguracionFila>
                            <p class="pt-1 text-xs text-muted">
                                Solo esta empresa la ve y la usa. Para que otra la use, hay que volverla compartida (lo hace quien tiene acceso a todas).
                            </p>
                        </template>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        titulo="Última prueba"
                        icono="i-lucide-clock"
                    >
                        <ConfiguracionFila etiqueta="Resultado">
                            <UBadge
                                :label="presentacion.etiqueta"
                                :icon="presentacion.icono"
                                :color="presentacion.color"
                                variant="subtle"
                                size="sm"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-if="instancia.prueba_ok === false"
                            etiqueta="Qué pasó"
                        >
                            <span class="text-sm text-error">{{ instancia.prueba_error }}</span>
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-else-if="instancia.prueba_latencia_ms !== null"
                            etiqueta="Respondió en"
                            :valor="`${instancia.prueba_latencia_ms} ms`"
                        />
                        <ConfiguracionFila
                            etiqueta="Cuándo"
                            :valor="cuandoPrueba(instancia.probado_en, instancia.probado_por)"
                        />
                        <ConfiguracionFila
                            etiqueta="OLT traídas"
                            :valor="instancia.olts_sincronizadas_en ? String(instancia.olts.length) : '—'"
                        />
                    </ConfiguracionBloque>
                </div>

                <section
                    class="flex min-w-0 flex-col rounded-2xl border border-(--ax-borde)"
                    data-prueba="instancia-olts"
                >
                    <div class="flex flex-wrap items-center gap-3 border-b border-(--ax-borde) p-4">
                        <span class="pastilla-icono pastilla-tono tono-marca">
                            <UIcon
                                name="i-lucide-server"
                                class="size-5"
                            />
                        </span>
                        <div class="min-w-0 flex-1">
                            <p class="font-bold text-highlighted">
                                OLT de esta instancia
                                <UBadge
                                    :label="String(instancia.olts.length)"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                    class="ms-1"
                                />
                            </p>
                            <p class="text-sm text-muted">
                                Las trae SmartOLT. Liga cada una con su OLT de la red de acceso de Argos.
                            </p>
                        </div>
                        <UButton
                            v-if="puede('smartolt.probar_instancia') && !soloLectura"
                            label="Sincronizar OLT"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :loading="probando"
                            data-prueba="instancia-sincronizar"
                            @click="probar"
                        />
                    </div>
                    <div
                        v-if="!instancia.olts.length"
                        class="flex flex-col items-center gap-2 px-4 py-10 text-center"
                    >
                        <span class="pastilla-icono pastilla-tono tono-neutro size-14 rounded-2xl">
                            <UIcon
                                name="i-lucide-server"
                                class="size-7"
                            />
                        </span>
                        <p class="font-bold">
                            Aún no hay OLT
                        </p>
                        <p class="max-w-sm text-sm text-muted">
                            Prueba la conexión: con la misma llamada se comprueba el token y se traen las OLT de esta cuenta.
                        </p>
                    </div>
                    <template v-else>
                        <div class="hidden grid-cols-[minmax(0,1fr)_minmax(10rem,1.2fr)_5.5rem_2rem] gap-3 bg-(--ax-cabecera-tabla) px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
                            <span>OLT en SmartOLT</span>
                            <span>OLT en Argos</span>
                            <span>Perfiles</span>
                            <span />
                        </div>
                        <div
                            v-for="olt in instancia.olts"
                            :key="olt.id"
                            class="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-2 border-t border-(--ax-borde) px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(10rem,1.2fr)_5.5rem_2rem]"
                            :class="olt.presente ? '' : 'opacity-80'"
                            :data-olt="olt.smartolt_olt_id"
                        >
                            <div class="min-w-0">
                                <p class="truncate font-semibold text-highlighted">
                                    {{ olt.nombre ?? `OLT ${olt.smartolt_olt_id}` }}
                                </p>
                                <p class="truncate text-xs text-muted">
                                    {{ olt.hardware ?? 'Sin datos' }}<template v-if="olt.ip">
                                        · <span class="font-mono">{{ olt.ip }}</span>
                                    </template>
                                </p>
                                <UBadge
                                    v-if="!olt.presente"
                                    label="Ya no aparece en SmartOLT"
                                    icon="i-lucide-triangle-alert"
                                    color="warning"
                                    variant="subtle"
                                    size="sm"
                                    class="mt-1"
                                />
                            </div>
                            <UDropdownMenu
                                v-if="editable"
                                :items="menuOlt(olt)"
                                class="md:order-last"
                            >
                                <UButton
                                    icon="i-lucide-ellipsis"
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="`Más de ${olt.nombre ?? olt.smartolt_olt_id}`"
                                />
                            </UDropdownMenu>
                            <span
                                v-else
                                class="md:order-last"
                            />
                            <div class="col-span-2 min-w-0 md:col-span-1">
                                <USelectMenu
                                    v-if="puede('smartolt.vincular_olt') && !soloLectura && oltsArgos"
                                    :model-value="olt.olt?.id"
                                    :items="itemsLigar(olt)"
                                    value-key="value"
                                    :placeholder="'Elegir OLT de Argos'"
                                    icon="i-lucide-server"
                                    :color="olt.olt ? 'neutral' : 'warning'"
                                    :highlight="!olt.olt"
                                    :disabled="ligando"
                                    class="w-full min-w-40 max-w-72"
                                    :data-prueba="`ligar-${olt.smartolt_olt_id}`"
                                    @update:model-value="v => ligar(olt, typeof v === 'number' ? v : null)"
                                />
                                <span
                                    v-else
                                    class="text-sm"
                                    :class="olt.olt ? '' : 'text-muted'"
                                >{{ olt.olt?.nombre ?? 'Sin ligar' }}</span>
                                <p
                                    v-if="ligadasPorNombre.includes(olt.id) && olt.olt"
                                    class="mt-1 flex items-center gap-1 text-xs text-muted"
                                >
                                    <UIcon
                                        name="i-lucide-link"
                                        class="size-3"
                                    />Ligada sola por el nombre
                                </p>
                            </div>
                            <span class="col-span-2 text-sm text-muted md:col-span-1">{{ textoPerfiles(olt.perfiles.length) }}</span>
                        </div>
                        <p class="border-t border-(--ax-borde) px-4 py-2.5 text-xs text-muted">
                            Traídas de SmartOLT<template v-if="instancia.prueba_ok === false && instancia.olts_sincronizadas_en">
                                la última vez que funcionó ({{ formatearFechaHora(instancia.olts_sincronizadas_en) }})
                            </template> · una OLT que se ligó sola por el nombre se puede cambiar cuando quieras.
                        </p>
                    </template>
                </section>
            </div>
        </div>

        <UModal
            v-model:open="apagarAbierto"
            :title="`¿Apagar «${instancia?.nombre}»?`"
            :dismissible="!cambiando"
        >
            <template #body>
                <p class="text-sm text-muted">
                    Mientras esté apagada, Argos no autoriza ONU nuevas ni lee su estado con esta cuenta. Los aprovisionamientos en proceso <b>no se pierden</b>: fallan y se reintentan cuando la vuelvas a encender. Tus datos y vínculos quedan igual.
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Volver"
                        color="neutral"
                        variant="ghost"
                        @click="apagarAbierto = false"
                    />
                    <UButton
                        label="Apagar"
                        icon="i-lucide-power"
                        :loading="cambiando"
                        data-prueba="confirmar-apagar"
                        @click="apagar"
                    />
                </div>
            </template>
        </UModal>

        <UModal
            v-model:open="sincronizadoAbierto"
            :title="`Se sincronizaron ${instancia?.olts.filter(o => o.presente).length ?? 0} OLT`"
        >
            <template #body>
                <p
                    class="text-sm text-muted"
                    data-prueba="resultado-sincronizar"
                >
                    <template v-if="ultimaPrueba?.vinculadas_por_nombre.length">
                        {{ ultimaPrueba.vinculadas_por_nombre.length === 1 ? '1 OLT nueva se ligó sola' : `${ultimaPrueba.vinculadas_por_nombre.length} OLT nuevas se ligaron solas` }} porque se llaman igual que una de Argos:
                        <b>{{ ultimaPrueba.vinculadas_por_nombre.map(v => `${instancia?.olts.find(o => o.id === v.id)?.nombre ?? v.smartolt_olt_id} → ${instancia?.olts.find(o => o.id === v.id)?.olt?.nombre ?? ''}`).join(', ') }}</b>.
                    </template>
                    Las demás están sin ligar o ya ligadas. Revisa la lista.
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end">
                    <UButton
                        label="Entendido"
                        icon="i-lucide-check"
                        @click="sincronizadoAbierto = false"
                    />
                </div>
            </template>
        </UModal>

        <UModal
            v-model:open="eliminarAbierto"
            :title="`¿Eliminar «${instancia?.nombre}»?`"
            :dismissible="!cambiando"
        >
            <template #body>
                <div class="flex flex-col gap-3">
                    <p class="text-sm text-muted">
                        Se borran sus {{ instancia?.olts.length ?? 0 }} OLT y sus {{ instancia?.olts.reduce((n, o) => n + o.perfiles.length, 0) ?? 0 }} perfiles de autorización. <b>No se puede mientras haya equipos gestionados o pedidos en proceso</b> con esta instancia: si los hay, Argos te avisa y no borra nada.
                    </p>
                    <ProblemaAlerta
                        v-if="problemaEliminar"
                        :problema="problemaEliminar"
                    />
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Volver"
                        color="neutral"
                        variant="ghost"
                        @click="eliminarAbierto = false"
                    />
                    <UButton
                        label="Eliminar"
                        color="error"
                        :loading="cambiando"
                        data-prueba="confirmar-eliminar"
                        @click="eliminar"
                    />
                </div>
            </template>
        </UModal>

        <UModal
            v-model:open="perfilesAbierto"
            :title="`Perfiles de ${perfilesDe?.nombre ?? perfilesDe?.smartolt_olt_id ?? ''}`"
            description="Qué perfil de autorización (preset) de SmartOLT usa esta OLT para cada plan."
            :ui="{ content: 'sm:max-w-xl' }"
        >
            <template #body>
                <div
                    class="flex flex-col gap-2"
                    data-prueba="perfiles-olt"
                >
                    <p
                        v-if="!perfiles.length"
                        class="text-sm text-muted"
                    >
                        Sin perfiles: una ONT en esta OLT no se puede autorizar hasta que tenga uno.
                    </p>
                    <div
                        v-for="(perfil, i) in perfiles"
                        :key="i"
                        class="grid items-end gap-2 rounded-xl border border-(--ax-borde) p-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto]"
                    >
                        <UFormField label="Plan">
                            <USelect
                                :model-value="perfil.plan_id ?? 0"
                                :items="itemsPlanes"
                                class="w-full"
                                :aria-label="nombrePlan(perfil.plan_id)"
                                @update:model-value="v => perfil.plan_id = v ? Number(v) : null"
                            />
                        </UFormField>
                        <UFormField label="Preset">
                            <UInputNumber
                                v-model="perfil.authorization_preset_id"
                                :min="1"
                                :increment="false"
                                :decrement="false"
                                :format-options="{ useGrouping: false }"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField label="Tipo">
                            <USelect
                                v-model="perfil.pon_type"
                                :items="[{ label: 'GPON', value: 'gpon' }, { label: 'EPON', value: 'epon' }]"
                                class="w-full"
                            />
                        </UFormField>
                        <UButton
                            icon="i-lucide-trash-2"
                            color="neutral"
                            variant="ghost"
                            aria-label="Quitar este perfil"
                            @click="perfiles.splice(i, 1)"
                        />
                    </div>
                    <UButton
                        label="Agregar perfil"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="self-start"
                        data-prueba="agregar-perfil"
                        @click="perfiles.push({ plan_id: null, authorization_preset_id: 1, pon_type: 'gpon' })"
                    />
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        @click="perfilesDe = null"
                    />
                    <UButton
                        label="Guardar perfiles"
                        icon="i-lucide-check"
                        :loading="cambiando"
                        data-prueba="guardar-perfiles"
                        @click="guardarPerfiles"
                    />
                </div>
            </template>
        </UModal>
    </ConfiguracionMarco>
</template>
