<script setup lang="ts">
/**
 * Un comprobante a pantalla completa (tablero OperComprobanteMovil): la foto, lo declarado, a qué se
 * aplicaría y la decisión fija abajo. Es la pantalla del teléfono y el enlace para compartir; en
 * escritorio la cola abre el comprobante a la derecha (`/comprobantes?id=`). Al decidir pasa al
 * siguiente por revisar (decisión 13) o vuelve a la cola si ya no queda ninguno.
 */
definePageMeta({ permiso: 'comprobantes.ver' })

const route = useRoute()

const comprobanteId = computed(() => Number(route.params.id))

useHead(() => ({ title: `Comprobante #${route.params.id} · ArgosIsp` }))

/** Los pendientes de la cola, para «2 de 5 por revisar» y pasar al siguiente. */
const pendientes = shallowRef<Comprobante[]>([])
const totalPendientes = ref<number | null>(null)

/** Los filtros de la cola de la que vino (`?canal=iris`…): el siguiente sale de esa misma cola. */
const filtrosCola = computed(() => queryFiltrosCola(route.query))

async function cargarCola() {
    const resultado = await useComprobantes().listar({ ...filtrosColaDeQuery(route.query), estado: 'pendiente', limit: 50 })
    pendientes.value = resultado.ok ? resultado.data.data : []
    totalPendientes.value = resultado.ok ? resultado.data.resumen.total : null
}

const posicion = computed(() => {
    const indice = pendientes.value.findIndex(c => c.id === comprobanteId.value)
    return indice >= 0 && totalPendientes.value !== null ? `${indice + 1} de ${totalPendientes.value} por revisar` : null
})

async function alDecidir(decidido: Comprobante) {
    const indice = pendientes.value.findIndex(c => c.id === decidido.id)
    const siguiente = pendientes.value.slice(indice + 1)[0] ?? pendientes.value.find(c => c.id !== decidido.id)
    await cargarCola()
    if (siguiente && pendientes.value.some(c => c.id === siguiente.id)) {
        await navigateTo({ path: `/comprobantes/${siguiente.id}`, query: filtrosCola.value })
    }
}

watch(comprobanteId, cargarCola)
onMounted(cargarCola)
</script>

<template>
    <PanelPagina
        id="comprobante"
        :titulo="`Comprobante #${route.params.id}`"
        icono="i-lucide-file-check-2"
        encabezado-propio
    >
        <div class="mx-auto flex w-full max-w-4xl min-w-0 flex-col">
            <ComprobanteRevision
                :comprobante-id="comprobanteId"
                :posicion="posicion"
                movil
                @decidido="alDecidir"
            >
                <template #antes-del-titulo>
                    <UButton
                        :to="{ path: '/comprobantes', query: filtrosCola }"
                        :icon="ICONOS.volver"
                        color="neutral"
                        variant="ghost"
                        class="boton-flotante boton-circulo shrink-0"
                        aria-label="Volver a comprobantes"
                    />
                </template>
            </ComprobanteRevision>
        </div>
    </PanelPagina>
</template>
