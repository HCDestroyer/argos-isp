<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Ficha de una compra (A3, fase 5): documento y proveedor, bases, IVA (con o sin crédito fiscal),
 * retenciones con su constancia, neto y saldo; sus líneas (activo dado de alta o diferimiento), el egreso
 * que la pagó o del que salió, y la NCRE que corrige. Acciones: anular (`compras.anular`, reverso con
 * fecha de hoy), registrar la constancia (`compras.registrar`) y diferir una línea (`libro.registrar_asiento`).
 */
definePageMeta({ permiso: 'compras.ver' })

const route = useRoute()
const toast = useToast()
const { puede, enlace } = usePermisos()

const id = computed(() => Number(route.params.id))
const compra = shallowRef<Compra | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead(() => ({ title: `${compra.value ? documentoCompra(compra.value) : 'Compra'} · ArgosIsp` }))

/* Lo que cuelga de la compra: constancias emitidas, activos y diferimientos. */
const constancias = shallowRef<ConstanciaRetencion[]>([])
const activos = shallowRef<ActivoFijo[]>([])
const diferimientos = shallowRef<Diferimiento[]>([])
const problemaRelacionados = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await useCompras().ver(id.value)
    cargando.value = false
    compra.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        await cargarRelacionados(resultado.data)
    }
}

async function cargarRelacionados(c: Compra) {
    const [rConstancias, rActivos, rDiferimientos] = await Promise.all([
        c.retenciones.length ? useConstancias().listar({ direccion: 'emitida', desde: c.fecha_documento, limit: 200 }) : null,
        puede('activos.ver') && c.lineas.some(l => l.tipo === 'activo_fijo') ? useActivos().listar({ compra_id: c.id }) : null,
        puede('libro.ver') ? useDiferimientos().listar({ compra_id: c.id }) : null,
    ])
    constancias.value = rConstancias?.ok ? rConstancias.data.data.filter(x => x.compra_id === c.id) : []
    activos.value = rActivos?.ok ? rActivos.data.data : []
    diferimientos.value = rDiferimientos?.ok ? rDiferimientos.data.data : []
    problemaRelacionados.value = (rConstancias && !rConstancias.ok ? rConstancias.problema : null)
        ?? (rActivos && !rActivos.ok ? rActivos.problema : null)
        ?? (rDiferimientos && !rDiferimientos.ok ? rDiferimientos.problema : null)
}

function constanciaDe(codigo: string): ConstanciaRetencion | null {
    return constancias.value.find(c => c.impuesto_codigo === codigo && c.vigente) ?? null
}

const retencionesSinConstancia = computed(() => compra.value?.retenciones.filter(r => !constanciaDe(r.impuesto_codigo)) ?? [])
const lineasDiferibles = computed(() => compra.value?.lineas.filter(l => l.tipo !== 'activo_fijo' && !l.diferir_meses && !diferimientos.value.some(d => d.compra_linea_id === l.id && d.estado !== 'cancelado')) ?? [])

const columnasLineas: TableColumn<LineaCompra>[] = [
    { accessorKey: 'descripcion', header: 'Línea', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cuenta_codigo', header: 'Cuenta', meta: SOLO_ANCHO },
    { accessorKey: 'base', header: 'Base', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'iva', header: 'IVA', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
]

/* Acciones. */
const anulando = ref(false)
const registrandoConstancia = ref(false)
const difiriendo = ref(false)

async function anular(motivo: string, clave: string): Promise<Resultado<Compra>> {
    const resultado = await useCompras().anular(id.value, motivo, clave)
    return resultado.ok ? resultado : { ok: false, problema: problemaCompraLegible(resultado.problema) }
}

function alAnular(anulada: Compra) {
    compra.value = anulada
    toast.add({ title: `Compra #${anulada.id} anulada`, description: 'Se registró el reverso con fecha de hoy; el libro de compras la resta en este mes.', icon: 'i-lucide-ban', color: 'neutral' })
    void cargarRelacionados(anulada)
}

function alConstancia(constancia: ConstanciaRetencion) {
    toast.add({ title: 'Constancia registrada', description: `${constancia.numero} · ${formatearQuetzales(constancia.monto)}`, icon: 'i-lucide-file-check-2', color: 'success' })
    if (compra.value) {
        void cargarRelacionados(compra.value)
    }
}

function alDiferir(diferimiento: Diferimiento) {
    toast.add({ title: 'Línea diferida', description: `${diferimiento.descripcion} · ${diferimiento.meses} meses`, icon: 'i-lucide-calendar-range', color: 'success' })
    if (compra.value) {
        void cargarRelacionados(compra.value)
    }
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="compra"
        :titulo="compra ? `Compra #${compra.id}` : 'Compra'"
        icono="i-lucide-shopping-cart"
    >
        <template #acciones>
            <div class="flex flex-wrap gap-2">
                <UButton
                    v-if="compra && puede('libro.registrar_asiento') && compra.estado === 'vigente' && lineasDiferibles.length"
                    label="Diferir línea"
                    :aria-label="'Diferir línea'"
                    :ui="{ label: 'hidden sm:inline' }"
                    icon="i-lucide-calendar-range"
                    color="neutral"
                    variant="outline"
                    @click="difiriendo = true"
                />
                <UButton
                    v-if="compra && puede('compras.anular') && compraAnulable(compra)"
                    label="Anular"
                    :aria-label="'Anular'"
                    :ui="{ label: 'hidden sm:inline' }"
                    icon="i-lucide-ban"
                    color="error"
                    variant="outline"
                    data-prueba="anular-compra"
                    @click="anulando = true"
                />
            </div>
        </template>

        <div class="flex flex-col gap-6">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else-if="compra">
                <UAlert
                    v-if="compra.estado === 'anulada'"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-ban"
                    title="Compra anulada"
                    :description="`${compra.motivo_anulacion ?? ''}${compra.anulado_en ? ` · ${formatearFechaHora(compra.anulado_en)}` : ''}. El libro de compras resta la anulación en su mes.`"
                    data-prueba="compra-anulada"
                />
                <UCard :ui="{ body: 'p-4 sm:p-4' }">
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-base font-semibold text-highlighted">
                                {{ documentoCompra(compra) }}
                            </h2>
                            <UBadge
                                :label="ESTADOS_COMPRA[compra.estado].etiqueta"
                                :color="ESTADOS_COMPRA[compra.estado].color"
                                :icon="ESTADOS_COMPRA[compra.estado].icono"
                                variant="subtle"
                                data-prueba="estado-compra"
                            />
                            <UBadge
                                :label="compra.condicion === 'credito' ? 'Al crédito' : 'Al contado'"
                                color="neutral"
                                variant="outline"
                            />
                            <UBadge
                                v-if="!compra.credito_fiscal"
                                label="Sin crédito fiscal"
                                color="warning"
                                variant="subtle"
                            />
                        </div>
                        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                            <DatoFicha etiqueta="Proveedor">
                                <ULink
                                    :to="puede('proveedores.ver') ? `/proveedores/${compra.proveedor_id}` : undefined"
                                    class="text-highlighted"
                                >
                                    {{ compra.proveedor_nombre }}
                                </ULink>
                                <span class="block text-xs text-muted">NIT {{ compra.proveedor_nit }}</span>
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Tipo"
                                :valor="TIPOS_DOCUMENTO_COMPRA[compra.tipo_documento]"
                            />
                            <DatoFicha
                                etiqueta="Fecha del documento"
                                :valor="formatearFecha(compra.fecha_documento)"
                            />
                            <DatoFicha
                                etiqueta="Mes del IVA"
                                :valor="compra.periodo_iva.slice(0, 7)"
                            />
                            <DatoFicha
                                etiqueta="Fecha contable"
                                :valor="formatearFecha(compra.fecha)"
                            />
                            <DatoFicha
                                v-if="compra.vence_en"
                                etiqueta="Vence"
                                :valor="formatearFecha(compra.vence_en)"
                            />
                            <DatoFicha
                                v-if="compra.autorizacion"
                                etiqueta="Autorización"
                                :valor="compra.autorizacion"
                                mono
                                class="col-span-2"
                            />
                            <DatoFicha
                                v-if="compra.compra_referencia_id"
                                etiqueta="Corrige"
                            >
                                <ULink
                                    :to="`/compras/${compra.compra_referencia_id}`"
                                    class="text-highlighted underline"
                                >
                                    Compra #{{ compra.compra_referencia_id }}
                                </ULink>
                            </DatoFicha>
                            <DatoFicha
                                v-if="compra.egreso_pago_id"
                                etiqueta="Pagada con"
                                :valor="`Egreso #${compra.egreso_pago_id}`"
                            />
                            <DatoFicha
                                v-if="compra.egreso_id"
                                etiqueta="Registrada desde"
                                :valor="`Egreso #${compra.egreso_id}`"
                            />
                            <DatoFicha
                                v-if="compra.descripcion"
                                etiqueta="Descripción"
                                :valor="compra.descripcion"
                                class="col-span-2"
                            />
                        </dl>
                    </div>
                </UCard>

                <dl
                    class="grid grid-cols-2 gap-4 rounded-lg bg-elevated p-4 sm:grid-cols-4"
                    data-prueba="totales-compra"
                >
                    <DatoFicha etiqueta="Base">
                        <span class="tabular-nums">{{ formatearQuetzales(baseCompra(compra)) }}</span>
                    </DatoFicha>
                    <DatoFicha :etiqueta="compra.credito_fiscal ? 'IVA (crédito fiscal)' : 'IVA (al costo)'">
                        <span class="tabular-nums">{{ formatearQuetzales(compra.iva) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Total">
                        <span class="font-semibold tabular-nums">{{ formatearQuetzales(compra.total) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Retenido">
                        <span class="tabular-nums">{{ formatearQuetzales(new Decimal(compra.retencion_iva).plus(compra.retencion_isr).toFixed(2)) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Neto al proveedor">
                        <span class="font-semibold tabular-nums">{{ formatearQuetzales(compra.neto) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Saldo por pagar">
                        <span
                            class="font-semibold tabular-nums"
                            data-prueba="saldo-compra"
                        >{{ formatearQuetzales(compra.saldo) }}</span>
                    </DatoFicha>
                </dl>

                <ProblemaAlerta
                    v-if="problemaRelacionados"
                    :problema="problemaRelacionados"
                    :reintentar="() => compra && cargarRelacionados(compra)"
                />

                <section class="flex flex-col gap-2">
                    <h2 class="text-sm font-semibold text-highlighted">
                        Líneas
                    </h2>
                    <UTable
                        :data="compra.lineas"
                        :columns="columnasLineas"
                        data-prueba="tabla-lineas-compra"
                    >
                        <template #descripcion-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ row.original.descripcion }}</span>
                                <span class="text-xs text-muted">{{ TIPOS_LINEA_COMPRA[row.original.tipo] }}<template v-if="row.original.exento"> · exenta</template><template v-if="row.original.clase_activo"> · {{ etiquetaClaseActivo(row.original.clase_activo) }}</template><template v-if="row.original.diferir_meses"> · diferida en {{ row.original.diferir_meses }} meses</template></span>
                                <ULink
                                    v-if="row.original.producto_id"
                                    :to="enlace(`/inventario/kardex?producto=${row.original.producto_id}`)"
                                    class="text-xs text-primary"
                                    :data-prueba="`linea-inventario-${row.original.id}`"
                                >Inventario: {{ row.original.cantidad ?? 1 }} al kardex del producto #{{ row.original.producto_id }}</ULink>
                            </div>
                        </template>
                        <template #cuenta_codigo-cell="{ row }">
                            <span class="font-mono text-xs">{{ row.original.cuenta_codigo }}</span>
                        </template>
                        <template #base-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.base) }}</span>
                        </template>
                        <template #iva-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.iva) }}</span>
                        </template>
                    </UTable>
                </section>

                <section
                    v-if="compra.retenciones.length"
                    class="flex flex-col gap-2"
                    data-prueba="retenciones-compra"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h2 class="text-sm font-semibold text-highlighted">
                            Retenciones emitidas
                        </h2>
                        <UButton
                            v-if="puede('compras.registrar') && compra.estado === 'vigente' && retencionesSinConstancia.length"
                            label="Registrar constancia"
                            icon="i-lucide-file-check-2"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            data-prueba="abrir-constancia"
                            @click="registrandoConstancia = true"
                        />
                    </div>
                    <ul class="flex flex-col divide-y divide-default rounded-lg border border-default">
                        <li
                            v-for="r in compra.retenciones"
                            :key="r.impuesto_codigo"
                            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                            :data-retencion="r.impuesto_codigo"
                        >
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ RETENCIONES_EMITIDAS[r.impuesto_codigo] ?? r.impuesto_codigo }}</span>
                                <span class="text-xs text-muted">{{ r.tasa }} % sobre {{ formatearQuetzales(r.base) }}</span>
                            </div>
                            <UBadge
                                :label="constanciaDe(r.impuesto_codigo) ? `Constancia ${constanciaDe(r.impuesto_codigo)?.numero}` : 'Sin constancia'"
                                :color="constanciaDe(r.impuesto_codigo) ? 'success' : 'warning'"
                                variant="subtle"
                                size="sm"
                                data-prueba="constancia-estado"
                            />
                            <span class="text-sm font-semibold tabular-nums">{{ formatearQuetzales(r.monto) }}</span>
                        </li>
                    </ul>
                </section>

                <section
                    v-if="activos.length || diferimientos.length"
                    class="flex flex-col gap-2"
                >
                    <h2 class="text-sm font-semibold text-highlighted">
                        Activos y diferidos de esta compra
                    </h2>
                    <ul class="flex flex-col divide-y divide-default rounded-lg border border-default">
                        <li
                            v-for="a in activos"
                            :key="`a-${a.id}`"
                            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                            <ULink
                                :to="`/activos/${a.id}`"
                                class="text-sm font-medium text-highlighted underline"
                            >
                                Activo #{{ a.id }} · {{ a.descripcion }}
                            </ULink>
                            <span class="text-xs text-muted">{{ etiquetaClaseActivo(a.clase) }} · {{ a.tasa_anual }} % anual · {{ ESTADOS_ACTIVO[a.estado].etiqueta }}</span>
                        </li>
                        <li
                            v-for="d in diferimientos"
                            :key="`d-${d.id}`"
                            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                            :data-diferimiento="d.id"
                        >
                            <ULink
                                :to="`/diferimientos/${d.id}`"
                                class="text-sm font-medium text-highlighted underline"
                            >
                                Diferido #{{ d.id }} · {{ d.descripcion }}
                            </ULink>
                            <span class="text-xs text-muted">{{ d.meses }} meses desde {{ d.inicio.slice(0, 7) }} · pendiente {{ formatearQuetzales(d.pendiente) }} · {{ ESTADOS_DIFERIMIENTO[d.estado].etiqueta }}</span>
                        </li>
                    </ul>
                </section>
            </template>
        </div>

        <AccionMotivoModal
            v-if="compra"
            v-model:open="anulando"
            :titulo="`Anular compra #${compra.id}`"
            :descripcion="`${documentoCompra(compra)} de ${compra.proveedor_nombre} · ${formatearQuetzales(compra.total)}`"
            efecto="Se registra el reverso con la fecha de hoy (con las etiquetas de impuesto en signo contrario): el libro de compras la resta en este mes. Al contado se anula también su egreso; sus activos sin cuotas quedan dados de baja y sus diferidos, cancelados."
            confirmar="Anular compra"
            placeholder="Ej.: factura con el NIT equivocado"
            :ejecutar="anular"
            @hecho="alAnular"
        />
        <ConstanciaCompraModal
            v-if="compra"
            v-model:open="registrandoConstancia"
            :compra="compra"
            :retenciones="retencionesSinConstancia"
            @hecho="alConstancia"
        />
        <DiferirLineaModal
            v-if="compra"
            v-model:open="difiriendo"
            :compra="compra"
            :lineas="lineasDiferibles"
            @hecho="alDiferir"
        />
    </PanelPagina>
</template>
