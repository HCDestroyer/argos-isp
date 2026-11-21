<script setup lang="ts">
/**
 * Vista rápida de un servicio desde la lista (maestro-detalle): estado, plan, router y direcciones
 * con los datos de la fila (sin pedir nada más) y las acciones frecuentes. La ficha completa, con
 * sus acciones de estado, sigue en `/servicios/:id`.
 */
defineProps<{
    servicio: Servicio | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const { enlace } = usePermisos()
</script>

<template>
    <VistaRapida
        v-if="servicio"
        v-model:open="abierto"
        :titulo="etiquetaServicio(servicio)"
        :subtitulo="`#${servicio.id} · ${nombreCliente(servicio)}`"
        icono="i-lucide-wifi"
    >
        <template #estado>
            <EstadoServicioBadge
                :estado="servicio.estado"
                size="sm"
            />
            <UBadge
                v-if="servicio.promesa_activa"
                :label="PROMESA_ACTIVA.etiqueta"
                :icon="PROMESA_ACTIVA.icono"
                :color="PROMESA_ACTIVA.color"
                variant="outline"
                size="sm"
            />
            <SuspensionManualBadge
                :servicio="servicio"
                size="sm"
            />
        </template>

        <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-0.5 rounded-lg bg-(--ax-panel) p-3">
                <span class="text-xs text-muted">Plan</span>
                <span class="truncate text-sm font-bold text-highlighted">{{ nombrePlan(servicio) }}</span>
            </div>
            <div class="flex flex-col gap-0.5 rounded-lg bg-(--ax-panel) p-3">
                <span class="text-xs text-muted">Precio especial</span>
                <span class="text-sm font-bold tabular-nums text-highlighted">{{ servicio.costo_override ? formatearQuetzales(servicio.costo_override) : 'No' }}</span>
            </div>
        </div>

        <section class="flex flex-col gap-3">
            <h3 class="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
                Red
            </h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
                <DatoFicha
                    etiqueta="Router"
                    :valor="nombreRouter(servicio)"
                />
                <DatoFicha
                    etiqueta="Zona"
                    :valor="nombreZona(servicio)"
                />
                <DatoFicha
                    etiqueta="IPv4"
                    :valor="servicio.ipv4"
                    mono
                />
                <DatoFicha
                    etiqueta="Prefijo delegado IPv6"
                    :valor="servicio.prefijo_delegado_v6"
                    mono
                />
            </dl>
        </section>

        <template #acciones>
            <UButton
                v-if="enlace(`/cobro?cliente=${servicio.cliente_id}`)"
                :to="enlace(`/cobro?cliente=${servicio.cliente_id}`)"
                label="Cobrar"
                :icon="ICONOS.cobrar"
                color="neutral"
                variant="outline"
            />
            <UButton
                :to="enlace(`/servicios/${servicio.id}`)"
                label="Abrir ficha"
                trailing-icon="i-lucide-arrow-right"
            />
        </template>
    </VistaRapida>
</template>
