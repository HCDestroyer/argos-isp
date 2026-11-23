<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Pestaña «Resumen» de la ficha del cliente (tablero NuevoClienteFicha): aviso de servicio
 * suspendido o limitado con «Promesa» (sin monto ni otro Cobrar: el saldo vive solo en la franja),
 * contadores que la franja no tiene (pagado este año, cliente desde y promesas), sus servicios y la
 * actividad reciente de la bitácora. Todo sale de la API; lo que falló se muestra con «Reintentar».
 */
const props = defineProps<{
    cliente: Cliente
    servicios: Servicio[] | null
    problemaServicios: Problem | null
    cuenta: EstadoCuenta | null
    problemaCuenta: Problem | null
}>()

const emit = defineEmits<{
    ir: [pestana: string]
    cuentaCambiada: []
    reintentarServicios: []
}>()

const { puede, enlace } = usePermisos()

const resumen = computed(() => resumenCuentaCliente(props.cuenta))
const vivos = computed(() => props.servicios?.filter(s => s.estado !== 'retirado') ?? null)
const cortados = computed(() => vivos.value?.filter(s => s.estado === 'suspendido' || s.estado === 'limitado') ?? [])
const estadoAviso = computed(() => peorEstadoServicios(cortados.value))

/** Pagado este año: suma de los pagos registrados del año; con más de 200, no se suma a medias. */
const pagadoAnio = shallowRef<{ total: Decimal, pagos: number } | 'incompleto' | null>(null)
const problemaPagos = ref<Problem | null>(null)
const anio = hoyGuatemala().slice(0, 4)

async function cargarPagos() {
    pagadoAnio.value = null
    problemaPagos.value = null
    if (!puede('pagos.ver')) {
        return
    }
    const resultado = await usePagos().listar({ cliente_id: props.cliente.id, limit: 200 })
    if (!resultado.ok) {
        problemaPagos.value = resultado.problema
        return
    }
    const delAnio = resultado.data.data.filter(p => p.estado === 'registrado' && hoyGuatemala(new Date(p.created_at)).startsWith(anio))
    const masViejo = resultado.data.data.at(-1)
    if (resultado.data.nextCursor && masViejo && hoyGuatemala(new Date(masViejo.created_at)).startsWith(anio)) {
        pagadoAnio.value = 'incompleto'
        return
    }
    pagadoAnio.value = { total: delAnio.reduce((suma, p) => suma.plus(p.monto), new Decimal(0)), pagos: delAnio.length }
}

/**
 * Promesas del cliente: la activa (o pendiente) si hay; si no, cuántas de las cerradas se
 * cumplieron. Se cuentan las últimas 25; con más, lo dice.
 */
const promesas = shallowRef<{ abierta: Promesa | null, cumplidas: number, cerradas: number, mas: boolean } | null>(null)
const problemaPromesas = ref<Problem | null>(null)

async function cargarPromesas() {
    promesas.value = null
    problemaPromesas.value = null
    if (!puede('promesas.ver')) {
        return
    }
    const resultado = await usePromesas().listar({ cliente_id: props.cliente.id })
    if (!resultado.ok) {
        problemaPromesas.value = resultado.problema
        return
    }
    const lista = resultado.data.data
    promesas.value = {
        abierta: lista.find(p => p.estado === 'activa' || p.estado === 'pendiente_aprobacion') ?? null,
        cumplidas: lista.filter(p => p.estado === 'cumplida').length,
        cerradas: lista.filter(p => p.estado === 'cumplida' || p.estado === 'incumplida').length,
        mas: !!resultado.data.nextCursor,
    }
}

const valorPromesas = computed(() => {
    const p = promesas.value
    if (!p) {
        return null
    }
    if (p.abierta) {
        return p.abierta.estado === 'activa' ? `Activa hasta ${formatearFechaCorta(p.abierta.vence_en)}` : 'Por aprobar'
    }
    return p.cerradas ? `${p.cumplidas} de ${p.cerradas} cumplidas` : 'Ninguna'
})

const detallePromesas = computed(() => {
    const p = promesas.value
    if (!p || p.abierta) {
        return p?.abierta ? `${p.cumplidas} de ${p.cerradas} cumplidas antes` : undefined
    }
    return p.mas ? 'de las últimas 25' : (p.cerradas ? undefined : 'Sin promesas de pago')
})

/** Actividad reciente: las 3 últimas entradas de la bitácora del cliente (sin las lecturas del portal). */
const actividad = shallowRef<AccionAuditoria[] | null>(null)
const problemaActividad = ref<Problem | null>(null)

async function cargarActividad() {
    actividad.value = null
    problemaActividad.value = null
    if (!puede('bitacora.ver')) {
        return
    }
    const resultado = await useBitacora().acciones({ cliente_id: props.cliente.id, excluir_canal: 'portal', limit: 3 })
    actividad.value = resultado.ok ? resultado.data.data : null
    problemaActividad.value = resultado.ok ? null : resultado.problema
}

onMounted(() => {
    void cargarPagos()
    void cargarPromesas()
    void cargarActividad()
})
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="cliente-resumen"
    >
        <!-- Aviso de corte: qué pasó y la promesa. El monto y «Cobrar» viven solo en la franja. -->
        <div
            v-if="estadoAviso && cortados.length"
            class="flex flex-col gap-3 rounded-2xl p-4 ring sm:flex-row sm:items-center"
            :class="estadoAviso === 'suspendido' ? 'bg-error/8 ring-error/30' : 'bg-warning/10 ring-warning/30'"
            role="status"
            data-prueba="aviso-corte"
        >
            <span class="hidden shrink-0 sm:block">
                <span
                    class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                    :class="estadoAviso === 'suspendido' ? 'tono-error' : 'tono-aviso'"
                >
                    <UIcon
                        :name="ESTADOS_SERVICIO[estadoAviso].icono"
                        class="size-5"
                    />
                </span>
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
                <p
                    class="font-bold"
                    :class="estadoAviso === 'suspendido' ? 'text-error' : 'text-warning'"
                >
                    {{ cortados.length === 1 ? 'Servicio' : 'Servicios' }} {{ estadoAviso === 'suspendido' ? (cortados.length === 1 ? 'suspendido' : 'suspendidos') : (cortados.length === 1 ? 'limitado' : 'limitados') }}<template v-if="resumen?.vencidas">
                        por mora
                    </template>
                </p>
                <p class="text-sm text-default">
                    Al cobrar o dar promesa se reactiva al instante.
                </p>
            </div>
            <PromesaServicioBoton
                :servicios="cortados"
                :boton="{ class: 'rounded-full self-start sm:self-auto' }"
                @creada="emit('cuentaCambiada')"
            />
        </div>

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <TarjetaDato
                v-if="puede('pagos.ver')"
                :etiqueta="`Pagado en ${anio}`"
                icono="i-lucide-circle-check"
                tono="tono-exito"
                :valor="pagadoAnio === 'incompleto' ? 'Más de 200 pagos' : pagadoAnio ? formatearQuetzales(pagadoAnio.total) : null"
                :detalle="pagadoAnio && pagadoAnio !== 'incompleto' ? (pagadoAnio.pagos === 1 ? '1 pago' : `${pagadoAnio.pagos} pagos`) : undefined"
                :problema="problemaPagos"
                @reintentar="cargarPagos"
            />
            <TarjetaDato
                etiqueta="Cliente desde"
                icono="i-lucide-history"
                tono="tono-marca"
                :valor="formatearMesAnio(cliente.created_at)"
                :detalle="formatearFecha(cliente.created_at)"
            />
            <TarjetaDato
                v-if="puede('promesas.ver')"
                etiqueta="Promesas"
                icono="i-lucide-hand"
                tono="tono-aviso"
                :valor="valorPromesas"
                :detalle="detallePromesas"
                :problema="problemaPromesas"
                class="col-span-2 lg:col-span-1"
                data-prueba="resumen-promesas"
                @reintentar="cargarPromesas"
            />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <section
                v-if="puede('servicios.ver')"
                class="surface-card flex flex-col gap-2 rounded-2xl p-4"
                aria-labelledby="resumen-servicios"
            >
                <div class="flex items-center justify-between">
                    <h3
                        id="resumen-servicios"
                        class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
                    >
                        Servicios
                    </h3>
                    <UButton
                        label="Ver todos"
                        color="primary"
                        variant="link"
                        size="sm"
                        @click="emit('ir', 'servicios')"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaServicios"
                    :problema="problemaServicios"
                    :reintentar="() => emit('reintentarServicios')"
                />
                <div
                    v-else-if="!vivos"
                    class="flex flex-col gap-2"
                >
                    <USkeleton
                        v-for="i in 2"
                        :key="i"
                        class="h-12 w-full"
                    />
                </div>
                <ul
                    v-else-if="vivos.length"
                    class="-mx-2 flex flex-col divide-y divide-(--ax-borde)"
                >
                    <ListaItem
                        v-for="servicio in vivos"
                        :key="servicio.id"
                        :titulo="etiquetaServicio(servicio)"
                        :subtitulo="[servicio.codigo, servicio.nombre, servicio.plan_nombre, servicio.ipv4].filter(Boolean).join(' · ')"
                        icono="i-lucide-wifi"
                        :to="enlace(`/servicios/${servicio.id}`)"
                    >
                        <template #derecha>
                            <EstadoServicioBadge
                                :estado="servicio.estado"
                                size="sm"
                                class="rounded-full"
                            />
                        </template>
                    </ListaItem>
                </ul>
                <UEmpty
                    v-else
                    icon="i-lucide-wifi-off"
                    title="Sin servicios"
                    variant="naked"
                    size="sm"
                />
            </section>

            <section
                v-if="puede('bitacora.ver')"
                class="surface-card flex flex-col gap-2 rounded-2xl p-4"
                aria-labelledby="resumen-actividad"
            >
                <div class="flex items-center justify-between">
                    <h3
                        id="resumen-actividad"
                        class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
                    >
                        Actividad reciente
                    </h3>
                    <UButton
                        label="Bitácora"
                        color="primary"
                        variant="link"
                        size="sm"
                        @click="emit('ir', 'bitacora')"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaActividad"
                    :problema="problemaActividad"
                    :reintentar="cargarActividad"
                />
                <div
                    v-else-if="!actividad"
                    class="flex flex-col gap-2"
                >
                    <USkeleton
                        v-for="i in 3"
                        :key="i"
                        class="h-12 w-full"
                    />
                </div>
                <ul
                    v-else-if="actividad.length"
                    class="-mx-2 flex flex-col divide-y divide-(--ax-borde)"
                >
                    <ListaItem
                        v-for="entrada in actividad"
                        :key="entrada.id"
                        :titulo="tituloAccion(entrada)"
                        :subtitulo="`${formatearFechaCorta(entrada.created_at)} · ${entrada.actor_nombre ?? entrada.canal}`"
                        :icono="iconoAccion(entrada)"
                    />
                </ul>
                <UEmpty
                    v-else
                    icon="i-lucide-history"
                    title="Sin actividad"
                    variant="naked"
                    size="sm"
                />
            </section>
        </div>
    </div>
</template>
