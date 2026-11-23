<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Bodegas y traslados (tablero NuevoBodegas, A3 y A47): una tarjeta por bodega (lugar, técnico o
 * cuadrilla) con su valor, artículos y equipos, y lo que tiene en camino; la de cuadrilla dice su
 * jefe y miembros (llegan de Iris). «En tránsito» es la bodega virtual de lo que viaja. Abajo, los
 * traslados con «Todos / En camino / Con faltante». La bodega de un técnico solo la mueve su
 * usuario o quien tenga el permiso con alcance global (tope por técnico, `contratos/inventario.md`).
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Bodegas y traslados · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const bodegas = shallowRef<Bodega[]>([])
const problemaBodegas = ref<Problem | null>(null)
const cargandoBodegas = ref(false)
const existencias = shallowRef<ExistenciaInventario[]>([])
const problemaExistencias = ref<Problem | null>(null)
const enCamino = shallowRef<OrdenTraslado[]>([])
const miembros = shallowRef<Map<number, MiembrosCuadrilla>>(new Map())
const verInactivas = ref(false)

async function cargarBodegas() {
    cargandoBodegas.value = true
    const r = await useBodegas().listar({ limit: 200 })
    cargandoBodegas.value = false
    bodegas.value = r.ok ? r.data.data : []
    problemaBodegas.value = r.ok ? null : r.problema
    for (const b of bodegas.value.filter(x => x.tipo === 'cuadrilla')) {
        void useBodegas().miembros(b.id).then((m) => {
            if (m.ok) {
                miembros.value = new Map(miembros.value).set(b.id, m.data)
            }
        })
    }
}

async function cargarExistencias() {
    problemaExistencias.value = null
    const [e, t] = await Promise.all([
        useInventario().existencias({ limit: 200, incluir_transito: true }),
        useOrdenesTraslado().listar({ estado: 'en_transito', limit: 50 }),
    ])
    existencias.value = e.ok ? e.data.data : []
    problemaExistencias.value = e.ok ? null : e.problema
    enCamino.value = t.ok ? t.data.data : []
}

onMounted(() => {
    void cargarBodegas()
    void cargarExistencias()
})

/** Si la API no lista la bodega virtual de tránsito, su tarjeta se arma con las órdenes en camino. */
const TRANSITO_VIRTUAL = 0
const conTransito = computed<Bodega[]>(() => {
    if (bodegas.value.some(b => esBodegaTransito(b)) || !bodegas.value.length) {
        return bodegas.value
    }
    const base = bodegas.value[0]!
    return [...bodegas.value, { ...base, id: TRANSITO_VIRTUAL, nombre: 'En tránsito', tipo: 'transito' as Bodega['tipo'], usuario_id: null, usuario_nombre: null, activo: true }]
})

const visibles = computed(() => conTransito.value
    .filter(b => verInactivas.value || b.activo)
    .sort((a, b) => Number(esBodegaTransito(a)) - Number(esBodegaTransito(b)) || Number(b.tipo === 'bodega') - Number(a.tipo === 'bodega')))

interface Resumen {
    valor: Decimal
    articulos: Decimal
    equipos: Decimal
}

const resumen = computed(() => {
    const mapa = new Map<number, Resumen>()
    for (const e of existencias.value) {
        const r = mapa.get(e.bodega_id) ?? { valor: new Decimal(0), articulos: new Decimal(0), equipos: new Decimal(0) }
        r.valor = r.valor.plus(e.valor)
        if (e.modalidad === 'comodato') {
            r.equipos = r.equipos.plus(e.cantidad)
        }
        else {
            r.articulos = r.articulos.plus(e.cantidad)
        }
        mapa.set(e.bodega_id, r)
    }
    return mapa
})

function subtitulo(b: Bodega): string {
    if (esBodegaTransito(b)) {
        return 'Virtual · no se opera a mano'
    }
    if (b.tipo === 'tecnico') {
        return `Técnico · ${b.usuario_nombre ?? 'sin usuario'}`
    }
    if (b.tipo === 'cuadrilla') {
        const m = miembros.value.get(b.id)
        const jefe = m?.miembros.find(x => x.usuario_id !== null && x.usuario_id === m.jefe_id)?.nombre
        return m ? `Cuadrilla · ${jefe ? `jefe ${jefe} · ` : ''}${m.miembros.filter(x => x.aceptado).length} miembros` : 'Cuadrilla (de Iris)'
    }
    return 'Lugar'
}

function icono(b: Bodega): string {
    return esBodegaTransito(b) ? 'i-lucide-truck' : b.tipo === 'tecnico' ? 'i-lucide-user-plus' : TIPOS_BODEGA[b.tipo].icono
}

function tono(b: Bodega): string {
    return b.tipo === 'tecnico' || b.tipo === 'cuadrilla' ? 'tono-exito' : esBodegaTransito(b) ? 'tono-2' : 'tono-marca'
}

function valorDe(b: Bodega): Decimal {
    if (b.id === TRANSITO_VIRTUAL) {
        return enCamino.value.reduce((t, o) => t.plus(o.costo_total), new Decimal(0))
    }
    return resumen.value.get(b.id)?.valor ?? new Decimal(0)
}

function caminoA(b: Bodega): OrdenTraslado[] {
    return enCamino.value.filter(o => o.bodega_destino_id === b.id)
}

function detalle(b: Bodega): string {
    if (esBodegaTransito(b)) {
        return enCamino.value.map(o => `T-${String(o.numero).padStart(4, '0')} a ${o.usuario_destino_nombre?.split(' ')[0] ?? nombreCortoBodega(o.bodega_destino_nombre)}`).join(', ') || 'Nada viajando'
    }
    const r = resumen.value.get(b.id)
    if (!r) {
        return 'Sin existencias'
    }
    return `${formatearCantidad(r.articulos.toString())} ${r.articulos.equals(1) ? 'artículo' : 'artículos'} · ${formatearCantidad(r.equipos.toString())} ${r.equipos.equals(1) ? 'equipo' : 'equipos'}`
}

/* Tarjeta: ⋯ */
const formularioAbierto = ref(false)
const editando = shallowRef<Bodega | null>(null)
const aDesactivar = shallowRef<Bodega | null>(null)
const desactivarAbierto = ref(false)
const miembrosAbierto = ref(false)
const cuadrilla = shallowRef<Bodega | null>(null)

function abrir(bodega: Bodega | null) {
    editando.value = bodega
    formularioAbierto.value = true
}

function verMiembros(b: Bodega) {
    cuadrilla.value = b
    miembrosAbierto.value = true
}

function pedirDesactivar(b: Bodega) {
    aDesactivar.value = b
    desactivarAbierto.value = true
}

function menuBodega(b: Bodega): DropdownMenuItem[][] {
    const ver: DropdownMenuItem[] = [
        { label: 'Ver existencias', icon: 'i-lucide-package', to: `/inventario?bodega=${b.id}` },
        { label: 'Kardex de la bodega', icon: 'i-lucide-list-ordered', to: `/inventario/kardex?bodega=${b.id}` },
    ]
    if (b.tipo === 'cuadrilla') {
        ver.push({ label: 'Jefe y miembros', icon: 'i-lucide-users', onSelect: () => verMiembros(b) })
    }
    if (esBodegaTransito(b)) {
        return [[{ label: 'Ver lo que viaja', icon: 'i-lucide-truck', to: '/inventario/traslados?estado=en_transito' }]]
    }
    const editar: DropdownMenuItem[] = []
    if (puede('inventario.crear_traslado') && b.activo) {
        editar.push({ label: 'Trasladar desde aquí', icon: 'i-lucide-truck', to: `/inventario/traslados/nueva?origen=${b.id}` })
    }
    if (puede('inventario.abrir_conteo') && b.activo) {
        editar.push({ label: 'Contar esta bodega', icon: 'i-lucide-clipboard-list', to: `/inventario/conteos?abrir=${b.id}` })
    }
    if (puede('bodegas.editar') && b.tipo !== 'cuadrilla') {
        editar.push({ label: 'Editar', icon: ICONOS.editar, onSelect: () => abrir(b) })
    }
    const peligro: DropdownMenuItem[] = puede('bodegas.desactivar') && b.activo && b.tipo !== 'cuadrilla'
        ? [{ label: 'Desactivar', icon: 'i-lucide-circle-pause', color: 'error', onSelect: () => pedirDesactivar(b) }]
        : []
    return [ver, editar, peligro].filter(g => g.length)
}

function alGuardar(bodega: Bodega) {
    const existia = bodegas.value.some(b => b.id === bodega.id)
    bodegas.value = existia ? bodegas.value.map(b => (b.id === bodega.id ? bodega : b)) : [...bodegas.value, bodega]
    toast.add({ title: existia ? `${bodega.nombre} guardada` : `${bodega.nombre} creada`, icon: 'i-lucide-circle-check', color: 'success' })
}

function desactivar(motivo: string): Promise<Resultado<Bodega>> {
    const bodega = aDesactivar.value
    return bodega ? useBodegas().desactivar(bodega, motivo) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige una bodega', status: 400 } })
}

function alDesactivar(bodega: Bodega) {
    bodegas.value = bodegas.value.map(b => (b.id === bodega.id ? bodega : b))
    toast.add({ title: `${bodega.nombre} desactivada`, icon: 'i-lucide-circle-check', color: 'success' })
}

const MOTIVOS_RECHAZO: Record<string, string> = {
    sin_vinculo: 'sin usuario vinculado en Argos',
    usuario_inexistente: 'el usuario no existe',
    usuario_inactivo: 'usuario inactivo',
    fuera_de_la_empresa: 'no es de esta empresa',
    no_es_tecnico: 'no tiene rol de técnico',
}
</script>

<template>
    <PanelPagina
        id="inventario-bodegas"
        titulo="Bodegas y traslados"
        icono="i-lucide-warehouse"
        sin-descripcion
    >
        <template #acciones>
            <UButton
                v-if="puede('bodegas.crear')"
                label="Nueva bodega"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                class="boton-flotante rounded-full"
                data-prueba="nueva-bodega"
                @click="abrir(null)"
            />
            <UButton
                v-if="puede('inventario.crear_traslado')"
                label="Nuevo traslado"
                icon="i-lucide-truck"
                size="lg"
                to="/inventario/traslados/nueva"
                class="glow-brand rounded-full px-5"
                data-prueba="nuevo-traslado"
            />
        </template>

        <div class="flex min-h-0 flex-1 flex-col gap-4">
            <ProblemaAlerta
                v-if="problemaBodegas"
                :problema="problemaBodegas"
                :reintentar="cargarBodegas"
                :reintentando="cargandoBodegas"
            />
            <div
                v-else
                class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                data-prueba="tabla-bodegas"
            >
                <template v-if="cargandoBodegas && !bodegas.length">
                    <USkeleton
                        v-for="n in 4"
                        :key="n"
                        class="h-36 rounded-2xl"
                    />
                </template>
                <article
                    v-for="b in visibles"
                    :key="b.id"
                    class="surface-card flex min-w-0 flex-col gap-3 rounded-2xl p-4"
                    :class="b.activo ? '' : 'opacity-60'"
                    :data-bodega="b.nombre"
                >
                    <div class="flex items-start gap-3">
                        <span
                            class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                            :class="tono(b)"
                        >
                            <UIcon
                                :name="icono(b)"
                                class="size-5"
                            />
                        </span>
                        <div class="flex min-w-0 flex-1 flex-col">
                            <span class="truncate font-semibold text-highlighted">{{ b.nombre }}</span>
                            <span class="truncate text-xs text-muted">{{ subtitulo(b) }}</span>
                        </div>
                        <UDropdownMenu
                            :items="menuBodega(b)"
                            :content="{ align: 'end' }"
                        >
                            <UButton
                                icon="i-lucide-ellipsis"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Acciones de ${b.nombre}`"
                            />
                        </UDropdownMenu>
                    </div>
                    <template v-if="problemaExistencias">
                        <span class="text-sm font-semibold text-highlighted">No se pudo leer</span>
                        <UButton
                            label="Reintentar"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="link"
                            size="xs"
                            class="self-start px-0"
                            @click="cargarExistencias"
                        />
                    </template>
                    <template v-else>
                        <span class="text-[1.375rem] font-bold tabular-nums text-highlighted">{{ formatearQuetzales(valorDe(b).toFixed(2)) }}</span>
                        <span class="text-sm text-muted">{{ detalle(b) }}</span>
                    </template>
                    <div class="flex flex-wrap gap-1.5">
                        <UBadge
                            v-if="caminoA(b).length && !esBodegaTransito(b)"
                            :label="`${caminoA(b).length} ${caminoA(b).length === 1 ? 'traslado' : 'traslados'} en camino`"
                            icon="i-lucide-truck"
                            color="warning"
                            variant="subtle"
                            size="sm"
                            class="rounded-full"
                        />
                        <UBadge
                            v-if="!b.activo"
                            label="Desactivada"
                            icon="i-lucide-circle-pause"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            class="rounded-full"
                        />
                        <span
                            v-if="b.tipo === 'tecnico'"
                            class="text-xs text-muted"
                            data-prueba="bodega-tope"
                        >Solo la mueve {{ b.usuario_nombre ?? 'su técnico' }}</span>
                    </div>
                </article>
                <div
                    v-if="!cargandoBodegas && !visibles.length"
                    class="sm:col-span-2 xl:col-span-4"
                >
                    <UEmpty
                        icon="i-lucide-warehouse"
                        title="Sin bodegas"
                        description="Crea la bodega central y la de cada técnico."
                        variant="naked"
                    />
                </div>
            </div>
            <USwitch
                v-if="bodegas.some(b => !b.activo)"
                v-model="verInactivas"
                label="Ver también las desactivadas"
                size="sm"
            />

            <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-2xl">
                <InventarioTrasladosLista titulo="Traslados" />
            </div>
        </div>

        <BodegaFormulario
            v-model:open="formularioAbierto"
            :bodega="editando"
            @guardado="alGuardar"
        />
        <AccionMotivoModal
            v-model:open="desactivarAbierto"
            titulo="Desactivar bodega"
            :efecto="`«${aDesactivar?.nombre ?? ''}» deja de recibir movimientos. Solo se puede sin existencias.`"
            confirmar="Desactivar"
            icono="i-lucide-circle-pause"
            :ejecutar="motivo => desactivar(motivo)"
            @hecho="alDesactivar"
        />
        <USlideover
            v-model:open="miembrosAbierto"
            :title="cuadrilla ? `${cuadrilla.nombre}: jefe y miembros` : 'Cuadrilla'"
            description="La membresía llega de Iris; aquí solo se consulta."
        >
            <template #body>
                <ul
                    v-if="cuadrilla && miembros.get(cuadrilla.id)"
                    class="flex flex-col gap-2"
                    data-prueba="miembros-cuadrilla"
                >
                    <li
                        v-for="m in miembros.get(cuadrilla.id)!.miembros"
                        :key="m.iris_usuario_id"
                        class="flex items-center gap-3 rounded-xl border border-(--ax-borde) p-3"
                    >
                        <AvatarIniciales :nombre="m.nombre ?? m.iris_usuario_id" />
                        <div class="flex min-w-0 flex-1 flex-col">
                            <span class="font-semibold text-highlighted">{{ m.nombre ?? m.iris_usuario_id }}</span>
                            <span class="text-xs text-muted">{{ m.aceptado ? `Desde ${formatearFechaCorta(m.desde)}` : `No se aplicó: ${MOTIVOS_RECHAZO[m.motivo ?? ''] ?? m.motivo}` }}</span>
                        </div>
                        <UBadge
                            v-if="m.usuario_id !== null && m.usuario_id === miembros.get(cuadrilla.id)!.jefe_id"
                            label="Jefe"
                            icon="i-lucide-star"
                            color="primary"
                            variant="subtle"
                            class="rounded-full"
                        />
                        <UBadge
                            v-else-if="!m.aceptado"
                            label="Rechazado"
                            icon="i-lucide-circle-x"
                            color="error"
                            variant="subtle"
                            class="rounded-full"
                        />
                    </li>
                </ul>
                <p
                    v-else
                    class="text-sm text-muted"
                >
                    Leyendo los miembros…
                </p>
            </template>
        </USlideover>
    </PanelPagina>
</template>
