<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Direccionamiento del router: redes IPv4 (`redes.ver`, agregar con
 * `redes.crear`) y bloques IPv6 con sus pools de enlace y de delegación (`ipv6.ver`, agregar con
 * `ipv6.crear`). La API valida que una red no se solape y que un pool caiga dentro de su bloque
 * (422 junto al campo). Quien lo monta ya comprobó `routers.ver`.
 *
 * Para que IPv6 se entienda: una explicación con el ejemplo real de los pools (`Ipv6Explicacion`),
 * cada bloque dibujado a escala con sus pools y cuántos clientes caben en cada uno, y al agregar un
 * pool una vista previa de lo que recibe cada cliente y un prefijo libre sugerido.
 */
const props = defineProps<{
    routerId: number
}>()

const { puede } = usePermisos()
const toast = useToast()

const redes = shallowRef<RedIpv4[]>([])
const bloques = shallowRef<Ipv6Bloque[]>([])
const pools = ref<Record<number, Ipv6Pool[]>>({})
const problemaRedes = ref<Problem | null>(null)
const problemaBloques = ref<Problem | null>(null)
const problemaPools = ref<Record<number, Problem>>({})
const cargando = ref(false)

async function cargarRedes() {
    if (!puede('redes.ver')) {
        problemaRedes.value = problemaSinPermiso('redes.ver')
        return
    }
    const resultado = await useRouters().redesIpv4(props.routerId)
    redes.value = resultado.ok ? resultado.data : []
    problemaRedes.value = resultado.ok ? null : resultado.problema
}

async function cargarPools(bloqueId: number) {
    const resultado = await useIpv6Pools().listar(bloqueId)
    if (resultado.ok) {
        pools.value = { ...pools.value, [bloqueId]: resultado.data }
        const { [bloqueId]: _quitado, ...resto } = problemaPools.value
        problemaPools.value = resto
        return
    }
    problemaPools.value = { ...problemaPools.value, [bloqueId]: resultado.problema }
}

async function cargarBloques() {
    if (!puede('ipv6.ver')) {
        problemaBloques.value = problemaSinPermiso('ipv6.ver')
        return
    }
    const resultado = await useRouters().ipv6Bloques(props.routerId)
    bloques.value = resultado.ok ? resultado.data : []
    problemaBloques.value = resultado.ok ? null : resultado.problema
    await Promise.all(bloques.value.map(b => cargarPools(b.id)))
}

async function cargar() {
    cargando.value = true
    await Promise.all([cargarRedes(), cargarBloques()])
    cargando.value = false
}

watch(() => props.routerId, () => void cargar(), { immediate: true })

/* Formularios: uno abierto a la vez. */
type Formulario = { tipo: 'red' } | { tipo: 'bloque' } | { tipo: 'pool', bloque: Ipv6Bloque }
const abierto = ref(false)
const actual = shallowRef<Formulario>({ tipo: 'red' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const formulario = useTemplateRef('formulario')

const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CIDR_V6 = /^[0-9a-fA-F:]+\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/

/** Espejos de los validadores de red IPv4, bloque y pool IPv6. */
const esquemaRed = z.object({
    cidr: z.string().trim().regex(CIDR_V4, 'Red en CIDR (ej. 100.64.10.0/24)'),
    gateway: z.string().trim().refine(v => v === '' || IPV4.test(v), 'Escribe una IPv4'),
    tipo: z.enum(['estatico', 'pool']),
})
const esquemaBloque = z.object({
    prefijo: z.string().trim().regex(CIDR_V6, 'Prefijo IPv6 en CIDR (ej. 2001:db8:100::/40)'),
})
const esquemaPool = z.object({
    prefijo: z.string().trim().regex(CIDR_V6, 'Prefijo IPv6 en CIDR'),
    tipo: z.enum(['enlace', 'delegacion']),
    tamano_entrega: z.union([z.literal(64), z.literal(56), z.literal(48)]),
    nombre_en_router: z.string().trim().max(100, 'Máximo 100 caracteres'),
})

const red = reactive<z.input<typeof esquemaRed>>({ cidr: '', gateway: '', tipo: 'pool' })
const bloque = reactive<z.input<typeof esquemaBloque>>({ prefijo: '' })
const pool = reactive<z.input<typeof esquemaPool>>({ prefijo: '', tipo: 'delegacion', tamano_entrega: 56, nombre_en_router: '' })

const itemsTipoRed: SelectItem[] = [
    { label: 'Pool (asignación automática)', value: 'pool' },
    { label: 'Estático (IP fija por servicio)', value: 'estatico' },
]
const itemsTipoPool: SelectItem[] = [
    { label: 'Enlace (un /64 por servicio)', value: 'enlace' },
    { label: 'Delegación (prefijo para el cliente)', value: 'delegacion' },
]
const itemsTamano: SelectItem[] = [64, 56, 48].map(n => ({ label: `/${n}`, value: n }))

watch(() => pool.tipo, (tipo) => {
    if (tipo === 'enlace') {
        pool.tamano_entrega = 64
    }
})

function abrir(formularioNuevo: Formulario) {
    actual.value = formularioNuevo
    Object.assign(red, { cidr: '', gateway: '', tipo: 'pool' })
    Object.assign(bloque, { prefijo: '' })
    Object.assign(pool, { prefijo: '', tipo: 'delegacion', tamano_entrega: 56, nombre_en_router: '' })
    problema.value = null
    abierto.value = true
}

const titulo = computed(() => {
    const f = actual.value
    return f.tipo === 'red' ? 'Agregar red IPv4' : f.tipo === 'bloque' ? 'Agregar bloque IPv6' : `Pool en ${f.bloque.prefijo}`
})

async function terminar<T>(resultado: Resultado<T>, mensaje: string, recargar: () => Promise<void>) {
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: mensaje, color: 'success', icon: 'i-lucide-circle-check' })
        await recargar()
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}

async function enviarRed(evento: FormSubmitEvent<z.output<typeof esquemaRed>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useRouters().agregarRed(props.routerId, { cidr: evento.data.cidr, gateway: evento.data.gateway || null, tipo: evento.data.tipo })
    await terminar(resultado, `Red ${evento.data.cidr} agregada`, cargarRedes)
}

async function enviarBloque(evento: FormSubmitEvent<z.output<typeof esquemaBloque>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useRouters().agregarBloque(props.routerId, { prefijo: evento.data.prefijo })
    await terminar(resultado, `Bloque ${evento.data.prefijo} agregado`, cargarBloques)
}

async function enviarPool(evento: FormSubmitEvent<z.output<typeof esquemaPool>>) {
    const f = actual.value
    if (f.tipo !== 'pool') {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useIpv6Pools().crear(f.bloque.id, {
        prefijo: evento.data.prefijo,
        tipo: evento.data.tipo,
        tamano_entrega: evento.data.tamano_entrega,
        nombre_en_router: evento.data.nombre_en_router || null,
    })
    await terminar(resultado, `Pool ${evento.data.prefijo} agregado`, () => cargarPools(f.bloque.id))
}

/** Vista previa del pool que se está agregando: cuántos caben y qué recibe cada cliente. */
const previaPool = computed(() => {
    const f = actual.value
    const prefijo = prefijoV6(pool.prefijo)
    if (f.tipo !== 'pool' || !prefijo) {
        return null
    }
    const bloqueActual = prefijoV6(f.bloque.prefijo)
    const fuera = bloqueActual ? !contiene(bloqueActual, prefijo) : false
    const solapado = (pools.value[f.bloque.id] ?? []).find((p) => {
        const otro = prefijoV6(p.prefijo)
        return otro ? seSolapan(otro, prefijo) : false
    })
    const caben = cuantosCaben(prefijo.largo, pool.tamano_entrega)
    return {
        fuera,
        solapado: solapado?.prefijo ?? null,
        caben,
        ejemplos: [0n, 1n].filter(i => i < caben).map(i => textoPrefijo(subprefijo(prefijo, pool.tamano_entrega, i))),
    }
})

function sugerir() {
    const f = actual.value
    if (f.tipo !== 'pool') {
        return
    }
    const sugerido = sugerirPool(f.bloque.prefijo, (pools.value[f.bloque.id] ?? []).map(p => p.prefijo), pool.tipo, pool.tamano_entrega)
    if (sugerido) {
        pool.prefijo = sugerido
        formulario.value?.clear('prefijo')
    }
    else {
        toast.add({ title: 'No hay espacio libre en el bloque', description: 'Todos los prefijos de ese tamaño ya están en otro pool.', color: 'warning', icon: 'i-lucide-triangle-alert' })
    }
}

/** Pools de un bloque dibujados a escala (al menos un 2 % para que se vean). */
function tramos(b: Ipv6Bloque) {
    const bloqueActual = prefijoV6(b.prefijo)
    if (!bloqueActual) {
        return []
    }
    return (pools.value[b.id] ?? []).map((p) => {
        const prefijo = prefijoV6(p.prefijo)
        const fraccion = prefijo ? fraccionDelBloque(bloqueActual, prefijo) : 0
        return { id: p.id, tipo: p.tipo, ancho: `${Math.max(2, fraccion * 100)}%`, etiqueta: `${TIPOS_POOL[p.tipo]} ${p.prefijo}` }
    })
}

function cabenEnPool(p: Ipv6Pool): string {
    const prefijo = prefijoV6(p.prefijo)
    return prefijo ? cantidadPrefijos(cuantosCaben(prefijo.largo, p.tamano_entrega)) : '—'
}

function resumenBloque(b: Ipv6Bloque) {
    return resumenIpv6(pools.value[b.id] ?? [])
}

function capacidadRed(r: RedIpv4): string {
    const cantidad = capacidadIpv4(r.cidr, r.gateway !== null)
    return cantidad === null ? '' : `${cantidad.toLocaleString('es-GT')} ${cantidad === 1 ? 'IP utilizable' : 'IP utilizables'}`
}

const TIPOS_RED: Record<RedIpv4['tipo'], string> = { pool: 'Pool', estatico: 'Estático' }
const TIPOS_POOL: Record<Ipv6Pool['tipo'], string> = { enlace: 'Enlace', delegacion: 'Delegación' }
</script>

<template>
    <div
        class="grid gap-6 lg:grid-cols-2"
        data-prueba="router-direccionamiento"
    >
        <UPageCard
            title="Redes IPv4"
            icon="i-lucide-network"
            variant="subtle"
        >
            <template
                v-if="puede('redes.crear')"
                #footer
            >
                <UButton
                    label="Agregar red"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-prueba="agregar-red"
                    @click="abrir({ tipo: 'red' })"
                />
            </template>
            <ProblemaAlerta
                v-if="problemaRedes"
                :problema="problemaRedes"
                :reintentar="puede('redes.ver') ? cargarRedes : undefined"
            />
            <USkeleton
                v-else-if="cargando && !redes.length"
                class="h-16 w-full"
            />
            <p
                v-else-if="!redes.length"
                class="text-sm text-muted"
            >
                Sin redes IPv4: los servicios de este router no pueden recibir IP.
            </p>
            <ul
                v-else
                class="flex flex-col divide-y divide-default"
                data-prueba="redes-router"
            >
                <li
                    v-for="r in redes"
                    :key="r.id"
                    class="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                    <span class="flex flex-col">
                        <span class="font-mono text-sm text-highlighted">{{ r.cidr }}</span>
                        <span
                            class="text-xs text-muted"
                            :data-prueba="`capacidad-red-${r.id}`"
                        >{{ capacidadRed(r) }}</span>
                    </span>
                    <span class="flex items-center gap-2 text-xs text-muted">
                        <span v-if="r.gateway">gw <span class="font-mono">{{ r.gateway }}</span></span>
                        <UBadge
                            :label="TIPOS_RED[r.tipo]"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                    </span>
                </li>
            </ul>
        </UPageCard>

        <UPageCard
            title="Bloques y pools IPv6"
            icon="i-lucide-globe"
            variant="subtle"
        >
            <template
                v-if="puede('ipv6.crear')"
                #footer
            >
                <UButton
                    label="Agregar bloque"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-prueba="agregar-bloque"
                    @click="abrir({ tipo: 'bloque' })"
                />
            </template>
            <ProblemaAlerta
                v-if="problemaBloques"
                :problema="problemaBloques"
                :reintentar="puede('ipv6.ver') ? cargarBloques : undefined"
            />
            <USkeleton
                v-else-if="cargando && !bloques.length"
                class="h-16 w-full"
            />
            <p
                v-else-if="!bloques.length"
                class="text-sm text-muted"
            >
                Sin bloques IPv6: los servicios de este router solo reciben IPv4. Abajo verás cómo funcionaría con un bloque de ejemplo.
            </p>
            <div
                v-else
                class="flex flex-col gap-4"
                data-prueba="bloques-router"
            >
                <div
                    v-for="b in bloques"
                    :key="b.id"
                    class="flex flex-col gap-2 rounded-md border border-default p-3"
                    :data-bloque="b.id"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="font-mono text-sm font-medium text-highlighted">{{ b.prefijo }}</span>
                        <UButton
                            v-if="puede('ipv6.crear')"
                            label="Agregar pool"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            :aria-label="`Agregar pool en ${b.prefijo}`"
                            :data-prueba="`agregar-pool-${b.id}`"
                            @click="abrir({ tipo: 'pool', bloque: b })"
                        />
                    </div>
                    <div
                        v-if="(pools[b.id] ?? []).length"
                        class="flex h-3 w-full overflow-hidden rounded-full bg-elevated"
                        role="img"
                        :aria-label="`Uso del bloque ${b.prefijo}: ${tramos(b).map(t => t.etiqueta).join(', ')}; el resto, libre`"
                        :data-prueba="`barra-bloque-${b.id}`"
                    >
                        <span
                            v-for="t in tramos(b)"
                            :key="t.id"
                            class="h-full border-r border-default last:border-r-0"
                            :class="t.tipo === 'enlace' ? 'bg-info' : 'bg-primary'"
                            :style="{ width: t.ancho }"
                        />
                    </div>
                    <p
                        v-if="(pools[b.id] ?? []).length"
                        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"
                    >
                        <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-primary" />Delegación</span>
                        <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-info" />Enlace</span>
                        <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-elevated ring-1 ring-default" />Libre</span>
                        <span
                            class="ms-auto"
                            :data-prueba="`clientes-bloque-${b.id}`"
                        >{{ resumenBloque(b).clientes > 0n ? `Caben ${cantidadPrefijos(resumenBloque(b).clientes)} clientes` : 'Falta un pool de enlace o de delegación' }}</span>
                    </p>
                    <ProblemaAlerta
                        v-if="problemaPools[b.id]"
                        :problema="problemaPools[b.id]!"
                        :reintentar="() => cargarPools(b.id)"
                    />
                    <p
                        v-else-if="!(pools[b.id] ?? []).length"
                        class="text-xs text-muted"
                    >
                        Sin pools: agrega uno de enlace y uno de delegación.
                    </p>
                    <ul
                        v-else
                        class="flex flex-col gap-1"
                    >
                        <li
                            v-for="p in pools[b.id]"
                            :key="p.id"
                            class="flex flex-wrap items-center justify-between gap-2 text-xs"
                            :data-pool="p.id"
                        >
                            <span class="font-mono text-highlighted">{{ p.prefijo }}</span>
                            <span class="flex items-center gap-2 text-muted">
                                <span :data-prueba="`caben-pool-${p.id}`">{{ cabenEnPool(p) }} × /{{ p.tamano_entrega }}</span>
                                <span v-if="p.nombre_en_router">«{{ p.nombre_en_router }}»</span>
                                <UBadge
                                    :label="`${TIPOS_POOL[p.tipo]} · /${p.tamano_entrega}`"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                />
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
        </UPageCard>

        <Ipv6Explicacion
            v-if="!problemaBloques && !(cargando && !bloques.length)"
            :bloques="bloques"
            :pools="pools"
            class="lg:col-span-2"
        />

        <UModal
            v-model:open="abierto"
            :title="titulo"
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    v-if="actual.tipo === 'red'"
                    id="form-direccionamiento"
                    ref="formulario"
                    :schema="esquemaRed"
                    :state="red"
                    class="flex flex-col gap-4"
                    @submit="enviarRed"
                >
                    <UFormField
                        label="Red (CIDR)"
                        name="cidr"
                        required
                    >
                        <UInput
                            v-model="red.cidr"
                            placeholder="100.64.10.0/24"
                            class="w-full font-mono"
                            data-prueba="red-cidr"
                        />
                    </UFormField>
                    <UFormField
                        label="Gateway"
                        name="gateway"
                    >
                        <UInput
                            v-model="red.gateway"
                            placeholder="100.64.10.1"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Tipo"
                        name="tipo"
                    >
                        <USelect
                            v-model="red.tipo"
                            :items="itemsTipoRed"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
                <UForm
                    v-else-if="actual.tipo === 'bloque'"
                    id="form-direccionamiento"
                    ref="formulario"
                    :schema="esquemaBloque"
                    :state="bloque"
                    class="flex flex-col gap-4"
                    @submit="enviarBloque"
                >
                    <p class="text-sm text-muted">
                        El bloque es el rango IPv6 que te asignó tu proveedor para este router (por ejemplo un /40 o un /48).
                        Después lo repartes en un pool de enlace y uno de delegación. Si tienes otro rango, agrégalo como otro bloque.
                    </p>
                    <UFormField
                        label="Prefijo (CIDR)"
                        name="prefijo"
                        required
                        help="Tal como te lo dio el proveedor, con su tamaño: 2001:db8:100::/40."
                    >
                        <UInput
                            v-model="bloque.prefijo"
                            placeholder="2001:db8:100::/40"
                            class="w-full font-mono"
                            data-prueba="bloque-prefijo"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
                <UForm
                    v-else
                    id="form-direccionamiento"
                    ref="formulario"
                    :schema="esquemaPool"
                    :state="pool"
                    class="flex flex-col gap-4"
                    @submit="enviarPool"
                >
                    <p class="text-sm text-muted">
                        {{ pool.tipo === 'enlace'
                            ? 'Pool de enlace: de aquí sale el /64 de la conexión PPPoE de cada cliente.'
                            : 'Pool de delegación: de aquí sale el prefijo (PD) que cada cliente usa en su propia red.' }}
                    </p>
                    <UFormField
                        label="Prefijo del pool (CIDR)"
                        name="prefijo"
                        :help="actual.tipo === 'pool' ? `Debe caer dentro del bloque ${actual.bloque.prefijo} sin pisar otro pool.` : undefined"
                        required
                    >
                        <UFieldGroup class="w-full">
                            <UInput
                                v-model="pool.prefijo"
                                placeholder="2001:db8:100:8000::/44"
                                class="w-full font-mono"
                                data-prueba="pool-prefijo"
                            />
                            <UButton
                                label="Sugerir"
                                icon="i-lucide-wand-sparkles"
                                color="neutral"
                                variant="outline"
                                data-prueba="pool-sugerir"
                                @click="sugerir"
                            />
                        </UFieldGroup>
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Tipo"
                            name="tipo"
                        >
                            <USelect
                                v-model="pool.tipo"
                                :items="itemsTipoPool"
                                class="w-full"
                                data-prueba="pool-tipo"
                            />
                        </UFormField>
                        <UFormField
                            label="Tamaño que se entrega"
                            name="tamano_entrega"
                        >
                            <USelect
                                v-model="pool.tamano_entrega"
                                :items="itemsTamano"
                                :disabled="pool.tipo === 'enlace'"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UAlert
                        v-if="previaPool"
                        :color="previaPool.fuera || previaPool.solapado ? 'warning' : 'info'"
                        variant="subtle"
                        :icon="previaPool.fuera || previaPool.solapado ? 'i-lucide-triangle-alert' : 'i-lucide-info'"
                        :title="previaPool.fuera ? 'Este prefijo no cae dentro del bloque' : previaPool.solapado ? `Se pisa con el pool ${previaPool.solapado}` : `Caben ${cantidadPrefijos(previaPool.caben)} clientes`"
                        data-prueba="pool-vista-previa"
                    >
                        <template
                            v-if="!previaPool.fuera && !previaPool.solapado && previaPool.ejemplos.length"
                            #description
                        >
                            <p>Cada cliente recibe un /{{ pool.tamano_entrega }}:</p>
                            <ul class="font-mono text-xs break-all">
                                <li
                                    v-for="(ejemplo, indice) in previaPool.ejemplos"
                                    :key="ejemplo"
                                >
                                    Cliente {{ indice + 1 }}: {{ ejemplo }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <UFormField
                        label="Nombre en el router"
                        name="nombre_en_router"
                        help="El pool de RouterOS (ipv6/pool); vacío si se administra por RADIUS."
                    >
                        <UInput
                            v-model="pool.nombre_en_router"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="abierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-direccionamiento"
                        label="Agregar"
                        icon="i-lucide-plus"
                        :loading="enviando"
                        data-prueba="direccionamiento-guardar"
                    />
                </div>
            </template>
        </UModal>
    </div>
</template>
