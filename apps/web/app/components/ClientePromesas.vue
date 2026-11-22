<script setup lang="ts">
/**
 * Pestaña «Promesas» de la ficha del cliente: sus promesas (`GET /promesas?cliente_id=`), que son
 * por servicio, con estado, vencimiento y monto. Error con «Reintentar»; vacío real si no tiene.
 */
const props = defineProps<{
    clienteId: number
    servicios: Servicio[] | null
}>()

const { enlace } = usePermisos()
const lista = usePaginacionCursor(cursor => usePromesas().listar({ cliente_id: props.clienteId }, cursor))
const nombres = computed(() => new Map((props.servicios ?? []).map(s => [s.id, etiquetaServicio(s)])))

onMounted(() => void lista.recargar())
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="cliente-promesas"
    >
        <ProblemaAlerta
            v-if="lista.problema.value"
            :problema="lista.problema.value"
            :reintentar="lista.recargar"
            :reintentando="lista.cargando.value"
        />
        <div
            v-else-if="lista.cargando.value && !lista.filas.value.length"
            class="flex flex-col gap-2"
        >
            <USkeleton
                v-for="i in 2"
                :key="i"
                class="h-14 w-full"
            />
        </div>
        <UEmpty
            v-else-if="!lista.filas.value.length"
            icon="i-lucide-hand"
            title="Sin promesas"
            description="Este cliente no ha hecho promesas de pago."
            variant="naked"
        />
        <template v-else>
            <ul class="-mx-2 flex flex-col">
                <ListaItem
                    v-for="promesa in lista.filas.value"
                    :key="promesa.id"
                    :titulo="`${formatearQuetzales(promesa.monto)} · vence ${formatearFecha(promesa.vence_en)}`"
                    :subtitulo="nombres.get(promesa.servicio_id) ?? `Servicio #${promesa.servicio_id}`"
                    icono="i-lucide-hand"
                    :to="enlace(`/servicios/${promesa.servicio_id}`)"
                >
                    <template #derecha>
                        <UBadge
                            :label="ESTADOS_PROMESA[promesa.estado].etiqueta"
                            :icon="ESTADOS_PROMESA[promesa.estado].icono"
                            :color="ESTADOS_PROMESA[promesa.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                </ListaItem>
            </ul>
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
    </div>
</template>
