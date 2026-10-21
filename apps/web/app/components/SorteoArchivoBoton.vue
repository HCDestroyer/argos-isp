<script setup lang="ts">
/**
 * Descarga un archivo del sorteo (evidencia del checklist, constancia de una entrega) con la sesión
 * (`GET .../archivos/:archivoId`, `sorteos.ver`). Muestra su nombre, tamaño y SHA-256 abreviado; si la
 * descarga falla lo dice en un aviso, nunca abre un archivo vacío.
 */
const props = defineProps<{
    sorteoId: number
    archivoId: number
    /** Los archivos del sorteo (`SorteoDetalle.archivos`), para el nombre y la huella. */
    archivos: ArchivoSorteo[]
}>()

const { puede } = usePermisos()
const toast = useToast()
const descargando = ref(false)

const archivo = computed(() => props.archivos.find(a => a.id === props.archivoId) ?? null)
const nombre = computed(() => archivo.value?.nombre ?? `Archivo #${props.archivoId}`)

async function descargar() {
    if (!puede('sorteos.ver') || descargando.value) {
        return
    }
    descargando.value = true
    const resultado = await useSorteos().archivo(props.sorteoId, props.archivoId)
    descargando.value = false
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo descargar el archivo', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    guardarBlob(resultado.data, nombre.value)
}
</script>

<template>
    <UButton
        :label="nombre"
        icon="i-lucide-paperclip"
        color="neutral"
        variant="link"
        size="xs"
        class="max-w-full justify-start px-0"
        :ui="{ label: 'truncate' }"
        :loading="descargando"
        :title="archivo ? `${tamanoArchivo(archivo.tamano)} · SHA-256 ${archivo.sha256}` : undefined"
        :aria-label="`Descargar ${nombre}`"
        data-prueba="archivo-sorteo"
        @click="descargar"
    />
</template>
