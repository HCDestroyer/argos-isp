<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Cargar una factura de compra desde un archivo (`POST /compras/borradores`, `compras.cargar_borrador`;
 * `contratos/inventario.md` D.5): el XML FEL de la SAT, un PDF o una imagen (la lee la IA). Queda un
 * borrador para revisar; sin IA o si falla, el borrador queda vacío para capturarlo a mano. 409
 * `archivo_duplicado` (el mismo archivo) y `compra_duplicada` (la factura ya está registrada) se ven aquí.
 */
definePageMeta({ permiso: 'compras.cargar_borrador' })

useHead({ title: 'Cargar factura de compra · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const TAMANO_MAXIMO = 10 * 1024 * 1024
const archivo = ref<File | null>(null)
const error = ref<string | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
let clave = nuevaClaveIdempotencia()

watch(archivo, (nuevo) => {
    clave = nuevaClaveIdempotencia()
    problema.value = null
    error.value = nuevo && nuevo.size > TAMANO_MAXIMO ? `El archivo pesa ${tamanoArchivo(nuevo.size)}; el máximo es 10 MB` : null
})

async function cargar(manual: boolean) {
    if (!manual && !archivo.value) {
        error.value = 'Elige el XML, el PDF o la imagen de la factura'
        return
    }
    if (error.value && !manual) {
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useBorradoresCompra().cargar(manual ? null : archivo.value, manual ? nuevaClaveIdempotencia() : clave)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    toast.add({
        title: resultado.data.error_extraccion ? 'Borrador creado para capturar a mano' : 'Factura leída',
        description: resultado.data.error_extraccion ? textoErrorExtraccion(resultado.data.error_extraccion).titulo : 'Revisa los datos y confirma la compra.',
        icon: resultado.data.error_extraccion ? 'i-lucide-keyboard' : 'i-lucide-file-check',
        color: resultado.data.error_extraccion ? 'warning' : 'success',
    })
    if (puede('compras.ver')) {
        await navigateTo(`/compras/borradores/${resultado.data.id}`)
    }
}

const codigoError = computed(() => (problema.value ? codigoProblema(problema.value) : null))

/* Borradores por revisar */
const lista = usePaginacionCursor(cursor => useBorradoresCompra().listar({ estado: 'borrador' }, cursor))
onMounted(() => {
    if (puede('compras.ver')) {
        void lista.recargar()
    }
})

const columnas: TableColumn<BorradorCompra>[] = [
    { accessorKey: 'numero', header: 'Factura', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'fuente', header: 'Origen', meta: SOLO_ANCHO },
    { accessorKey: 'created_at', header: 'Cargado', meta: SOLO_ANCHO },
]
</script>

<template>
    <PanelPagina
        id="compras-cargar"
        titulo="Cargar factura de compra"
        icono="i-lucide-file-up"
    >
        <template #acciones>
            <UButton
                v-if="puede('compras.ver')"
                label="Compras"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
                to="/compras"
            />
        </template>

        <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
            <UCard>
                <div class="flex flex-col gap-4">
                    <UFormField
                        label="Factura"
                        name="archivo"
                        :error="error ?? undefined"
                        help="El XML FEL se lee exacto. Un PDF o una imagen los lee la IA y marca qué tan segura está de cada dato."
                    >
                        <UFileUpload
                            v-model="archivo"
                            accept=".xml,text/xml,application/xml,application/pdf,image/jpeg,image/png,image/webp"
                            label="Elige o arrastra el archivo"
                            description="XML FEL, PDF, JPG, PNG o WebP, hasta 10 MB"
                            icon="i-lucide-file-up"
                            class="w-full"
                            data-prueba="compra-archivo"
                        />
                    </UFormField>
                    <UAlert
                        v-if="codigoError === 'compra_duplicada'"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-copy-x"
                        title="Esta factura ya está registrada"
                        :description="problema?.detail ?? 'El mismo emisor, serie y número ya están en las compras de la empresa.'"
                        data-prueba="compra-duplicada"
                    />
                    <UAlert
                        v-else-if="codigoError === 'archivo_duplicado'"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-copy-x"
                        title="Este archivo ya se cargó"
                        :description="problema?.detail ?? 'Hay un borrador vivo con el mismo archivo: revísalo en la lista de abajo.'"
                        data-prueba="archivo-duplicado"
                    />
                    <ProblemaAlerta
                        v-else-if="problema"
                        :problema="problema"
                        con-errores
                    />
                    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <UButton
                            label="Capturar a mano"
                            icon="i-lucide-keyboard"
                            color="neutral"
                            variant="outline"
                            :disabled="cargando"
                            data-prueba="compra-manual"
                            @click="cargar(true)"
                        />
                        <UButton
                            label="Cargar"
                            icon="i-lucide-upload"
                            :loading="cargando"
                            data-prueba="compra-cargar"
                            @click="cargar(false)"
                        />
                    </div>
                </div>
            </UCard>

            <UCard
                v-if="puede('compras.ver')"
                :ui="{ body: 'p-0 sm:p-0' }"
            >
                <template #header>
                    <h2 class="text-sm font-semibold text-highlighted">
                        Por revisar
                    </h2>
                </template>
                <ProblemaAlerta
                    v-if="lista.problema.value"
                    :problema="lista.problema.value"
                    :reintentar="lista.recargar"
                    :reintentando="lista.cargando.value"
                    class="m-4"
                />
                <template v-else>
                    <UTable
                        :data="lista.filas.value"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        :ui="{ td: 'py-3' }"
                        data-prueba="tabla-borradores"
                    >
                        <template #numero-cell="{ row }">
                            <div
                                class="flex min-w-0 flex-col gap-0.5"
                                :data-borrador="row.original.id"
                            >
                                <ULink
                                    :to="`/compras/borradores/${row.original.id}`"
                                    class="text-sm font-medium text-highlighted hover:text-primary"
                                >{{ row.original.numero ? `${row.original.serie ?? ''} ${row.original.numero}`.trim() : `Borrador #${row.original.id}` }}</ULink>
                                <span class="text-xs text-muted">{{ row.original.emisor_nit ? `NIT ${row.original.emisor_nit}` : (row.original.archivo_nombre ?? 'Sin archivo') }}</span>
                            </div>
                        </template>
                        <template #fuente-cell="{ row }">
                            <UBadge
                                :label="FUENTES_BORRADOR[row.original.fuente].etiqueta"
                                :icon="FUENTES_BORRADOR[row.original.fuente].icono"
                                :color="row.original.error_extraccion ? 'warning' : 'neutral'"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #created_at-cell="{ row }">
                            <span class="text-sm">{{ formatearFechaHora(row.original.created_at) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-file-check"
                                title="Nada por revisar"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="lista.pagina.value"
                        :hay-anterior="lista.hayAnterior.value"
                        :hay-siguiente="lista.haySiguiente.value"
                        :cargando="lista.cargando.value"
                        :filas="lista.filas.value.length"
                        @anterior="lista.anterior"
                        @siguiente="lista.siguiente"
                    />
                </template>
            </UCard>
        </div>
    </PanelPagina>
</template>
