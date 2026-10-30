<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Direccionamiento del router (`GET /routers/:id/direccionamiento`, `contratos/pools.md`): redes
 * IPv4 y bloques IPv6 con sus pools, cada uno con su ocupación (barra con icono + texto + color),
 * qué recibe un servicio nuevo de cada plan y sus avisos. Cada red, bloque y pool se edita
 * (`redes.editar`, `ipv6.editar`) y las redes y los bloques se mueven a otro router con simulación
 * previa (`redes.migrar`, `ipv6.migrar`). Agregar: `redes.crear` e `ipv6.crear`. Quien lo monta ya
 * comprobó `routers.ver`.
 *
 * Para que IPv6 se entienda: cada bloque con su proveedor dibujado a escala con sus pools, lo que
 * entrega cada pool (atributo RADIUS, redes por cliente, primer prefijo) y `Ipv6Explicacion`.
 */
const props = defineProps<{
    routerId: number
}>()

const { puede } = usePermisos()

const datos = shallowRef<DireccionamientoRouter | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useRouters().direccionamiento(props.routerId)
    cargando.value = false
    datos.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => props.routerId, () => void cargar(), { immediate: true })

const redes = computed(() => datos.value?.redes_ipv4 ?? [])
const bloques = computed(() => datos.value?.bloques_ipv6 ?? [])
/** Pools por bloque, para la explicación y para sugerir un prefijo libre. */
const pools = computed<Record<number, Ipv6Pool[]>>(() => Object.fromEntries(bloques.value.map(b => [b.id, b.pools])))
const avisos = computed(() => (datos.value?.planes ?? []).flatMap(p => p.avisos.map(a => ({ ...a, plan: p.nombre }))))

/* Modales: uno a la vez, con lo que se edita o se mueve. */
const redAbierta = ref(false)
const redEditada = shallowRef<RedIpv4 | null>(null)
const bloqueAbierto = ref(false)
const bloqueEditado = shallowRef<Ipv6Bloque | null>(null)
const poolAbierto = ref(false)
const poolBloque = shallowRef<Ipv6Bloque | null>(null)
const poolEditado = shallowRef<Ipv6Pool | null>(null)
const migrarAbierto = ref(false)
const migrar = shallowRef<{ tipo: 'red' | 'bloque', entidad: RedIpv4 | Ipv6Bloque } | null>(null)

function abrirRed(red: RedIpv4 | null) {
    redEditada.value = red
    redAbierta.value = true
}

function abrirBloque(bloque: Ipv6Bloque | null) {
    bloqueEditado.value = bloque
    bloqueAbierto.value = true
}

function abrirPool(bloque: Ipv6Bloque, pool: Ipv6Pool | null) {
    poolBloque.value = bloque
    poolEditado.value = pool
    poolAbierto.value = true
}

function abrirMigrar(tipo: 'red' | 'bloque', entidad: RedIpv4 | Ipv6Bloque) {
    migrar.value = { tipo, entidad }
    migrarAbierto.value = true
}

const acompanantes = computed(() => (migrar.value?.tipo === 'red' ? (puede('ipv6.migrar') ? bloques.value : []) : (puede('redes.migrar') ? redes.value : [])))

/** Pools de un bloque dibujados a escala (al menos un 2 % para que se vean). */
function tramos(b: Ipv6Bloque & { pools: Ipv6Pool[] }) {
    const propio = prefijoV6(b.prefijo)
    if (!propio) {
        return []
    }
    return b.pools.map((p) => {
        const prefijo = prefijoV6(p.prefijo)
        const fraccion = prefijo ? fraccionDelBloque(propio, prefijo) : 0
        return { id: p.id, tipo: p.tipo, ancho: `${Math.max(2, fraccion * 100)}%`, etiqueta: `${TIPOS_POOL[p.tipo]} ${p.prefijo}` }
    })
}

function clientesDeBloque(b: Ipv6Bloque & { pools: Ipv6Pool[] }): number {
    const enlace = b.pools.filter(p => p.tipo === 'enlace').reduce((s, p) => s + p.ocupacion.libres + p.ocupacion.asignadas, 0)
    const delegacion = b.pools.filter(p => p.tipo === 'delegacion').reduce((s, p) => s + p.ocupacion.libres + p.ocupacion.asignadas, 0)
    return Math.min(enlace, delegacion)
}

function textoRango(r: RedIpv4): string | null {
    return r.rango_inicio && r.rango_fin ? `entrega ${r.rango_inicio} – ${r.rango_fin}` : null
}

const TIPOS_RED: Record<RedIpv4['tipo'], string> = { pool: 'Pool', estatico: 'Estático' }
const TIPOS_POOL: Record<Ipv6Pool['tipo'], string> = { enlace: 'Enlace', delegacion: 'Delegación' }
</script>

<template>
    <div
        class="grid gap-6 lg:grid-cols-2"
        data-prueba="router-direccionamiento"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            class="lg:col-span-2"
        />

        <section
            v-if="avisos.length"
            class="flex flex-col gap-2 lg:col-span-2"
            aria-label="Avisos del direccionamiento"
            data-prueba="avisos-direccionamiento"
        >
            <UAlert
                v-for="aviso in avisos"
                :key="`${aviso.plan}-${aviso.codigo}`"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="`${aviso.plan}: ${aviso.mensaje}`"
            />
        </section>

        <UPageCard
            v-if="!problema"
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
                    @click="abrirRed(null)"
                />
            </template>
            <USkeleton
                v-if="cargando && !datos"
                class="h-16 w-full"
            />
            <p
                v-else-if="!redes.length"
                class="text-sm text-muted"
            >
                Sin redes IPv4: los servicios de este router no pueden recibir IP.
            </p>
            <div
                v-else
                class="flex flex-col gap-4"
            >
                <OcupacionBarra
                    v-if="datos && redes.length > 1"
                    :ocupacion="datos.ocupacion.ipv4"
                    data-prueba="ocupacion-ipv4-total"
                />
                <ul
                    class="flex flex-col divide-y divide-default"
                    data-prueba="redes-router"
                >
                    <li
                        v-for="r in redes"
                        :key="r.id"
                        class="flex flex-col gap-2 py-3"
                        :data-red="r.id"
                    >
                        <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="flex min-w-0 flex-col">
                                <span class="font-mono text-sm text-highlighted">{{ r.cidr }}</span>
                                <span class="text-xs text-muted">
                                    {{ [r.nombre, r.gateway ? `gw ${r.gateway}` : null, textoRango(r)].filter(Boolean).join(' · ') || 'Toda la red se entrega' }}
                                </span>
                            </div>
                            <div class="flex items-center gap-1">
                                <UBadge
                                    :label="TIPOS_RED[r.tipo]"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                />
                                <UButton
                                    v-if="puede('redes.editar')"
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :aria-label="`Editar la red ${r.cidr}`"
                                    :data-prueba="`editar-red-${r.id}`"
                                    @click="abrirRed(r)"
                                />
                                <UButton
                                    v-if="puede('redes.migrar')"
                                    icon="i-lucide-arrow-right-left"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :aria-label="`Mover la red ${r.cidr} a otro router`"
                                    :data-prueba="`migrar-red-${r.id}`"
                                    @click="abrirMigrar('red', r)"
                                />
                            </div>
                        </div>
                        <OcupacionBarra
                            :ocupacion="r.ocupacion"
                            :data-prueba="`ocupacion-red-${r.id}`"
                        />
                    </li>
                </ul>
            </div>
        </UPageCard>

        <UPageCard
            v-if="!problema"
            title="Bloques y pools IPv6"
            icon="i-lucide-globe"
            variant="subtle"
        >
            <template
                v-if="puede('ipv6.crear')"
                #footer
            >
                <UButton
                    :label="bloques.length ? 'Agregar otro bloque' : 'Agregar bloque'"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-prueba="agregar-bloque"
                    @click="abrirBloque(null)"
                />
            </template>
            <USkeleton
                v-if="cargando && !datos"
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
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="flex min-w-0 flex-col">
                            <span class="font-mono text-sm font-medium text-highlighted">{{ b.prefijo }}</span>
                            <span class="text-xs text-muted">
                                {{ [b.nombre, b.proveedor ? `de ${b.proveedor}` : null].filter(Boolean).join(' · ') || 'Sin proveedor' }} · {{ b.espacio.porcentaje_en_pools.toLocaleString('es-GT') }} % repartido en pools
                            </span>
                        </div>
                        <div class="flex items-center gap-1">
                            <UButton
                                v-if="puede('ipv6.crear')"
                                label="Agregar pool"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :aria-label="`Agregar pool en ${b.prefijo}`"
                                :data-prueba="`agregar-pool-${b.id}`"
                                @click="abrirPool(b, null)"
                            />
                            <UButton
                                v-if="puede('ipv6.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :aria-label="`Editar el bloque ${b.prefijo}`"
                                :data-prueba="`editar-bloque-${b.id}`"
                                @click="abrirBloque(b)"
                            />
                            <UButton
                                v-if="puede('ipv6.migrar')"
                                icon="i-lucide-arrow-right-left"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :aria-label="`Mover el bloque ${b.prefijo} a otro router`"
                                :data-prueba="`migrar-bloque-${b.id}`"
                                @click="abrirMigrar('bloque', b)"
                            />
                        </div>
                    </div>
                    <div
                        v-if="b.pools.length"
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
                        v-if="b.pools.length"
                        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"
                    >
                        <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-primary" />Delegación</span>
                        <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-info" />Enlace</span>
                        <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-elevated ring-1 ring-default" />Libre</span>
                        <span
                            class="ms-auto"
                            :data-prueba="`clientes-bloque-${b.id}`"
                        >{{ clientesDeBloque(b) > 0 ? `Caben ${clientesDeBloque(b).toLocaleString('es-GT')} clientes` : 'Falta un pool de enlace o de delegación' }}</span>
                    </p>
                    <p
                        v-else
                        class="text-xs text-muted"
                    >
                        Sin pools: agrega uno de enlace y uno de delegación.
                    </p>
                    <ul
                        v-if="b.pools.length"
                        class="flex flex-col divide-y divide-default"
                    >
                        <li
                            v-for="p in b.pools"
                            :key="p.id"
                            class="flex flex-col gap-1.5 py-2 text-xs"
                            :data-pool="p.id"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="font-mono text-highlighted">{{ p.prefijo }}</span>
                                <span class="flex items-center gap-1 text-muted">
                                    <span v-if="p.nombre_en_router">«{{ p.nombre_en_router }}»</span>
                                    <UBadge
                                        :label="`${TIPOS_POOL[p.tipo]} · /${p.tamano_entrega}`"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                    />
                                    <UButton
                                        v-if="puede('ipv6.editar')"
                                        icon="i-lucide-pencil"
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        :aria-label="`Editar el pool ${p.prefijo}`"
                                        :data-prueba="`editar-pool-${p.id}`"
                                        @click="abrirPool(b, p)"
                                    />
                                </span>
                            </div>
                            <p
                                class="text-muted"
                                :data-prueba="`entrega-pool-${p.id}`"
                            >
                                Cada cliente recibe un /{{ p.tamano_entrega }} ({{ p.entrega.atributo_radius }}){{ p.tipo === 'delegacion' ? `, ${p.entrega.redes_lan_por_cliente.toLocaleString('es-GT')} redes /64 en su casa` : '' }} · el primero <span class="font-mono">{{ p.entrega.primer_prefijo }}</span>
                            </p>
                            <OcupacionBarra
                                :ocupacion="p.ocupacion"
                                unidad="prefijos"
                                :data-prueba="`ocupacion-pool-${p.id}`"
                            />
                        </li>
                    </ul>
                </div>
            </div>
        </UPageCard>

        <Ipv6Explicacion
            v-if="!problema && datos"
            :bloques="bloques"
            :pools="pools"
            class="lg:col-span-2"
        />

        <RedIpv4Modal
            v-model:open="redAbierta"
            :router-id="routerId"
            :red="redEditada"
            @guardado="cargar"
        />
        <Ipv6BloqueModal
            v-model:open="bloqueAbierto"
            :router-id="routerId"
            :bloque="bloqueEditado"
            @guardado="cargar"
        />
        <Ipv6PoolModal
            v-if="poolBloque"
            v-model:open="poolAbierto"
            :bloque="poolBloque"
            :pools="pools[poolBloque.id] ?? []"
            :pool="poolEditado"
            @guardado="cargar"
        />
        <PoolMigrarModal
            v-if="migrar"
            v-model:open="migrarAbierto"
            :tipo="migrar.tipo"
            :entidad="migrar.entidad"
            :acompanantes="acompanantes"
            @migrado="cargar"
        />
    </div>
</template>
