<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * «Detectar en el router» (`GET /routers/:id/red-acceso/descubrir`, `red_acceso.descubrir`): lee del
 * MikroTik sus VLAN y servidores PPPoE (no escribe) y los marca como nuevos, adoptados o
 * administrados, con las diferencias contra Argos. Se eligen los nuevos y «Importar»
 * (`POST …/adoptar`, `red_acceso.adoptar`) los registra como adoptados: Argos nunca los toca en el
 * router. La red sugerida (la del gateway = local-address de su perfil) ya viene elegida.
 * Con el router caído o sin credenciales de la API responde 502 `router_no_responde`: el error con
 * «Reintentar», sin datos. Un servidor sin el lector de A2 responde 501 `descubrir_no_disponible`:
 * «Todavía no disponible».
 */
const props = defineProps<{
    router: RouterNas
    direccionamiento: DireccionamientoRouter | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    importado: [resultado: ResultadoAdopcion]
}>()

const { puede } = usePermisos()
const toast = useToast()

const leido = shallowRef<DescubrimientoRedAcceso | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const importando = ref(false)
const problemaImportar = ref<Problem | null>(null)
const vlansElegidas = ref<string[]>([])
const servidoresElegidos = ref<string[]>([])
const redes = ref<Record<string, number>>({})
let clave = nuevaClaveIdempotencia()

const SIN_RED = 0
const noDisponible = computed(() => problema.value?.status === 501)

async function leer() {
    cargando.value = true
    problema.value = null
    problemaImportar.value = null
    const resultado = await useRedAcceso().descubrir(props.router.id)
    cargando.value = false
    leido.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    vlansElegidas.value = []
    servidoresElegidos.value = []
    redes.value = resultado.ok
        ? Object.fromEntries(resultado.data.servidores_pppoe.map(s => [s.ros_id, s.red_ipv4_sugerida_id ?? SIN_RED]))
        : {}
    clave = nuevaClaveIdempotencia()
}

watch(abierto, (valor) => {
    if (valor) {
        void leer()
    }
}, { immediate: true })

type EstadoArgos = DescubrimientoRedAcceso['vlans'][number]['argos']['estado']
const ESTADOS: Record<EstadoArgos, { etiqueta: string, color: 'info' | 'neutral' | 'success', icono: string }> = {
    nuevo: { etiqueta: 'Nuevo', color: 'info', icono: 'i-lucide-sparkles' },
    adoptado: { etiqueta: 'Adoptado', color: 'neutral', icono: 'i-lucide-lock' },
    administrado: { etiqueta: 'De Argos', color: 'success', icono: 'i-lucide-circle-check' },
}

const itemsRed = computed<SelectItem[]>(() => [
    { label: 'Sin red (el router asigna)', value: SIN_RED },
    ...(props.direccionamiento?.redes_ipv4 ?? []).map(r => ({ label: r.cidr, value: r.id, description: r.gateway ? `Gateway ${r.gateway}` : 'Sin gateway', disabled: !r.gateway })),
])

function alternar(cual: 'vlans' | 'servidores', rosId: string, valor: boolean | 'indeterminate') {
    const lista = cual === 'vlans' ? vlansElegidas : servidoresElegidos
    lista.value = valor === true ? [...new Set([...lista.value, rosId])] : lista.value.filter(id => id !== rosId)
}

function texto(valor: unknown): string {
    return valor === null || valor === undefined || valor === '' ? '—' : String(valor)
}

const elegidos = computed(() => vlansElegidas.value.length + servidoresElegidos.value.length)

async function importar() {
    if (!leido.value) {
        return
    }
    importando.value = true
    problemaImportar.value = null
    const resultado = await useRedAcceso().adoptar(props.router.id, {
        vlans: vlansElegidas.value.map(ros_id => ({ ros_id })),
        servidores_pppoe: servidoresElegidos.value.map(ros_id => ({ ros_id, red_ipv4_id: redes.value[ros_id] === SIN_RED ? null : (redes.value[ros_id] ?? null) })),
    }, clave)
    importando.value = false
    if (!resultado.ok) {
        problemaImportar.value = resultado.problema
        // El router cambió desde la lectura: se vuelve a leer.
        if (resultado.problema.status === 409) {
            await leer()
            problemaImportar.value = resultado.problema
        }
        return
    }
    const { vlans, servidores_pppoe: servidores } = resultado.data
    toast.add({ title: 'Importado del router', description: `${vlans.length} VLAN y ${servidores.length} servidores PPPoE adoptados. Argos no los toca en el router.`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('importado', resultado.data)
    abierto.value = false
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Detectar en el router · ${router.nombre}`"
        description="Lee del MikroTik sus VLAN y servidores PPPoE. No escribe nada en el router."
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-6"
                data-prueba="descubrir-red-acceso"
            >
                <USkeleton
                    v-if="cargando"
                    class="h-48 w-full"
                />
                <UEmpty
                    v-else-if="noDisponible"
                    icon="i-lucide-clock"
                    title="Todavía no disponible"
                    description="El servidor aún no sabe leer la red de acceso del router. Mientras, puedes crear las VLAN y los servidores a mano."
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'neutral', variant: 'outline', onClick: leer }]"
                    data-prueba="descubrir-no-disponible"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    :reintentar="leer"
                    :reintentando="cargando"
                    data-prueba="descubrir-error-lectura"
                />
                <template v-else-if="leido">
                    <p class="text-xs text-muted">
                        Leído el {{ formatearFechaHora(leido.leido_en) }}.
                    </p>
                    <UAlert
                        v-if="leido.sin_router.length"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="Argos tiene registros que el router ya no tiene"
                        :description="leido.sin_router.map(f => `${f.entidad === 'vlan' ? 'VLAN' : 'Servidor PPPoE'} ${f.nombre}`).join(', ')"
                        data-prueba="descubrir-sin-router"
                    />

                    <section
                        class="flex flex-col gap-2"
                        aria-labelledby="titulo-descubrir-vlans"
                    >
                        <h3
                            id="titulo-descubrir-vlans"
                            class="text-sm font-medium text-highlighted"
                        >
                            VLAN ({{ leido.vlans.length }})
                        </h3>
                        <p
                            v-if="!leido.vlans.length"
                            class="text-sm text-muted"
                        >
                            El router no tiene VLAN.
                        </p>
                        <ul
                            v-else
                            class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        >
                            <li
                                v-for="vlan in leido.vlans"
                                :key="vlan.ros_id"
                                class="flex flex-col gap-1 px-3 py-2"
                                :data-descubierta="vlan.ros_id"
                            >
                                <div class="flex flex-wrap items-center gap-2">
                                    <UCheckbox
                                        v-if="vlan.argos.estado === 'nuevo' && puede('red_acceso.adoptar')"
                                        :model-value="vlansElegidas.includes(vlan.ros_id)"
                                        :aria-label="`Importar la VLAN ${vlan.vlan_id}`"
                                        @update:model-value="valor => alternar('vlans', vlan.ros_id, valor)"
                                    />
                                    <span class="font-mono text-sm text-highlighted">{{ vlan.nombre }}</span>
                                    <span class="text-xs text-muted">VLAN {{ vlan.vlan_id }} en {{ vlan.interfaz_padre }}</span>
                                    <UBadge
                                        :label="ESTADOS[vlan.argos.estado].etiqueta"
                                        :icon="ESTADOS[vlan.argos.estado].icono"
                                        :color="ESTADOS[vlan.argos.estado].color"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </div>
                                <p
                                    v-for="diferencia in vlan.argos.diferencias"
                                    :key="diferencia.campo"
                                    class="text-xs text-warning"
                                >
                                    {{ diferencia.campo }}: Argos {{ texto(diferencia.argos) }} · router {{ texto(diferencia.router) }}
                                </p>
                            </li>
                        </ul>
                    </section>

                    <section
                        class="flex flex-col gap-2"
                        aria-labelledby="titulo-descubrir-servidores"
                    >
                        <h3
                            id="titulo-descubrir-servidores"
                            class="text-sm font-medium text-highlighted"
                        >
                            Servidores PPPoE ({{ leido.servidores_pppoe.length }})
                        </h3>
                        <p
                            v-if="!leido.servidores_pppoe.length"
                            class="text-sm text-muted"
                        >
                            El router no tiene servidores PPPoE.
                        </p>
                        <ul
                            v-else
                            class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        >
                            <li
                                v-for="servidor in leido.servidores_pppoe"
                                :key="servidor.ros_id"
                                class="flex flex-col gap-2 px-3 py-2"
                                :data-descubierto="servidor.ros_id"
                            >
                                <div class="flex flex-wrap items-center gap-2">
                                    <UCheckbox
                                        v-if="servidor.argos.estado === 'nuevo' && puede('red_acceso.adoptar')"
                                        :model-value="servidoresElegidos.includes(servidor.ros_id)"
                                        :aria-label="`Importar el servidor ${servidor.service_name}`"
                                        @update:model-value="valor => alternar('servidores', servidor.ros_id, valor)"
                                    />
                                    <span class="text-sm font-medium text-highlighted">{{ servidor.service_name }}</span>
                                    <span class="font-mono text-xs text-muted">{{ servidor.interfaz }} · perfil {{ servidor.perfil }}</span>
                                    <UBadge
                                        :label="ESTADOS[servidor.argos.estado].etiqueta"
                                        :icon="ESTADOS[servidor.argos.estado].icono"
                                        :color="ESTADOS[servidor.argos.estado].color"
                                        variant="subtle"
                                        size="sm"
                                    />
                                    <UBadge
                                        v-if="servidor.deshabilitado"
                                        label="Deshabilitado"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </div>
                                <p
                                    v-for="diferencia in servidor.argos.diferencias"
                                    :key="diferencia.campo"
                                    class="text-xs text-warning"
                                >
                                    {{ diferencia.campo }}: Argos {{ texto(diferencia.argos) }} · router {{ texto(diferencia.router) }}
                                </p>
                                <UFormField
                                    v-if="servidoresElegidos.includes(servidor.ros_id)"
                                    label="Red IPv4"
                                    :help="servidor.red_ipv4_sugerida_id ? 'Sugerida: su gateway es el local-address del perfil.' : 'Elige la red cuyo gateway es su local-address.'"
                                >
                                    <USelect
                                        v-model="redes[servidor.ros_id]"
                                        :items="itemsRed"
                                        class="w-full"
                                        :data-prueba="`descubrir-red-${servidor.ros_id}`"
                                    />
                                </UFormField>
                            </li>
                        </ul>
                    </section>
                    <ProblemaAlerta
                        v-if="problemaImportar"
                        :problema="problemaImportar"
                        data-prueba="descubrir-error"
                    />
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cerrar"
                    color="neutral"
                    variant="ghost"
                    @click="abierto = false"
                />
                <UButton
                    v-if="leido && puede('red_acceso.adoptar')"
                    :label="elegidos ? `Importar (${elegidos})` : 'Importar'"
                    icon="i-lucide-download"
                    :disabled="!elegidos"
                    :loading="importando"
                    data-prueba="descubrir-importar"
                    @click="importar"
                />
            </div>
        </template>
    </USlideover>
</template>
