<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem } from '@nuxt/ui'

/**
 * Plantillas de facturación (A3, tarea 8 del brief): lista con su ciclo, corte, mora, FEL y
 * promesas; alta (`plantillas.crear`) y edición (`plantillas.editar`) con todas las reglas de
 * promesas, generales y por canal. Sin `plantillas.editar` se abren en solo lectura. La API no
 * borra plantillas: un servicio siempre tiene la suya (`.claude/integration/a4.md`).
 *
 * Plantillas de fábrica (decisión del PM, 18 nov): «Asignar a servicios sin plantilla»
 * (`plantillas.asignar_sin_plantilla`) en la cabecera, con la de por defecto, y en cada fila vigente;
 * si «Genera 1 · vence 15» existe pero otra es la de por defecto, un aviso ofrece «Marcar como por
 * defecto» (`PUT` con `por_defecto` y `version`, `plantillas.editar`).
 *
 * Rediseño (tablero OperPlantillasFacturacion): a la izquierda las plantillas con buscador; a la
 * derecha la abierta con pestañas «Ciclo y corte» y «Promesas y reconexión», la línea «Así corre
 * el mes de un cliente» y sus reglas. El formulario completo (más de 8 campos) se abre en el panel
 * lateral («Editar plantilla»).
 */
definePageMeta({ permiso: 'plantillas.ver' })

useHead({ title: 'Plantillas · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const plantillas = shallowRef<PlantillaFacturacion[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await usePlantillas().listar()
    cargando.value = false
    plantillas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

const editando = shallowRef<PlantillaFacturacion | null>(null)
const formularioAbierto = ref(false)
const soloLectura = computed(() => editando.value !== null && !puede('plantillas.editar'))

function abrir(plantilla: PlantillaFacturacion | null) {
    editando.value = plantilla
    formularioAbierto.value = true
}

function alGuardar(plantilla: PlantillaFacturacion) {
    toast.add({
        title: editando.value ? `${plantilla.nombre} actualizada` : `${plantilla.nombre} creada`,
        description: `${resumenCiclo(plantilla)} · ${resumenPromesas(plantilla.reglas_promesa)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    // Marcar una por defecto desmarca la anterior: se relee la lista completa.
    void cargar()
}

const puedeAsignar = computed(() => puede('plantillas.asignar_sin_plantilla'))
const vigentes = computed(() => plantillas.value.filter(p => p.retirada_en === null))
const porDefecto = computed(() => vigentes.value.find(p => p.por_defecto) ?? null)

const asignando = shallowRef<PlantillaFacturacion | null>(null)
const asignarAbierto = ref(false)

function abrirAsignar(plantilla: PlantillaFacturacion) {
    asignando.value = plantilla
    asignarAbierto.value = true
}

/** La de fábrica que el PM eligió por defecto, si existe, está vigente y no es la marcada. */
const fabricaSinMarcar = computed(() => {
    const fabrica = vigentes.value.find(p => p.nombre === PLANTILLA_FABRICA_POR_DEFECTO)
    return fabrica && !fabrica.por_defecto ? fabrica : null
})
const marcando = ref(false)

async function marcarPorDefecto(plantilla: PlantillaFacturacion) {
    marcando.value = true
    const resultado = await usePlantillas().marcarPorDefecto(plantilla)
    marcando.value = false
    if (resultado.ok) {
        toast.add({
            title: `${resultado.data.nombre} es la plantilla por defecto`,
            description: 'Los servicios nuevos sin plantilla facturan con esta. Los que ya tienen una no cambian.',
            icon: 'i-lucide-circle-check',
            color: 'success',
        })
    }
    else {
        toast.add({
            title: resultado.problema.title,
            description: resultado.problema.status === 409 ? 'Otra persona cambió las plantillas: se recargó la lista.' : resultado.problema.detail,
            icon: 'i-lucide-circle-alert',
            color: 'error',
        })
    }
    void cargar()
}

const route = useRoute()
const busqueda = ref('')
const visibles = computed(() => {
    const texto = busqueda.value.trim().toLocaleLowerCase('es')
    return plantillas.value.filter(p => !texto || p.nombre.toLocaleLowerCase('es').includes(texto))
})
const abiertaId = ref(Number(route.query.id) || 0)
const abierta = computed(() => plantillas.value.find(p => p.id === abiertaId.value) ?? null)
watch(plantillas, (lista) => {
    if (!lista.some(p => p.id === abiertaId.value)) {
        abiertaId.value = (lista.find(p => p.por_defecto) ?? lista[0])?.id ?? 0
    }
})

/** Pestaña del editor: `?seccion=promesas` llega desde Promesas («Reglas por plantilla»). */
const seccion = ref<'ciclo' | 'promesas'>(route.query.seccion === 'promesas' ? 'promesas' : 'ciclo')
const secciones: TabsItem[] = [
    { label: 'Ciclo y corte', value: 'ciclo', icon: 'i-lucide-calendar' },
    { label: 'Promesas y reconexión', value: 'promesas', icon: 'i-lucide-hand' },
]

/** Puntos de «Así corre el mes de un cliente» (el corte va por facturas vencidas, no por días). */
interface PuntoMes { etiqueta: string, valor: string, tono: string }
function lineaDelMes(plantilla: PlantillaFacturacion): PuntoMes[] {
    const emite = plantilla.ciclo === 'aniversario' ? 'Inst.' : String(plantilla.dia ?? '—')
    const vence = plantilla.ciclo === 'aniversario' ? `+${plantilla.dias_gracia}` : String((plantilla.dia ?? 1) + plantilla.dias_gracia)
    const puntos: PuntoMes[] = [
        { etiqueta: 'Emite', valor: emite, tono: 'tono-marca' },
        { etiqueta: plantilla.dias_gracia ? `Vence (${plantilla.dias_gracia} d)` : 'Vence', valor: vence, tono: 'tono-2' },
    ]
    if (plantilla.facturas_para_limitar > 0) {
        puntos.push({ etiqueta: `Limita (${plantilla.facturas_para_limitar} venc.)`, valor: `${plantilla.facturas_para_limitar}`, tono: 'tono-aviso' })
    }
    puntos.push({ etiqueta: `Suspende (${plantilla.facturas_para_cortar} venc.)`, valor: `${plantilla.facturas_para_cortar}`, tono: 'tono-error' })
    return puntos
}

function nombreEstadoPlantilla(plantilla: PlantillaFacturacion): { etiqueta: string, color: 'primary' | 'neutral' | 'warning' } | null {
    if (plantilla.retirada_en) {
        return { etiqueta: 'Retirada', color: 'neutral' }
    }
    return plantilla.por_defecto ? { etiqueta: 'Por defecto', color: 'primary' } : null
}
</script>

<template>
    <PanelPagina
        id="plantillas"
        titulo="Plantillas de facturación"
        icono="i-lucide-file-cog"
        descripcion="Cuándo se emite, cuándo vence, cuándo se corta y qué promesas se aceptan. Cada servicio usa una."
    >
        <template #acciones>
            <UButton
                v-if="puedeAsignar && porDefecto"
                label="Asignar a servicios sin plantilla"
                icon="i-lucide-list-checks"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
                data-prueba="asignar-sin-plantilla"
                @click="abrirAsignar(porDefecto)"
            />
            <UButton
                v-if="puede('plantillas.crear')"
                label="Nueva plantilla"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand px-5"
                data-prueba="nueva-plantilla"
                @click="abrir(null)"
            />
        </template>

        <UAlert
            v-if="!problema && fabricaSinMarcar && puede('plantillas.editar')"
            color="warning"
            variant="subtle"
            icon="i-lucide-star"
            :title="`${fabricaSinMarcar.nombre} no es la plantilla por defecto`"
            :description="porDefecto ? `Ahora lo es ${porDefecto.nombre}. La de por defecto la reciben los servicios sin plantilla.` : 'Ninguna está marcada. La de por defecto la reciben los servicios sin plantilla.'"
            :actions="[{ label: 'Marcar como por defecto', icon: 'i-lucide-star', color: 'warning', variant: 'outline', loading: marcando, onClick: () => marcarPorDefecto(fabricaSinMarcar!) }]"
            data-prueba="marcar-por-defecto"
        />

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else
            class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]"
        >
            <!-- Plantillas. -->
            <section
                class="surface-card flex min-h-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]"
                data-prueba="tabla-plantillas"
            >
                <div class="border-b border-(--ax-borde) p-3">
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Buscar plantilla…"
                        aria-label="Buscar plantilla"
                        class="w-full"
                    />
                </div>
                <USkeleton
                    v-if="cargando && !plantillas.length"
                    class="m-3 h-40"
                />
                <ul class="flex min-h-0 flex-col divide-y divide-(--ax-borde) overflow-y-auto">
                    <li
                        v-for="plantilla in visibles"
                        :key="plantilla.id"
                        :data-plantilla="plantilla.id"
                    >
                        <UButton
                            color="neutral"
                            variant="ghost"
                            class="w-full items-start gap-2 rounded-none px-4 py-3 text-start"
                            :class="plantilla.id === abiertaId ? CLASE_FILA_ELEGIDA : ''"
                            :aria-pressed="plantilla.id === abiertaId"
                            @click="abiertaId = plantilla.id"
                        >
                            <span class="flex min-w-0 flex-1 flex-col">
                                <span class="font-semibold text-highlighted">{{ plantilla.nombre }}</span>
                                <span class="text-xs font-normal text-muted">{{ resumenCiclo(plantilla) }}</span>
                                <span class="text-xs font-normal text-muted">{{ resumenMora(plantilla) }}</span>
                            </span>
                            <UBadge
                                v-if="nombreEstadoPlantilla(plantilla)"
                                :label="nombreEstadoPlantilla(plantilla)?.etiqueta"
                                :color="nombreEstadoPlantilla(plantilla)?.color"
                                variant="subtle"
                                size="sm"
                                :data-prueba="plantilla.por_defecto ? 'plantilla-defecto' : undefined"
                            />
                        </UButton>
                    </li>
                    <li
                        v-if="!cargando && !visibles.length"
                        class="p-4"
                    >
                        <UEmpty
                            icon="i-lucide-file-cog"
                            :title="busqueda ? 'Ninguna plantilla coincide' : 'Todavía no hay plantillas'"
                            :description="busqueda ? undefined : 'Crea al menos una antes de dar de alta servicios (o de importar desde Mikrowisp).'"
                            variant="naked"
                        />
                    </li>
                </ul>
            </section>

            <!-- La plantilla abierta. -->
            <section
                v-if="abierta"
                class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]"
                data-prueba="plantilla-abierta"
            >
                <header class="flex flex-wrap items-center gap-3 border-b border-(--ax-borde) p-4">
                    <div class="flex min-w-0 flex-1 flex-col">
                        <h2 class="flex flex-wrap items-center gap-2 text-lg font-bold text-highlighted">
                            {{ abierta.nombre }}
                            <UBadge
                                v-if="abierta.por_defecto"
                                label="Por defecto"
                                color="primary"
                                variant="subtle"
                                size="sm"
                            />
                        </h2>
                        <p class="text-[0.8125rem] text-muted">
                            Última edición: {{ formatearFechaHora(abierta.updated_at) }} · versión {{ abierta.version }}
                        </p>
                    </div>
                    <OperPestanas
                        v-model="seccion"
                        :items="secciones"
                        etiqueta="Secciones de la plantilla"
                        class="w-auto"
                    />
                </header>

                <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0">
                    <template v-if="seccion === 'ciclo'">
                        <section
                            class="rounded-2xl border border-(--ax-borde) p-4"
                            aria-labelledby="titulo-mes"
                        >
                            <h3
                                id="titulo-mes"
                                class="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
                            >
                                <UIcon
                                    name="i-lucide-eye"
                                    class="size-4"
                                />
                                Así corre el mes de un cliente
                            </h3>
                            <ol
                                class="relative flex items-start justify-between gap-2"
                                data-prueba="linea-del-mes"
                            >
                                <span
                                    class="absolute inset-x-6 top-5 h-1 rounded-full bg-gradient-to-r from-primary/30 via-warning/40 to-error/40"
                                    aria-hidden="true"
                                />
                                <li
                                    v-for="punto in lineaDelMes(abierta)"
                                    :key="punto.etiqueta"
                                    class="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
                                >
                                    <span
                                        class="pastilla-tono flex size-10 items-center justify-center rounded-full bg-(--ax-tarjeta) text-sm font-bold ring-2 ring-current"
                                        :class="punto.tono"
                                    >{{ punto.valor }}</span>
                                    <span class="text-xs font-semibold text-highlighted">{{ punto.etiqueta }}</span>
                                </li>
                            </ol>
                        </section>

                        <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                            <DatoFicha
                                etiqueta="Día de emisión"
                                :valor="resumenCiclo(abierta)"
                            />
                            <DatoFicha
                                etiqueta="Días para pagar"
                                :valor="abierta.dias_gracia === 0 ? 'Vence el mismo día' : `${abierta.dias_gracia} días`"
                            />
                            <DatoFicha
                                etiqueta="Hora de corte"
                                :valor="`${abierta.hora_corte.slice(0, 5)} h`"
                            />
                            <DatoFicha
                                etiqueta="Limitar velocidad"
                                :valor="abierta.facturas_para_limitar === 0 ? 'Nunca limita' : `Con ${abierta.facturas_para_limitar} ${abierta.facturas_para_limitar === 1 ? 'factura vencida' : 'facturas vencidas'}`"
                            />
                            <DatoFicha
                                etiqueta="Suspender"
                                :valor="`Con ${abierta.facturas_para_cortar} ${abierta.facturas_para_cortar === 1 ? 'factura vencida' : 'facturas vencidas'}`"
                            />
                            <DatoFicha
                                etiqueta="Recargo por mora"
                                :valor="resumenMora(abierta)"
                            />
                            <DatoFicha
                                etiqueta="Factura electrónica"
                                :valor="`Certificar ${CERTIFICAR_AL[abierta.certificar_al].etiqueta.toLowerCase()}`"
                            />
                            <DatoFicha
                                etiqueta="Prorrateo del primer mes"
                                :valor="abierta.prorrateo ? 'Sí' : 'No'"
                            />
                        </dl>
                    </template>

                    <template v-else>
                        <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                            <DatoFicha
                                etiqueta="Promesas de pago"
                                :valor="resumenPromesas(abierta.reglas_promesa)"
                            />
                            <DatoFicha
                                etiqueta="Reconexión temporal"
                                :valor="resumenReconexionTemporal(abierta.reglas_promesa)"
                                data-prueba="resumen-reconexion"
                            />
                        </dl>
                        <section
                            v-if="abierta.reglas_promesa.habilitadas"
                            class="flex flex-col gap-2"
                        >
                            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                                Por canal
                            </h3>
                            <ul class="flex flex-col divide-y divide-(--ax-borde) rounded-2xl border border-(--ax-borde)">
                                <li
                                    v-for="canal in CANALES_REGLAS"
                                    :key="canal"
                                    class="flex items-center justify-between gap-3 px-4 py-2.5"
                                >
                                    <span class="text-sm font-semibold text-highlighted">{{ CANALES_PROMESA[canal] }}</span>
                                    <UBadge
                                        :label="!limitesEfectivosCanal(abierta.reglas_promesa, canal).permitido ? 'No permitido' : limitesEfectivosCanal(abierta.reglas_promesa, canal).requiere_aprobacion ? 'Con aprobación' : 'Directo'"
                                        :color="!limitesEfectivosCanal(abierta.reglas_promesa, canal).permitido ? 'neutral' : limitesEfectivosCanal(abierta.reglas_promesa, canal).requiere_aprobacion ? 'warning' : 'success'"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </li>
                            </ul>
                            <UBadge
                                v-if="abierta.reglas_promesa.mismas_reglas_ia_operador"
                                label="IA: mismas reglas que operador"
                                color="neutral"
                                variant="outline"
                                class="self-start"
                                data-prueba="plantilla-mismas-reglas"
                            />
                        </section>
                        <UAlert
                            color="primary"
                            variant="subtle"
                            icon="i-lucide-info"
                            description="Las promesas son por servicio y cubren todo lo vencido. El simulador de Promesas muestra la regla que aplica antes de crear una."
                        />
                    </template>
                </div>

                <footer class="flex flex-wrap items-center gap-3 border-t border-(--ax-borde) p-4">
                    <p class="min-w-0 flex-1 text-xs text-muted">
                        Los cambios aplican desde el siguiente corte; las facturas ya emitidas no cambian.
                    </p>
                    <UButton
                        v-if="puedeAsignar && abierta.retirada_en === null"
                        label="Asignar a servicios sin plantilla"
                        icon="i-lucide-list-checks"
                        color="neutral"
                        variant="ghost"
                        :data-prueba="`asignar-sin-plantilla-${abierta.id}`"
                        @click="abrirAsignar(abierta)"
                    />
                    <UButton
                        :label="puede('plantillas.editar') ? 'Editar plantilla' : 'Ver todas las reglas'"
                        :icon="puede('plantillas.editar') ? ICONOS.editar : ICONOS.ver"
                        :data-prueba="`editar-plantilla-${abierta.id}`"
                        @click="abrir(abierta)"
                    />
                </footer>
            </section>
            <div
                v-else
                class="surface-card hidden items-center justify-center rounded-[1.375rem] p-6 lg:flex"
            >
                <UEmpty
                    icon="i-lucide-mouse-pointer-click"
                    title="Elige una plantilla"
                    variant="naked"
                />
            </div>
        </div>

        <PlantillaAsignarSinPlantillaModal
            v-if="asignando"
            v-model:open="asignarAbierto"
            :plantilla="asignando"
        />

        <PlantillaFormulario
            v-model:open="formularioAbierto"
            :plantilla="editando"
            :solo-lectura="soloLectura"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
