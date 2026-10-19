<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Momento de certificar (`certificar_al`) de cada plantilla de facturación (contrato §8.3):
 * «al emitir», «al pagar» (aviso de cobro) o «nunca» (no se admite con la FEL obligatoria: 422
 * `certificar_al_incompatible`). Se cambia con `PUT /plantillas-facturacion/:id`
 * (`plantillas.editar`) y la `version` leída. Las excepciones por servicio viven en el servicio.
 */
const props = defineProps<{
    modo: ModoFel
}>()

const { puede } = usePermisos()
const toast = useToast()

const plantillas = shallowRef<PlantillaFacturacion[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const guardando = ref<number | null>(null)
const problemaGuardar = ref<Problem | null>(null)

const items: SelectItem[] = (Object.keys(CERTIFICAR_AL) as CertificarAl[]).map(valor => ({ label: CERTIFICAR_AL[valor].etiqueta, value: valor, description: CERTIFICAR_AL[valor].descripcion }))

const columnas: TableColumn<PlantillaFacturacion>[] = [
    { accessorKey: 'nombre', header: 'Plantilla', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'certificar_al', header: 'Certificar' },
]

const incompatibles = computed(() => (props.modo === 'obligatoria' ? plantillas.value.filter(p => p.certificar_al === 'nunca') : []))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePlantillas().listar()
    cargando.value = false
    plantillas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

async function cambiar(plantilla: PlantillaFacturacion, valor: unknown) {
    if (typeof valor !== 'string' || !(valor in CERTIFICAR_AL) || valor === plantilla.certificar_al) {
        return
    }
    guardando.value = plantilla.id
    problemaGuardar.value = null
    const resultado = await usePlantillas().cambiarCertificarAl(plantilla, valor as CertificarAl)
    guardando.value = null
    if (!resultado.ok) {
        problemaGuardar.value = resultado.problema
        // Vuelve a mostrar lo que está guardado.
        plantillas.value = [...plantillas.value]
        return
    }
    plantillas.value = plantillas.value.map(p => (p.id === plantilla.id ? resultado.data : p))
    toast.add({ title: `${plantilla.nombre}: certificar ${CERTIFICAR_AL[resultado.data.certificar_al].etiqueta.toLowerCase()}`, description: 'Rige para las facturas que se emitan desde ahora.', icon: 'i-lucide-check', color: 'success' })
}

onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-3">
        <p class="text-sm text-muted">
            Las plantillas nuevas nacen «al pagar». Cada servicio puede tener su excepción (ficha del servicio). Lo ya emitido no cambia.
        </p>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <template v-else>
            <UAlert
                v-if="incompatibles.length"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                title="Plantillas incompatibles con la FEL obligatoria"
                :description="`${incompatibles.map(p => p.nombre).join(', ')}: «nunca» no se admite con la FEL obligatoria.`"
                data-prueba="certificar-al-incompatible"
            />
            <UTable
                :data="plantillas"
                :columns="columnas"
                :loading="cargando"
                data-prueba="tabla-certificar-al"
            >
                <template #nombre-cell="{ row }">
                    <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                </template>
                <template #certificar_al-cell="{ row }">
                    <USelect
                        v-if="puede('plantillas.editar')"
                        :model-value="row.original.certificar_al"
                        :items="items"
                        :loading="guardando === row.original.id"
                        :disabled="guardando !== null"
                        class="w-40"
                        :aria-label="`Momento de certificar de ${row.original.nombre}`"
                        @update:model-value="valor => cambiar(row.original, valor)"
                    />
                    <span
                        v-else
                        class="text-sm"
                    >{{ CERTIFICAR_AL[row.original.certificar_al].etiqueta }}</span>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-file-cog"
                        title="Sin plantillas de facturación"
                        variant="naked"
                    />
                </template>
            </UTable>
            <ProblemaAlerta
                v-if="problemaGuardar"
                :problema="problemaGuardar"
            />
        </template>
    </div>
</template>
