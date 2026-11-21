<script setup lang="ts">
import type { RadioGroupItem, TabsItem } from '@nuxt/ui'

/**
 * IP del servicio en el alta (tablero NuevoAltaCliente, paso «Servicio», debajo del router y el
 * plan): control segmentado con tres opciones, dentro del `UForm` del alta.
 *
 * - **Automática** (de fábrica): la API toma la siguiente IP libre de las redes del router. Sin
 *   PPPoE la IP es obligatoria: se reserva al guardar.
 * - **Elegir red**: `red_ipv4_id`; las redes con su ocupación, una llena deshabilitada con el motivo.
 * - **Escribir IP**: `ipv4` fija. Valida el formato y que caiga en una red del router (la red se
 *   deduce de la IP) y, con `ip.resolver`, consulta `GET /ip/:ip` para decir «Libre» u «Ocupada
 *   por S-000123» antes de guardar. El 409 `ip_ocupada`/`ip_en_sesion` de la API llega a este mismo
 *   campo con su texto (`conflictoEnCampo`).
 */
export type ModoIpAlta = 'automatica' | 'red' | 'fija'

const props = defineProps<{
    redes: RedIpv4[]
    router: RouterNas | null
    tipoConexion: TipoConexion
    cargando?: boolean
}>()

const modo = defineModel<ModoIpAlta>('modo', { required: true })
const asignacion = defineModel<'automatica' | 'fija'>('asignacion', { required: true })
const redId = defineModel<number | undefined>('redId', { required: true })
const ipv4 = defineModel<string>('ipv4', { required: true })

const { puede } = usePermisos()

const conPppoe = computed(() => props.tipoConexion === 'pppoe')
const nombreRouter = computed(() => props.router?.nombre ?? 'el router')

const itemsModo: TabsItem[] = [
    { label: 'Automática', value: 'automatica', icon: 'i-lucide-sparkles' },
    { label: 'Elegir red', value: 'red', icon: 'i-lucide-network' },
    { label: 'Escribir IP', value: 'fija', icon: 'i-lucide-pencil' },
]

function llena(red: RedIpv4): boolean {
    return red.ocupacion.libres === 0
}

const primeraConLibres = computed(() => props.redes.find(r => !llena(r)) ?? null)

/** Lleva el modo a los campos que entiende la API (`asignacion`, `red_id`, `ipv4`). */
function aplicarModo(valor: ModoIpAlta) {
    if (valor === 'automatica') {
        asignacion.value = 'automatica'
        redId.value = undefined
    }
    else if (valor === 'red') {
        asignacion.value = 'automatica'
        const actual = props.redes.find(r => r.id === redId.value)
        redId.value = actual && !llena(actual) ? actual.id : primeraConLibres.value?.id
    }
    else {
        asignacion.value = 'fija'
        redId.value = redDeIp(ipv4.value)?.id
    }
}

watch(modo, aplicarModo)
// Router nuevo: sus redes llegan después; en «Elegir red» queda elegida la primera con IP libres.
watch(() => props.redes, () => aplicarModo(modo.value))

const modoTabs = computed({
    get: () => modo.value,
    set: (valor: string | number) => {
        modo.value = valor as ModoIpAlta
    },
})

const itemsRed = computed<RadioGroupItem[]>(() => props.redes.map(red => ({
    label: red.nombre ? `${red.nombre} · ${red.cidr}` : red.cidr,
    value: red.id,
    description: llena(red) ? 'Llena: no quedan IP para entregar' : `${red.ocupacion.libres} de ${red.ocupacion.total} libres`,
    disabled: llena(red),
})))

/* Escribir IP: la red sale de la IP; la disponibilidad, de `GET /ip/:ip`. */
function redDeIp(ip: string): RedIpv4 | null {
    return PATRON_IPV4.test(ip) ? props.redes.find(r => ipEnCidr(ip, r.cidr)) ?? null : null
}

const redEscrita = computed(() => redDeIp(ipv4.value.trim()))

watch(ipv4, (ip) => {
    if (modo.value === 'fija') {
        redId.value = redDeIp(ip.trim())?.id
    }
})

type Disponibilidad = { estado: 'consultando' } | { estado: 'libre' } | { estado: 'ocupada', texto: string } | { estado: 'error' } | null
const disponibilidad = shallowRef<Disponibilidad>(null)
let consulta = 0
let espera: ReturnType<typeof setTimeout> | undefined

async function consultarDisponibilidad(ip: string, numero: number) {
    const resultado = await useIp().consultar(ip)
    if (numero !== consulta) {
        return
    }
    if (resultado.ok) {
        const { servicio_id: id } = resultado.data
        const servicio = puede('servicios.ver') ? await useServicios().ver(id) : null
        if (numero !== consulta) {
            return
        }
        disponibilidad.value = { estado: 'ocupada', texto: `Ocupada por ${servicio?.ok ? servicio.data.codigo : `el servicio #${id}`}` }
        return
    }
    disponibilidad.value = resultado.problema.status === 404 ? { estado: 'libre' } : { estado: 'error' }
}

watch([ipv4, modo, () => props.redes], ([ip, valor]) => {
    clearTimeout(espera)
    consulta++
    disponibilidad.value = null
    const limpia = ip.trim()
    if (valor !== 'fija' || !puede('ip.resolver') || !PATRON_IPV4.test(limpia) || (props.redes.length && !redDeIp(limpia))) {
        return
    }
    const numero = consulta
    disponibilidad.value = { estado: 'consultando' }
    espera = setTimeout(() => void consultarDisponibilidad(limpia, numero), 350)
})

onBeforeUnmount(() => clearTimeout(espera))

const ayudaIp = computed(() => {
    const red = redEscrita.value
    if (red) {
        return `Dentro de ${red.cidr}${red.nombre ? ` (${red.nombre})` : ''}.`
    }
    if (!props.redes.length) {
        return puede('redes.ver') ? `${nombreRouter.value} no tiene redes IPv4 registradas: la API la valida al crear.` : 'Una IP de las redes del router; la API la valida al crear.'
    }
    return `Redes de ${nombreRouter.value}: ${props.redes.map(r => r.cidr).join(', ')}.`
})
</script>

<template>
    <section
        class="flex flex-col gap-3 rounded-2xl p-4 ring ring-(--ax-borde)"
        aria-labelledby="alta-ip-titulo"
        data-prueba="alta-ip"
    >
        <div class="flex flex-wrap items-center gap-3">
            <h3
                id="alta-ip-titulo"
                class="flex items-center gap-1.5 text-sm font-semibold text-highlighted"
            >
                <UIcon
                    name="i-lucide-wifi"
                    class="size-4 text-primary"
                />
                IP del servicio
            </h3>
            <UTabs
                v-model="modoTabs"
                :items="itemsModo"
                :content="false"
                variant="pill"
                color="neutral"
                size="sm"
                class="w-full sm:ms-auto sm:w-auto"
                :ui="{
                    list: 'w-full rounded-xl bg-(--ax-panel) p-1 sm:w-auto',
                    indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                    trigger: 'grow rounded-lg px-3 text-muted data-[state=active]:text-primary sm:grow-0',
                    leadingIcon: 'hidden size-4 sm:inline-flex',
                }"
                aria-label="Cómo se asigna la IP"
                data-prueba="modo-ip"
            />
        </div>

        <p
            v-if="modo === 'automatica'"
            class="flex items-start gap-2 rounded-xl bg-(--ax-panel) p-3 text-sm text-default"
            data-prueba="ip-automatica"
        >
            <UIcon
                name="i-lucide-sparkles"
                class="mt-0.5 size-4 shrink-0 text-primary"
            />
            <span>
                La siguiente IP libre de las redes de {{ nombreRouter }}.
                <template v-if="conPppoe">Con «Programar instalación» se asigna al activar.</template>
                <template v-else>{{ TIPOS_CONEXION[tipoConexion].etiqueta }} necesita la IP: se reserva al guardar.</template>
            </span>
        </p>

        <UFormField
            v-else-if="modo === 'red'"
            name="red_id"
            label="Red"
            help="Se toma la siguiente IP libre de la red elegida."
            required
        >
            <div
                v-if="cargando"
                class="flex flex-col gap-2"
            >
                <USkeleton
                    v-for="n in 2"
                    :key="n"
                    class="h-14 w-full"
                />
            </div>
            <UAlert
                v-else-if="!redes.length"
                color="warning"
                variant="subtle"
                icon="i-lucide-network"
                :title="puede('redes.ver') ? `${nombreRouter} no tiene redes IPv4` : 'Sin permiso para ver las redes'"
                :description="puede('redes.ver') ? 'Regístralas en Red › Routers, o deja la IP en «Automática».' : 'Deja la IP en «Automática» o escríbela.'"
            />
            <URadioGroup
                v-else
                v-model="redId"
                :items="itemsRed"
                variant="card"
                class="w-full"
                :ui="{ fieldset: 'grid gap-2', label: 'font-mono', description: 'font-sans' }"
                data-prueba="redes-ip"
            />
        </UFormField>

        <UFormField
            v-else
            name="ipv4"
            label="IP fija"
            :error-pattern="/^(ipv4|red_id)$/"
            :help="ayudaIp"
            required
        >
            <UInput
                v-model="ipv4"
                inputmode="decimal"
                placeholder="100.64.10.50"
                autocomplete="off"
                size="xl"
                class="w-full"
                :ui="{ base: 'font-mono text-lg', trailing: 'pe-2' }"
                data-prueba="ipv4-fija-ip"
            >
                <template
                    v-if="disponibilidad"
                    #trailing
                >
                    <UBadge
                        v-if="disponibilidad.estado === 'libre'"
                        label="Libre"
                        icon="i-lucide-check"
                        color="success"
                        variant="subtle"
                        class="rounded-full"
                        data-prueba="ip-libre"
                    />
                    <UBadge
                        v-else-if="disponibilidad.estado === 'ocupada'"
                        :label="disponibilidad.texto"
                        icon="i-lucide-circle-alert"
                        color="error"
                        variant="subtle"
                        class="rounded-full"
                        data-prueba="ip-ocupada"
                    />
                    <UBadge
                        v-else-if="disponibilidad.estado === 'error'"
                        label="No se pudo consultar"
                        color="neutral"
                        variant="subtle"
                        class="rounded-full"
                    />
                    <UIcon
                        v-else
                        name="i-lucide-loader-circle"
                        class="size-4 animate-spin text-muted"
                        aria-label="Consultando"
                    />
                </template>
            </UInput>
        </UFormField>

        <slot />
    </section>
</template>
