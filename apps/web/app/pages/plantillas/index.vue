<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Plantillas de facturación (A3, tarea 8 del brief): lista con su ciclo, corte, mora, FEL y
 * promesas; alta (`plantillas.crear`) y edición (`plantillas.editar`) con todas las reglas de
 * promesas, generales y por canal. Sin `plantillas.editar` se abren en solo lectura. La API no
 * borra plantillas: un servicio siempre tiene la suya (`.claude/integration/a4.md`).
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
            <p class="text-sm text-muted">
                Cada servicio factura con una plantilla: ciclo, días de gracia, cuándo limitar y suspender, recargo por mora, cuándo certificar con FEL y qué promesas de pago acepta.
            </p>

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
                        <div
                            v-if="row.original.reglas_promesa.habilitadas"
                            class="flex flex-wrap gap-1"
                        >
                            <UBadge
                                v-for="canal in CANALES_REGLAS.filter(c => row.original.reglas_promesa.canales[c].permitido && row.original.reglas_promesa.canales[c].requiere_aprobacion)"
                                :key="canal"
                                :label="`${CANALES_PROMESA[canal]}: con aprobación`"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                        </div>
                    </div>
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        :icon="puede('plantillas.editar') ? 'i-lucide-pencil' : 'i-lucide-eye'"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`${puede('plantillas.editar') ? 'Editar' : 'Ver'} ${row.original.nombre}`"
                        :data-prueba="`editar-plantilla-${row.original.id}`"
                        @click="abrir(row.original)"
                    />
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

        <PlantillaFormulario
            v-model:open="formularioAbierto"
            :plantilla="editando"
            :solo-lectura="soloLectura"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
