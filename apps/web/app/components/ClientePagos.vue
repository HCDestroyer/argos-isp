<script setup lang="ts">
/**
 * Pestaña «Pagos» de la ficha del cliente: sus pagos (`GET /pagos?cliente_id=`) por cursor, con
 * método, estado y enlace al pago. Error con «Reintentar»; vacío real si no tiene.
 */
const props = defineProps<{
    clienteId: number
}>()

const { enlace } = usePermisos()
const lista = usePaginacionCursor(cursor => usePagos().listar({ cliente_id: props.clienteId }, cursor))

const ESTADOS: Record<Pago['estado'], { etiqueta: string, color: 'success' | 'warning' | 'neutral', icono: string }> = {
    registrado: { etiqueta: 'Registrado', color: 'success', icono: 'i-lucide-circle-check' },
    pendiente_verificacion: { etiqueta: 'Por verificar', color: 'warning', icono: 'i-lucide-clock' },
    anulado: { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban' },
}

onMounted(() => void lista.recargar())
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="cliente-pagos"
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
                v-for="i in 3"
                :key="i"
                class="h-14 w-full"
            />
        </div>
        <UEmpty
            v-else-if="!lista.filas.value.length"
            icon="i-lucide-banknote"
            title="Sin pagos"
            description="Este cliente todavía no tiene pagos registrados."
            variant="naked"
        />
        <template v-else>
            <ul class="-mx-2 flex flex-col">
                <ListaItem
                    v-for="pago in lista.filas.value"
                    :key="pago.id"
                    :titulo="`${formatearQuetzales(pago.monto)} · ${ETIQUETAS_METODO[pago.metodo]}`"
                    :subtitulo="`${formatearFechaHora(pago.created_at)}${pago.referencia ? ` · ref. ${pago.referencia}` : ''}`"
                    :icono="ICONOS.cobrar"
                    :to="enlace(`/pagos/${pago.id}`)"
                >
                    <template #derecha>
                        <UBadge
                            :label="ESTADOS[pago.estado].etiqueta"
                            :icon="ESTADOS[pago.estado].icono"
                            :color="ESTADOS[pago.estado].color"
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
