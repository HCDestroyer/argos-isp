<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem } from '@nuxt/ui'

/**
 * Imprimir una factura (tablero OperFacturaDetalle): «Carta» o «POS 80 mm» y la vista previa real
 * del PDF (`GET /documentos/aviso-cobro/:id?plantilla_id=`) con la plantilla predeterminada de ese
 * papel. Las plantillas se leen con `documentos.ver`; sin el permiso se imprime con la
 * predeterminada del sistema. «Imprimir» abre el mismo PDF en otra pestaña.
 *
 * `compacta`: solo los dos botones (panel de la lista de facturas), sin vista previa.
 */
const props = withDefaults(defineProps<{
    facturaId: number
    compacta?: boolean
}>(), {
    compacta: false,
})

const { puede } = usePermisos()
const toast = useToast()

type Papel = PlantillaDocumentoResumen['formato']
const ETIQUETAS_PAPEL: Record<Papel, { etiqueta: string, icono: string }> = {
    carta: { etiqueta: 'Carta', icono: 'i-lucide-file' },
    pos_80: { etiqueta: 'POS 80 mm', icono: 'i-lucide-receipt' },
}

const plantillas = shallowRef<PlantillaDocumentoResumen[]>([])
const problemaPlantillas = ref<Problem | null>(null)
const papel = ref<Papel>('carta')

/** La plantilla de cada papel: la predeterminada, si no la primera activa. */
function plantillaDe(formato: Papel): PlantillaDocumentoResumen | null {
    const delPapel = plantillas.value.filter(p => p.formato === formato)
    return delPapel.find(p => p.predeterminada) ?? delPapel[0] ?? null
}

const elegida = computed(() => plantillaDe(papel.value))
const papeles = computed<TabsItem[]>(() => (['carta', 'pos_80'] as Papel[])
    .filter(formato => !puede('documentos.ver') || problemaPlantillas.value || plantillaDe(formato))
    .map(formato => ({ label: ETIQUETAS_PAPEL[formato].etiqueta, value: formato, icon: ETIQUETAS_PAPEL[formato].icono })))

async function cargarPlantillas() {
    if (!puede('documentos.ver')) {
        return
    }
    const resultado = await usePlantillasDocumentos().listar({ tipo: 'aviso_cobro', activa: true })
    plantillas.value = resultado.ok ? resultado.data : []
    problemaPlantillas.value = resultado.ok ? null : resultado.problema
    // Empieza con el papel de la predeterminada del tipo.
    const predeterminada = plantillas.value.find(p => p.predeterminada)
    if (predeterminada) {
        papel.value = predeterminada.formato
    }
}

const urlVista = ref<string | null>(null)
const cargandoVista = ref(false)
const problemaVista = ref<Problem | null>(null)

function liberar() {
    if (urlVista.value) {
        URL.revokeObjectURL(urlVista.value)
        urlVista.value = null
    }
}

async function cargarVista() {
    if (props.compacta) {
        return
    }
    cargandoVista.value = true
    problemaVista.value = null
    const resultado = await useDocumentos().avisoCobro(props.facturaId, elegida.value?.id ?? null)
    cargandoVista.value = false
    liberar()
    if (!resultado.ok) {
        problemaVista.value = resultado.problema
        return
    }
    urlVista.value = URL.createObjectURL(resultado.data)
}

const imprimiendo = ref(false)

async function imprimir(formato: Papel = papel.value) {
    imprimiendo.value = true
    const problema = await abrirPdf(() => useDocumentos().avisoCobro(props.facturaId, plantillaDe(formato)?.id ?? null), `factura-${props.facturaId}.pdf`)
    imprimiendo.value = false
    if (problema) {
        toast.add({ title: 'No se pudo generar el PDF', description: problema.detail ?? problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
    }
}

watch([() => props.facturaId, elegida], cargarVista)
onMounted(async () => {
    await cargarPlantillas()
    void cargarVista()
})
onBeforeUnmount(liberar)
</script>

<template>
    <div
        v-if="compacta"
        class="grid grid-cols-2 gap-2"
        data-prueba="imprimir-factura"
    >
        <UButton
            v-for="formato in (['carta', 'pos_80'] as Papel[])"
            :key="formato"
            :label="ETIQUETAS_PAPEL[formato].etiqueta"
            :icon="ETIQUETAS_PAPEL[formato].icono"
            color="neutral"
            variant="outline"
            class="justify-center"
            :disabled="puede('documentos.ver') && !problemaPlantillas && plantillas.length > 0 && !plantillaDe(formato)"
            :loading="imprimiendo && papel === formato"
            @click="papel = formato; imprimir(formato)"
        />
    </div>

    <section
        v-else
        class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem]"
        aria-labelledby="titulo-imprimir"
        data-prueba="aviso-pdf"
    >
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-4">
            <h2
                id="titulo-imprimir"
                class="flex items-center gap-2 text-lg font-bold text-highlighted"
            >
                <UIcon
                    name="i-lucide-printer"
                    class="size-5"
                />
                Imprimir
            </h2>
            <OperPestanas
                v-if="papeles.length > 1"
                v-model="papel"
                :items="papeles"
                etiqueta="Papel"
                class="w-auto"
            />
        </header>
        <div class="flex min-h-64 flex-1 items-start justify-center overflow-y-auto bg-(--ax-panel) p-4">
            <ProblemaAlerta
                v-if="problemaVista"
                :problema="problemaVista"
                :reintentar="cargarVista"
                :reintentando="cargandoVista"
                class="w-full"
            />
            <USkeleton
                v-else-if="cargandoVista || !urlVista"
                class="h-96 w-full max-w-xs"
            />
            <iframe
                v-else
                :src="urlVista"
                :title="`Vista previa de la factura #${facturaId}`"
                class="h-[30rem] w-full rounded-lg bg-white shadow-lg"
                :class="papel === 'pos_80' ? 'max-w-xs' : ''"
                data-prueba="vista-previa-factura"
            />
        </div>
        <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-(--ax-borde) p-4 text-xs text-muted">
            <span>
                <template v-if="elegida">Plantilla: «{{ elegida.nombre }}»</template>
                <template v-else>Plantilla predeterminada</template>
                <template v-if="puede('documentos.ver')">
                    ·
                    <ULink
                        :to="elegida ? `/configuracion/plantillas-documentos/${elegida.id}` : '/configuracion/aviso-cobro'"
                        class="text-primary underline"
                    >Cambiar</ULink>
                </template>
            </span>
            <UButton
                label="Imprimir"
                icon="i-lucide-printer"
                :loading="imprimiendo"
                @click="imprimir()"
            />
        </footer>
    </section>
</template>
