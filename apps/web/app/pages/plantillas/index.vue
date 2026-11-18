<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

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

const columnas: TableColumn<PlantillaFacturacion>[] = [
    { accessorKey: 'nombre', header: 'Plantilla', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'corte', header: 'Corte', meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell whitespace-normal' } } },
    { id: 'mora', header: 'Mora', meta: SOLO_ANCHO },
    { id: 'promesas', header: 'Promesas', meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell whitespace-normal' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]
</script>

<template>
    <PanelPagina
        id="plantillas"
        titulo="Plantillas"
        icono="i-lucide-file-cog"
    >
        <template #acciones>
            <UButton
                v-if="puede('plantillas.crear')"
                label="Nueva plantilla"
                icon="i-lucide-plus"
                data-prueba="nueva-plantilla"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <p class="text-sm text-muted">
                    Cada servicio factura con una plantilla: ciclo, días de gracia, cuándo limitar y suspender, recargo por mora, cuándo certificar con FEL y qué promesas de pago acepta.
                </p>
                <UButton
                    v-if="puedeAsignar && porDefecto"
                    label="Asignar a servicios sin plantilla"
                    icon="i-lucide-list-checks"
                    color="neutral"
                    variant="outline"
                    class="shrink-0 self-start"
                    data-prueba="asignar-sin-plantilla"
                    @click="abrirAsignar(porDefecto)"
                />
            </div>

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
            <UTable
                v-else
                :data="plantillas"
                :columns="columnas"
                :loading="cargando"
                :ui="{ td: 'py-3' }"
                data-prueba="tabla-plantillas"
            >
                <template #nombre-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :data-plantilla="row.original.id"
                    >
                        <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                            {{ row.original.nombre }}
                            <UBadge
                                v-if="row.original.por_defecto"
                                label="Por defecto"
                                icon="i-lucide-star"
                                color="primary"
                                variant="subtle"
                                size="sm"
                                data-prueba="plantilla-defecto"
                            />
                            <UBadge
                                :label="`FEL: ${CERTIFICAR_AL[row.original.certificar_al].etiqueta.toLowerCase()}`"
                                color="neutral"
                                variant="outline"
                                size="sm"
                            />
                        </span>
                        <span class="text-xs text-muted">{{ resumenCiclo(row.original) }}</span>
                        <span class="text-xs text-muted lg:hidden">{{ resumenCorte(row.original) }}</span>
                        <span class="text-xs text-muted sm:hidden">{{ resumenMora(row.original) }}</span>
                        <span class="text-xs text-muted md:hidden">{{ resumenPromesas(row.original.reglas_promesa) }}</span>
                        <span
                            class="text-xs text-muted md:hidden"
                            data-prueba="resumen-reconexion"
                        >{{ resumenReconexionTemporal(row.original.reglas_promesa) }}</span>
                        <span
                            v-if="row.original.reglas_promesa.mismas_reglas_ia_operador"
                            class="text-xs text-muted md:hidden"
                            data-prueba="plantilla-mismas-reglas"
                        >IA: mismas reglas que operador</span>
                    </div>
                </template>
                <template #corte-cell="{ row }">
                    <span class="text-sm">{{ resumenCorte(row.original) }}</span>
                </template>
                <template #mora-cell="{ row }">
                    <span class="whitespace-nowrap text-sm">{{ resumenMora(row.original) }}</span>
                </template>
                <template #promesas-cell="{ row }">
                    <div class="flex flex-col gap-1">
                        <span class="text-sm">{{ resumenPromesas(row.original.reglas_promesa) }}</span>
                        <span
                            class="text-xs text-muted"
                            data-prueba="resumen-reconexion"
                        >{{ resumenReconexionTemporal(row.original.reglas_promesa) }}</span>
                        <div
                            v-if="row.original.reglas_promesa.habilitadas"
                            class="flex flex-wrap gap-1"
                        >
                            <UBadge
                                v-for="canal in CANALES_REGLAS.filter(c => limitesEfectivosCanal(row.original.reglas_promesa, c).permitido && limitesEfectivosCanal(row.original.reglas_promesa, c).requiere_aprobacion)"
                                :key="canal"
                                :label="`${CANALES_PROMESA[canal]}: con aprobación`"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                            <UBadge
                                v-if="row.original.reglas_promesa.mismas_reglas_ia_operador"
                                label="IA: mismas reglas que operador"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                data-prueba="plantilla-mismas-reglas"
                            />
                        </div>
                    </div>
                </template>
                <template #acciones-cell="{ row }">
                    <div class="flex justify-end gap-1">
                        <UTooltip
                            v-if="puedeAsignar && row.original.retirada_en === null"
                            text="Asignar a servicios sin plantilla"
                        >
                            <UButton
                                icon="i-lucide-list-checks"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Asignar ${row.original.nombre} a servicios sin plantilla`"
                                :data-prueba="`asignar-sin-plantilla-${row.original.id}`"
                                @click="abrirAsignar(row.original)"
                            />
                        </UTooltip>
                        <UButton
                            :icon="puede('plantillas.editar') ? 'i-lucide-pencil' : 'i-lucide-eye'"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`${puede('plantillas.editar') ? 'Editar' : 'Ver'} ${row.original.nombre}`"
                            :data-prueba="`editar-plantilla-${row.original.id}`"
                            @click="abrir(row.original)"
                        />
                    </div>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-file-cog"
                        title="Todavía no hay plantillas"
                        description="Crea al menos una antes de dar de alta servicios (o de importar desde Mikrowisp)."
                        variant="naked"
                    />
                </template>
            </UTable>
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
