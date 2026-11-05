<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Pestaña «Red de acceso» del router (`contratos/red-acceso.md` §7, A1): el árbol interfaz → VLAN
 * (con su OLT y puerto PON) → servidor PPPoE → red IPv4 y pools IPv6, con el `local-address`
 * (solo lectura: sale del gateway de la red) y los servicios de cada servidor; filtros por OLT y
 * puerto PON. Crear y editar con los permisos de cada acción; lo adoptado del router se ve con
 * candado (Argos no lo toca). «Detectar en el router» e «Importar» en `RedAccesoDescubrir`.
 */
const props = defineProps<{
    router: RouterNas
}>()

const { puede } = usePermisos()
const toast = useToast()

const red = shallowRef<RedAccesoRouter | null>(null)
const direccionamiento = shallowRef<DireccionamientoRouter | null>(null)
const olts = shallowRef<Olt[]>([])
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const [lectura, redes, catalogo] = await Promise.all([
        useRedAcceso().ver(props.router.id),
        useRouters().direccionamiento(props.router.id),
        useOlts().listar(),
    ])
    cargando.value = false
    red.value = lectura.ok ? lectura.data : null
    problema.value = lectura.ok ? null : lectura.problema
    direccionamiento.value = redes.ok ? redes.data : null
    olts.value = catalogo.ok ? catalogo.data.data : []
}

watch(() => props.router.id, () => void cargar(), { immediate: true })

/* Filtros por OLT y puerto PON. */
const TODOS = 0
const oltFiltro = ref<number>(TODOS)
const puertoFiltro = ref<number>(TODOS)
watch(oltFiltro, () => {
    puertoFiltro.value = TODOS
})

const itemsOlt = computed<SelectItem[]>(() => [
    { label: 'Todas las OLT', value: TODOS },
    ...(red.value?.olts ?? []).map(o => ({ label: o.nombre, value: o.id })),
])
const itemsPuerto = computed<SelectItem[]>(() => [
    { label: 'Todos los puertos', value: TODOS },
    ...(red.value?.olts.find(o => o.id === oltFiltro.value)?.puertos ?? []).map(p => ({ label: p.identificador, value: p.id })),
])

const vlansVisibles = computed(() => (red.value?.vlans ?? []).filter((vlan) => {
    if (oltFiltro.value !== TODOS && vlan.puerto_pon?.olt_id !== oltFiltro.value) {
        return false
    }
    return puertoFiltro.value === TODOS || vlan.puerto_pon_id === puertoFiltro.value
}))
const filtrando = computed(() => oltFiltro.value !== TODOS)

function servidorDe(vlan: Vlan): ServidorPppoe | undefined {
    return red.value?.servidores_pppoe.find(s => s.vlan_id === vlan.id)
}

/** Servidores en una interfaz física o bridge (sin VLAN): solo sin filtro de OLT. */
const sinVlan = computed(() => (filtrando.value ? [] : (red.value?.servidores_pppoe ?? []).filter(s => s.vlan_id === null)))

function redDe(servidor: ServidorPppoe) {
    return direccionamiento.value?.redes_ipv4.find(r => r.id === servidor.red_ipv4_id) ?? null
}

function poolDe(id: number | null) {
    return id ? (direccionamiento.value?.bloques_ipv6 ?? []).flatMap(b => b.pools).find(p => p.id === id) ?? null : null
}

const ESTADOS: Record<Vlan['estado'], { etiqueta: string, icono: string, color: 'success' | 'neutral', explicacion: string }> = {
    administrado: { etiqueta: 'De Argos', icono: 'i-lucide-circle-check', color: 'success', explicacion: 'Argos lo escribe en el router con su comentario argosisp.' },
    adoptado: { etiqueta: 'Adoptado', icono: 'i-lucide-lock', color: 'neutral', explicacion: 'Ya existía en el router: Argos no lo toca.' },
}

const vacio = computed(() => red.value !== null && !red.value.vlans.length && !red.value.servidores_pppoe.length)

/* Modales */
const vlanAbierta = ref(false)
const vlanEditada = shallowRef<Vlan | null>(null)
const servidorAbierto = ref(false)
const servidorEditado = shallowRef<ServidorPppoe | null>(null)
const vlanParaServidor = ref<number | null>(null)
const descubrirAbierto = ref(false)
const oltsAbierto = ref(false)
/** Deriva de lo administrado y conflictos: la vista previa de «Reconciliar» (lee el router). */
const derivaAbierta = ref(false)

function abrirVlan(vlan: Vlan | null) {
    vlanEditada.value = vlan
    vlanAbierta.value = true
}

function abrirServidor(servidor: ServidorPppoe | null, vlan: Vlan | null = null) {
    servidorEditado.value = servidor
    vlanParaServidor.value = vlan?.id ?? null
    servidorAbierto.value = true
}

/* Eliminar */
const porEliminar = shallowRef<{ tipo: 'vlan', fila: Vlan } | { tipo: 'servidor', fila: ServidorPppoe } | null>(null)
const eliminarAbierto = ref(false)

function pedirEliminar(objetivo: { tipo: 'vlan', fila: Vlan } | { tipo: 'servidor', fila: ServidorPppoe }) {
    porEliminar.value = objetivo
    eliminarAbierto.value = true
}

const textoEliminar = computed(() => {
    const objetivo = porEliminar.value
    if (!objetivo) {
        return { titulo: '', efecto: '' }
    }
    const enRouter = objetivo.fila.estado === 'administrado' ? ' Argos lo borra también del router (solo lo que tiene su comentario).' : ' Es adoptado: solo se borra de Argos, el router queda igual.'
    return objetivo.tipo === 'vlan'
        ? { titulo: `Eliminar VLAN ${objetivo.fila.vlan_id}`, efecto: `Se quita la VLAN ${objetivo.fila.nombre}.${enRouter}` }
        : { titulo: `Eliminar ${objetivo.fila.nombre}`, efecto: `Se quita el servidor PPPoE.${enRouter}` }
})

function ejecutarEliminar(): Promise<Resultado<null>> {
    const objetivo = porEliminar.value
    if (!objetivo) {
        return Promise.resolve({ ok: true, data: null })
    }
    return objetivo.tipo === 'vlan' ? useRedAcceso().eliminarVlan(objetivo.fila.id) : useRedAcceso().eliminarServidor(objetivo.fila.id)
}

function alEliminar() {
    toast.add({ title: `${textoEliminar.value.titulo.replace('Eliminar ', '')} eliminado`, icon: 'i-lucide-trash-2', color: 'success' })
    void cargar()
}

const OLT_TEXTO = (vlan: Vlan) => (vlan.puerto_pon ? `${vlan.puerto_pon.olt_nombre} · PON ${vlan.puerto_pon.identificador}` : 'Sin puerto PON')
</script>

<template>
    <div
        class="flex flex-col gap-6"
        data-prueba="router-red-acceso"
    >
        <RouterSeccion
            id-titulo="titulo-red-acceso"
            titulo="Red de acceso"
            icono="i-lucide-cable"
            descripcion="Un servidor PPPoE por VLAN y una o dos VLAN por puerto PON. El local-address de cada servidor sale del gateway de su red."
        >
            <template #acciones>
                <UButton
                    v-if="puede('red_acceso.descubrir')"
                    label="Detectar en el router"
                    icon="i-lucide-scan-search"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-descubrir"
                    @click="descubrirAbierto = true"
                />
                <UButton
                    v-if="puede('routers.reconciliar')"
                    label="Revisar deriva"
                    icon="i-lucide-git-compare"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-deriva"
                    @click="derivaAbierta = true"
                />
                <UButton
                    label="OLT y puertos PON"
                    icon="i-lucide-server"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-olts"
                    @click="oltsAbierto = true"
                />
                <UButton
                    v-if="puede('vlans.crear')"
                    label="Nueva VLAN"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    data-prueba="nueva-vlan"
                    @click="abrirVlan(null)"
                />
                <UButton
                    v-if="puede('servidores_pppoe.crear')"
                    label="Nuevo servidor PPPoE"
                    icon="i-lucide-plus"
                    data-prueba="nuevo-servidor-pppoe"
                    @click="abrirServidor(null)"
                />
            </template>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="!red"
                class="h-40 w-full"
            />
            <template v-else>
                <div
                    v-if="red.olts.length"
                    class="flex flex-wrap gap-2"
                >
                    <USelect
                        v-model="oltFiltro"
                        :items="itemsOlt"
                        class="w-full sm:w-52"
                        aria-label="Filtrar por OLT"
                        data-prueba="filtro-olt"
                    />
                    <USelect
                        v-if="oltFiltro !== TODOS"
                        v-model="puertoFiltro"
                        :items="itemsPuerto"
                        class="w-full sm:w-44"
                        aria-label="Filtrar por puerto PON"
                        data-prueba="filtro-puerto"
                    />
                </div>
                <UAlert
                    v-if="red.servicios_sin_servidor > 0 && red.servidores_pppoe.length"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    :title="`${red.servicios_sin_servidor.toLocaleString('es-GT')} ${red.servicios_sin_servidor === 1 ? 'servicio PPPoE sin servidor' : 'servicios PPPoE sin servidor'}`"
                    description="Se asignan al editar cada servicio. Mientras, conservan el perfil de antes."
                    data-prueba="servicios-sin-servidor"
                />
                <UEmpty
                    v-if="vacio"
                    icon="i-lucide-cable"
                    title="Sin red de acceso registrada"
                    description="Crea las VLAN y sus servidores PPPoE, o detecta lo que ya tiene el router y adóptalo."
                    variant="naked"
                    data-prueba="red-acceso-vacia"
                />
                <p
                    v-else-if="!vlansVisibles.length && !sinVlan.length"
                    class="text-sm text-muted"
                >
                    Ninguna VLAN en ese puerto.
                </p>
                <ul
                    v-else
                    class="flex flex-col gap-3"
                    data-prueba="arbol-red-acceso"
                >
                    <li
                        v-for="vlan in vlansVisibles"
                        :key="`vlan-${vlan.id}`"
                        class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
                        :data-vlan="vlan.id"
                    >
                        <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="flex min-w-0 items-start gap-3">
                                <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                    <UIcon
                                        name="i-lucide-tag"
                                        class="size-5"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col gap-0.5">
                                    <span class="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-highlighted">
                                        VLAN {{ vlan.vlan_id }}
                                        <span class="font-mono text-xs font-normal text-muted">{{ vlan.interfaz_padre }} → {{ vlan.nombre }}</span>
                                        <UBadge
                                            :label="ESTADOS[vlan.estado].etiqueta"
                                            :icon="ESTADOS[vlan.estado].icono"
                                            :color="ESTADOS[vlan.estado].color"
                                            :title="ESTADOS[vlan.estado].explicacion"
                                            variant="subtle"
                                            size="sm"
                                        />
                                    </span>
                                    <span class="flex items-center gap-1 text-xs text-muted">
                                        <UIcon
                                            name="i-lucide-server"
                                            class="size-3.5"
                                        />
                                        {{ OLT_TEXTO(vlan) }}
                                    </span>
                                </div>
                            </div>
                            <div class="flex gap-1">
                                <UButton
                                    v-if="puede('vlans.editar')"
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="`Editar VLAN ${vlan.vlan_id}`"
                                    :data-prueba="`editar-vlan-${vlan.id}`"
                                    @click="abrirVlan(vlan)"
                                />
                                <UButton
                                    v-if="puede('vlans.eliminar') && !servidorDe(vlan)"
                                    icon="i-lucide-trash-2"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="`Eliminar VLAN ${vlan.vlan_id}`"
                                    @click="pedirEliminar({ tipo: 'vlan', fila: vlan })"
                                />
                            </div>
                        </div>
                        <RedAccesoServidor
                            v-if="servidorDe(vlan)"
                            :servidor="servidorDe(vlan)!"
                            :red="redDe(servidorDe(vlan)!)"
                            :pool-enlace="poolDe(servidorDe(vlan)!.ipv6_pool_enlace_id)"
                            :pool-delegacion="poolDe(servidorDe(vlan)!.ipv6_pool_delegacion_id)"
                            @editar="abrirServidor(servidorDe(vlan)!)"
                            @eliminar="pedirEliminar({ tipo: 'servidor', fila: servidorDe(vlan)! })"
                        />
                        <div
                            v-else
                            class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-default px-3 py-2 sm:ml-12"
                        >
                            <span class="text-sm text-muted">Sin servidor PPPoE.</span>
                            <UButton
                                v-if="puede('servidores_pppoe.crear')"
                                label="Agregar servidor"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :data-prueba="`agregar-servidor-vlan-${vlan.id}`"
                                @click="abrirServidor(null, vlan)"
                            />
                        </div>
                    </li>
                    <li
                        v-for="servidor in sinVlan"
                        :key="`servidor-${servidor.id}`"
                        class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
                    >
                        <span class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                            <UIcon
                                name="i-lucide-ethernet-port"
                                class="size-5 text-primary"
                            />
                            Interfaz <span class="font-mono">{{ servidor.interfaz }}</span>
                        </span>
                        <RedAccesoServidor
                            :servidor="servidor"
                            :red="redDe(servidor)"
                            :pool-enlace="poolDe(servidor.ipv6_pool_enlace_id)"
                            :pool-delegacion="poolDe(servidor.ipv6_pool_delegacion_id)"
                            @editar="abrirServidor(servidor)"
                            @eliminar="pedirEliminar({ tipo: 'servidor', fila: servidor })"
                        />
                    </li>
                </ul>
            </template>
        </RouterSeccion>

        <VlanModal
            v-if="puede('vlans.crear') || puede('vlans.editar')"
            v-model:open="vlanAbierta"
            :router-id="router.id"
            :vlan="vlanEditada"
            :olts="olts"
            @guardado="cargar"
        />
        <ServidorPppoeModal
            v-if="puede('servidores_pppoe.crear') || puede('servidores_pppoe.editar')"
            v-model:open="servidorAbierto"
            :router-id="router.id"
            :servidor="servidorEditado"
            :vlans="red?.vlans ?? []"
            :servidores="red?.servidores_pppoe ?? []"
            :direccionamiento="direccionamiento"
            :vlan-inicial="vlanParaServidor"
            @guardado="cargar"
        />
        <RedAccesoDescubrir
            v-if="puede('red_acceso.descubrir')"
            v-model:open="descubrirAbierto"
            :router="router"
            :direccionamiento="direccionamiento"
            @importado="cargar"
        />
        <RouterReconciliarModal
            v-if="puede('routers.reconciliar')"
            v-model:open="derivaAbierta"
            :router="router"
        />
        <OltsSlideover
            v-if="puede('red_acceso.ver')"
            v-model:open="oltsAbierto"
            @cambiado="cargar"
        />
        <ConfirmacionModal
            v-if="puede('vlans.eliminar') || puede('servidores_pppoe.eliminar')"
            v-model:open="eliminarAbierto"
            :titulo="textoEliminar.titulo"
            :efecto="textoEliminar.efecto"
            confirmar="Eliminar"
            icono="i-lucide-trash-2"
            :ejecutar="ejecutarEliminar"
            @hecho="alEliminar"
        />
    </div>
</template>
