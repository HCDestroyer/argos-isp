<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn, TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Ficha de una declaración (`GET /declaraciones/:id`, `declaraciones.ver`): totales por secciones
 * (débitos, créditos, retenciones, remanentes e impuesto determinado; en pequeño contribuyente el
 * porcentaje sobre ventas), los renglones de cada sección, las versiones del periodo, los libros
 * emitidos con folio que cubren el mes, la obligación del calendario, el pago y los checks de
 * impuestos. Acciones según el estado y el permiso de cada una: revisar (liquida y bloquea), marcar
 * presentada, registrar pago y recalcular (borrador nuevo o sustitutiva).
 */
definePageMeta({ permiso: 'declaraciones.ver' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const { conSelector, nombre: nombreEmpresa } = useEmpresaActiva()

const id = computed(() => Number(route.params.id))
const declaracion = shallowRef<DeclaracionDetalle | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const versiones = shallowRef<Declaracion[]>([])
const problemaVersiones = ref<Problem | null>(null)

useHead({ title: computed(() => (declaracion.value ? `${etiquetaImpuestoDeclaracion(declaracion.value.impuesto)} ${periodoDeclaracion(declaracion.value)} · ArgosIsp` : 'Declaración · ArgosIsp')) })

async function cargarVersiones(d: Declaracion) {
    const resultado = await useDeclaraciones().listar({ impuesto: [d.impuesto === 'pc_mensual' ? 'pc_mensual' : 'iva_mensual'], periodo: periodoDeclaracion(d), limit: 50 })
    versiones.value = resultado.ok ? resultado.data.data.filter(v => v.empresa_id === d.empresa_id).sort((a, b) => b.version - a.version) : []
    problemaVersiones.value = resultado.ok ? null : resultado.problema
}

async function cargar() {
    if (!Number.isInteger(id.value) || id.value <= 0) {
        return
    }
    cargando.value = true
    const resultado = await useDeclaraciones().ver(id.value)
    cargando.value = false
    declaracion.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        void cargarVersiones(resultado.data)
    }
}

watch(id, () => void cargar())
onMounted(cargar)

const periodo = computed(() => (declaracion.value ? periodoDeclaracion(declaracion.value) : ''))
const acciones = computed(() => (declaracion.value ? accionesDeclaracion(declaracion.value) : null))
const vigente = computed(() => versionVigente(versiones.value))
const secciones = computed(() => (declaracion.value ? seccionesTotales(declaracion.value.impuesto) : []))
const tasaPc = computed(() => (declaracion.value ? tasaPequenoContribuyente(declaracion.value) : null))
/** Lo pagado por versiones anteriores del periodo (el pago de esta versión es la diferencia). */
const pagadoAntes = computed(() => versiones.value
    .filter(v => v.id !== declaracion.value?.id && v.pago)
    .reduce((s, v) => s.plus(v.pago?.impuesto ?? '0'), new Decimal(0))
    .toFixed(2))

/* Renglones por sección. */
const seccion = ref<SeccionRenglon>('ventas')
const renglones = computed(() => (declaracion.value?.detalle.renglones ?? []).filter(r => r.seccion === seccion.value))
const itemsSeccion = computed<TabsItem[]>(() => (Object.keys(SECCIONES_RENGLON) as SeccionRenglon[])
    .filter(s => s !== 'compras' || declaracion.value?.impuesto !== 'pc_mensual')
    .map(s => ({
        label: `${SECCIONES_RENGLON[s].etiqueta} (${(declaracion.value?.detalle.renglones ?? []).filter(r => r.seccion === s).length})`,
        value: s,
        icon: SECCIONES_RENGLON[s].icono,
    })))
const columnasRenglones = computed<TableColumn<RenglonDeclaracion>[]>(() => [
    { accessorKey: 'documento', header: 'Documento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'base', header: 'Base', meta: { class: { th: 'hidden sm:table-cell text-right', td: 'hidden sm:table-cell text-right tabular-nums' } } },
    { accessorKey: 'iva', header: SECCIONES_RENGLON[seccion.value].columnaIva, meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'hidden md:table-cell text-right', td: 'hidden md:table-cell text-right tabular-nums' } } },
])

/* Acciones. */
/** Meses que rectificó la última revisión hecha desde esta ficha (H34). */
const rectificados = shallowRef<MesRectificado[]>([])
const revisando = ref(false)
const presentando = ref(false)
const pagando = ref(false)
const recalculando = ref(false)

function alTerminar(d: Declaracion, titulo: string, descripcion: string) {
    toast.add({ title: titulo, description: descripcion, icon: 'i-lucide-check', color: 'success' })
    if (d.id !== id.value) {
        void router.push(`/declaraciones/${d.id}`)
        return
    }
    void cargar()
    void checklist.value?.cargar()
}

function alRevisar(d: DeclaracionRevisada) {
    rectificados.value = d.cascada
    const extra = d.cascada.length ? ` Se rectificaron también: ${d.cascada.map(textoMesRectificado).join('; ')}.` : ''
    alTerminar(d, 'Declaración revisada', `Liquidación registrada y los impuestos de ${etiquetaPeriodo(periodo.value)} bloqueados.${extra}`)
}

function alPagar(d: Declaracion) {
    const pago = d.pago
    alTerminar(d, 'Pago registrado', pago ? `Impuesto ${formatearQuetzales(pago.impuesto)} + mora ${formatearQuetzales(pago.mora)} + multa ${formatearQuetzales(pago.multa)} = ${formatearQuetzales(pago.total)}.` : 'Pago registrado.')
}

function recalcular(): Promise<Resultado<Declaracion>> {
    const d = declaracion.value
    if (!d) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Sin declaración', status: 0 } })
    }
    return useDeclaraciones().calcular({
        impuesto: d.impuesto === 'pc_mensual' ? 'pc_mensual' : 'iva_mensual',
        periodo: periodoDeclaracion(d),
        empresa_id: d.empresa_id,
        ...(acciones.value?.sustitutiva ? { sustitutiva: true } : {}),
    }, nuevaClaveIdempotencia()).then(r => (r.ok ? r : { ok: false as const, problema: problemaDeclaracionLegible(r.problema) }))
}

/* Checks de impuestos del mes. */
const checklist = useTemplateRef('checklist')
const mesChecks = ref<string | undefined>(undefined)
watch(periodo, (p) => {
    mesChecks.value = p || undefined
}, { immediate: true })

function verChecklist() {
    void checklist.value?.cargar()
    document.getElementById('declaracion-checks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
    <PanelPagina
        id="declaracion"
        :titulo="declaracion ? `${etiquetaImpuestoDeclaracion(declaracion.impuesto)} · ${etiquetaPeriodo(periodo)}` : 'Declaración'"
        icono="i-lucide-file-spreadsheet"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!declaracion"
            class="h-96 w-full"
        />
        <div
            v-else
            class="flex flex-col gap-4"
            data-prueba="declaracion-ficha"
            :data-estado="declaracion.estado"
        >
            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    label="Declaraciones"
                    icon="i-lucide-arrow-left"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    to="/declaraciones"
                />
                <UBadge
                    :label="ESTADOS_DECLARACION[declaracion.estado].etiqueta"
                    :icon="ESTADOS_DECLARACION[declaracion.estado].icono"
                    :color="ESTADOS_DECLARACION[declaracion.estado].color"
                    variant="subtle"
                    data-prueba="declaracion-estado"
                />
                <UBadge
                    :label="`Versión ${declaracion.version}${declaracion.sustitutiva ? ' · sustitutiva' : ''}`"
                    color="neutral"
                    variant="outline"
                    data-prueba="declaracion-version"
                />
                <UBadge
                    v-if="declaracion.pago"
                    label="Pagada"
                    icon="i-lucide-banknote"
                    color="success"
                    variant="outline"
                />
                <span
                    v-if="conSelector"
                    class="text-sm text-muted"
                >{{ nombreEmpresa(declaracion.empresa_id) }}</span>
            </div>
            <p class="text-sm text-muted">
                {{ ESTADOS_DECLARACION[declaracion.estado].ayuda }}
            </p>

            <UAlert
                v-if="declaracion.estado === 'sustituida'"
                color="neutral"
                variant="subtle"
                icon="i-lucide-history"
                title="Versión sustituida"
                :description="vigente && vigente.id !== declaracion.id ? `La versión vigente del periodo es la ${vigente.version}.` : 'Una versión posterior la reemplaza.'"
                :actions="vigente && vigente.id !== declaracion.id ? [{ label: `Ver versión ${vigente.version}`, color: 'neutral', variant: 'outline', to: `/declaraciones/${vigente.id}` }] : undefined"
                data-prueba="declaracion-sustituida"
            />
            <UAlert
                v-else-if="declaracion.desactualizada"
                color="warning"
                variant="subtle"
                icon="i-lucide-refresh-cw"
                title="Los datos cambiaron desde que se calculó"
                :description="`Los libros o las constancias de ${etiquetaPeriodo(periodo)} ya no dan este borrador: revisar o marcar presentada responderá que está desactualizada. Calcule otra versión${acciones?.sustitutiva ? ' (sustitutiva)' : ''}.`"
                :actions="puede('declaraciones.calcular') ? [{ label: acciones?.sustitutiva ? 'Calcular sustitutiva' : 'Recalcular', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'outline', onClick: () => { recalculando = true } }] : undefined"
                data-prueba="declaracion-desactualizada"
            />

            <UAlert
                v-if="rectificados.length"
                color="warning"
                variant="subtle"
                icon="i-lucide-git-branch"
                :title="rectificados.length === 1 ? 'Se rectificó también 1 mes posterior' : `Se rectificaron también ${rectificados.length} meses posteriores`"
                close
                data-prueba="declaracion-cascada"
                @update:open="rectificados = []"
            >
                <template #description>
                    <p class="mb-1">
                        Esta revisión cambió el remanente que arrastran: cada uno tiene una sustitutiva revisada que liquida la diferencia.
                    </p>
                    <ul class="flex flex-col gap-1">
                        <li
                            v-for="m in rectificados"
                            :key="m.declaracion_id"
                            :data-periodo="m.periodo"
                        >
                            <ULink
                                raw
                                :to="`/declaraciones/${m.declaracion_id}`"
                                class="underline underline-offset-2"
                            >
                                {{ textoMesRectificado(m) }}
                            </ULink>
                            · remanente {{ formatearQuetzales(m.remanente_credito_anterior) }} → {{ formatearQuetzales(m.remanente_credito) }} · a pagar {{ formatearQuetzales(m.a_pagar) }}
                        </li>
                    </ul>
                </template>
            </UAlert>

            <div
                v-if="acciones && declaracion.estado !== 'sustituida'"
                class="flex flex-wrap gap-2"
                data-prueba="declaracion-acciones"
            >
                <UButton
                    v-if="acciones.revisar && puede('declaraciones.revisar')"
                    label="Revisar y liquidar"
                    icon="i-lucide-file-check"
                    data-prueba="abrir-revisar"
                    @click="revisando = true"
                />
                <UButton
                    v-if="acciones.presentar && puede('declaraciones.presentar')"
                    label="Marcar presentada"
                    icon="i-lucide-send"
                    data-prueba="abrir-presentar"
                    @click="presentando = true"
                />
                <UButton
                    v-if="acciones.pagar && puede('declaraciones.pagar')"
                    label="Registrar pago"
                    icon="i-lucide-banknote"
                    :color="acciones.presentar ? 'neutral' : 'primary'"
                    :variant="acciones.presentar ? 'outline' : 'solid'"
                    data-prueba="abrir-pagar"
                    @click="pagando = true"
                />
                <UButton
                    v-if="acciones.recalcular && puede('declaraciones.calcular')"
                    :label="acciones.sustitutiva ? 'Calcular sustitutiva' : 'Recalcular'"
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-recalcular"
                    @click="recalculando = true"
                />
            </div>

            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div class="flex min-w-0 flex-col gap-4">
                    <UPageCard
                        title="Totales"
                        variant="outline"
                        data-prueba="declaracion-totales"
                    >
                        <div class="flex flex-col gap-4">
                            <section
                                v-for="s in secciones"
                                :key="s.id"
                                class="flex flex-col gap-1"
                                :aria-label="s.titulo"
                                :data-seccion="s.id"
                            >
                                <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
                                    {{ s.titulo }}
                                </h3>
                                <dl class="flex flex-col divide-y divide-default">
                                    <div
                                        v-if="s.id === 'determinado' && declaracion.impuesto === 'pc_mensual'"
                                        class="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                                    >
                                        <dt class="text-muted">
                                            Tasa sobre ventas
                                        </dt>
                                        <dd
                                            class="tabular-nums text-highlighted"
                                            data-prueba="declaracion-tasa"
                                        >
                                            {{ tasaPc === null ? '—' : `${tasaPc} %` }}
                                        </dd>
                                    </div>
                                    <div
                                        v-for="f in s.filas"
                                        :key="f.clave"
                                        class="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                                        :data-total="f.clave"
                                    >
                                        <dt class="flex min-w-0 flex-col">
                                            <span :class="f.destacado ? 'font-semibold text-highlighted' : 'text-default'">{{ f.etiqueta }}</span>
                                            <span
                                                v-if="f.ayuda"
                                                class="text-xs text-muted"
                                            >{{ f.ayuda }}</span>
                                        </dt>
                                        <dd
                                            class="shrink-0 tabular-nums"
                                            :class="f.destacado ? 'text-base font-semibold text-highlighted' : 'text-default'"
                                        >
                                            {{ totalDe(declaracion, f.clave) === null ? '—' : formatearQuetzales(totalDe(declaracion, f.clave)) }}
                                        </dd>
                                    </div>
                                </dl>
                            </section>
                        </div>
                    </UPageCard>

                    <section
                        class="flex flex-col gap-3"
                        aria-label="Renglones"
                    >
                        <UTabs
                            v-model="seccion"
                            :items="itemsSeccion"
                            :content="false"
                            size="sm"
                            class="w-full overflow-x-auto"
                            :ui="{ list: 'w-max sm:w-full', label: 'whitespace-nowrap' }"
                            data-prueba="declaracion-secciones"
                        />
                        <UTable
                            :data="renglones"
                            :columns="columnasRenglones"
                            data-prueba="tabla-renglones"
                        >
                            <template #documento-cell="{ row }">
                                <div class="flex min-w-0 flex-col">
                                    <span class="text-sm text-highlighted">{{ row.original.documento }}</span>
                                    <span class="text-xs text-muted">
                                        {{ formatearFecha(row.original.fecha) }}<template v-if="row.original.nit"> · NIT {{ row.original.nit }}</template><template v-if="row.original.estado"> · {{ row.original.estado }}</template>
                                        <span class="sm:hidden"> · base {{ formatearQuetzales(row.original.base) }}</span>
                                    </span>
                                </div>
                            </template>
                            <template #base-cell="{ row }">
                                {{ formatearQuetzales(row.original.base) }}
                            </template>
                            <template #iva-cell="{ row }">
                                <span :class="row.original.iva.startsWith('-') ? 'text-error' : ''">{{ formatearQuetzales(row.original.iva) }}</span>
                            </template>
                            <template #total-cell="{ row }">
                                {{ formatearQuetzales(row.original.total) }}
                            </template>
                            <template #empty>
                                <UEmpty
                                    :icon="SECCIONES_RENGLON[seccion].icono"
                                    :title="`Sin ${SECCIONES_RENGLON[seccion].etiqueta.toLowerCase()} en el mes`"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </section>
                </div>

                <div class="flex min-w-0 flex-col gap-4">
                    <UPageCard
                        title="Datos"
                        variant="outline"
                    >
                        <dl class="grid grid-cols-2 gap-3 text-sm">
                            <DatoFicha
                                etiqueta="Formulario"
                                :valor="declaracion.formulario ?? 'Por confirmar con contador'"
                            />
                            <DatoFicha
                                etiqueta="Vence"
                                :valor="formatearFecha(declaracion.vence_en)"
                            />
                            <DatoFicha
                                etiqueta="Calculada"
                                :valor="formatearFechaHora(declaracion.calculada_en)"
                            />
                            <DatoFicha
                                etiqueta="Revisada"
                                :valor="declaracion.revisada_en ? formatearFechaHora(declaracion.revisada_en) : null"
                            />
                            <DatoFicha
                                etiqueta="Asiento de liquidación"
                                :valor="declaracion.asiento_id ? `#${declaracion.asiento_id}` : (declaracion.revisada_en ? 'Sin diferencia' : null)"
                            />
                            <DatoFicha
                                v-if="declaracion.numero_formulario"
                                etiqueta="Presentada"
                                :valor="`${declaracion.numero_formulario} · ${formatearFecha(declaracion.fecha_presentacion)}${declaracion.boleta ? ` · boleta ${declaracion.boleta}` : ''}`"
                            />
                        </dl>
                        <UButton
                            label="Ver en el calendario"
                            icon="i-lucide-calendar-check"
                            color="neutral"
                            variant="link"
                            size="sm"
                            class="mt-2 px-0"
                            :to="`/fiscal/calendario?obligacion=${declaracion.obligacion_id}`"
                            data-prueba="declaracion-obligacion"
                        />
                    </UPageCard>

                    <UPageCard
                        title="Pago"
                        variant="outline"
                        data-prueba="declaracion-pago"
                    >
                        <dl
                            v-if="declaracion.pago"
                            class="grid grid-cols-2 gap-3 text-sm"
                        >
                            <DatoFicha
                                etiqueta="Fecha"
                                :valor="formatearFecha(declaracion.pago.fecha)"
                            />
                            <DatoFicha
                                etiqueta="Días de atraso"
                                :valor="String(declaracion.pago.dias_atraso)"
                            />
                            <DatoFicha
                                etiqueta="Impuesto"
                                :valor="formatearQuetzales(declaracion.pago.impuesto)"
                            />
                            <DatoFicha
                                etiqueta="Mora"
                                :valor="formatearQuetzales(declaracion.pago.mora)"
                            />
                            <DatoFicha
                                etiqueta="Multa"
                                :valor="formatearQuetzales(declaracion.pago.multa)"
                            />
                            <DatoFicha etiqueta="Total pagado">
                                <span
                                    class="font-semibold tabular-nums"
                                    data-prueba="pago-total"
                                >{{ formatearQuetzales(declaracion.pago.total) }}</span>
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Boleta"
                                :valor="declaracion.pago.boleta"
                            />
                            <DatoFicha
                                etiqueta="Asiento"
                                :valor="`#${declaracion.pago.asiento_id}`"
                            />
                        </dl>
                        <p
                            v-else
                            class="text-sm text-muted"
                        >
                            {{ acciones?.pagar ? 'Sin pago registrado.' : declaracion.estado === 'borrador' ? 'Se paga después de revisarla.' : 'Sin impuesto por pagar en esta versión.' }}
                        </p>
                    </UPageCard>

                    <UPageCard
                        title="Libros emitidos del mes"
                        variant="outline"
                        data-prueba="declaracion-libros"
                    >
                        <ul
                            v-if="declaracion.detalle.libros.length"
                            class="flex flex-col gap-2"
                        >
                            <li
                                v-for="l in declaracion.detalle.libros"
                                :key="l.emision_id"
                                class="flex flex-col text-sm"
                            >
                                <ULink
                                    v-if="puede('libros.ver')"
                                    :to="`/libros/emisiones?emision=${l.emision_id}`"
                                    class="font-medium text-highlighted hover:text-primary"
                                >
                                    Libro de {{ l.libro }} · {{ rangoFolios(l.folio_inicial, l.folio_final) }}
                                </ULink>
                                <span
                                    v-else
                                    class="font-medium text-highlighted"
                                >Libro de {{ l.libro }} · {{ rangoFolios(l.folio_inicial, l.folio_final) }}</span>
                                <span class="text-xs text-muted">{{ formatearFecha(l.desde) }} – {{ formatearFecha(l.hasta) }}<template v-if="l.iva !== null"> · IVA {{ formatearQuetzales(l.iva) }}</template></span>
                            </li>
                        </ul>
                        <p
                            v-else
                            class="text-sm text-muted"
                        >
                            Ningún libro de ventas o compras emitido con folio cubre el mes.
                            <ULink
                                v-if="puede('libros.ver')"
                                to="/libros"
                                class="text-primary underline underline-offset-2"
                            >
                                Libros legales
                            </ULink>
                        </p>
                    </UPageCard>

                    <UPageCard
                        title="Versiones del periodo"
                        variant="outline"
                        data-prueba="declaracion-versiones"
                    >
                        <ProblemaAlerta
                            v-if="problemaVersiones"
                            :problema="problemaVersiones"
                            :reintentar="() => declaracion && cargarVersiones(declaracion)"
                        />
                        <ul
                            v-else
                            class="flex flex-col gap-1.5"
                        >
                            <li
                                v-for="v in versiones"
                                :key="v.id"
                                class="flex items-center justify-between gap-2 text-sm"
                                :data-version="v.version"
                            >
                                <ULink
                                    :to="`/declaraciones/${v.id}`"
                                    :class="v.id === declaracion.id ? 'font-semibold text-highlighted' : 'text-default hover:text-primary'"
                                    :aria-current="v.id === declaracion.id ? 'page' : undefined"
                                >
                                    Versión {{ v.version }}{{ v.sustitutiva ? ' · sustitutiva' : '' }}
                                </ULink>
                                <UBadge
                                    :label="ESTADOS_DECLARACION[v.estado].etiqueta"
                                    :color="ESTADOS_DECLARACION[v.estado].color"
                                    variant="subtle"
                                    size="sm"
                                />
                            </li>
                        </ul>
                    </UPageCard>
                </div>
            </div>

            <div
                v-if="puede('libro.ver')"
                id="declaracion-checks"
                class="scroll-mt-20"
            >
                <CierreChecklist
                    ref="checklist"
                    v-model:mes="mesChecks"
                    tipo="impuestos"
                    :meses="periodo ? [periodo] : []"
                />
            </div>
        </div>

        <template v-if="declaracion">
            <RevisarDeclaracionModal
                v-if="puede('declaraciones.revisar')"
                v-model:open="revisando"
                :declaracion="declaracion"
                @hecho="alRevisar"
                @checklist="verChecklist"
                @recalcular="recalculando = true"
            />
            <PresentarDeclaracionModal
                v-if="puede('declaraciones.presentar')"
                v-model:open="presentando"
                :declaracion="declaracion"
                @hecho="alTerminar($event, 'Presentación registrada', 'La obligación del calendario queda como presentada.')"
                @recalcular="recalculando = true"
            />
            <PagarDeclaracionModal
                v-if="puede('declaraciones.pagar')"
                v-model:open="pagando"
                :declaracion="declaracion"
                :pagado-antes="pagadoAntes"
                @hecho="alPagar"
            />
            <ConfirmacionModal
                v-if="puede('declaraciones.calcular')"
                v-model:open="recalculando"
                :titulo="acciones?.sustitutiva ? 'Calcular sustitutiva' : 'Recalcular'"
                :efecto="acciones?.sustitutiva ? `Calcula la versión ${declaracion.version + 1} con los datos de hoy; esta pasa a sustituida y la obligación vuelve a borrador. Su revisión liquida solo la diferencia.` : `Calcula la versión ${declaracion.version + 1} con los datos de hoy; esta pasa a sustituida.`"
                :confirmar="acciones?.sustitutiva ? 'Calcular sustitutiva' : 'Recalcular'"
                icono="i-lucide-refresh-cw"
                color="primary"
                :ejecutar="recalcular"
                @hecho="alTerminar($event, `Versión ${$event.version} calculada`, 'Borrador con los datos de hoy.')"
            />
        </template>
    </PanelPagina>
</template>
