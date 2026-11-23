<script setup lang="ts">
/**
 * Detalle de una red IPv4 (tablero RedIps, panel derecho): asignadas, libres y reservadas, gateway
 * (con «derivado» si sale de la primera IP), rango que se entrega y DNS. El mapa IP por IP del
 * tablero no se dibuja: la API todavía no dice qué dirección tiene cada quien (pedido en
 * `.claude/integration/a4.md`); para una IP concreta está «¿De quién es?».
 */
defineProps<{
    red: RedIpv4
    routerNombre: string | null
}>()

const emit = defineEmits<{
    editar: []
}>()

const { puede } = usePermisos()
</script>

<template>
    <div class="flex flex-col gap-3">
        <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 flex-col">
                <span class="font-mono text-lg font-semibold text-highlighted">{{ red.cidr }}</span>
                <span class="text-xs text-muted">{{ [red.nombre, routerNombre].filter(Boolean).join(' · ') }}</span>
            </div>
            <UButton
                v-if="puede('redes.editar')"
                :icon="ICONOS.editar"
                color="neutral"
                variant="ghost"
                size="sm"
                class="rounded-full"
                :aria-label="`Editar la red ${red.cidr}`"
                :title="`Editar la red ${red.cidr}`"
                @click="emit('editar')"
            />
        </div>
        <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span><span class="font-semibold text-highlighted tabular-nums">{{ formatearEntero(red.ocupacion.asignadas) }}</span> <span class="text-muted">asignadas</span></span>
            <span><span class="font-semibold text-highlighted tabular-nums">{{ formatearEntero(red.ocupacion.libres) }}</span> <span class="text-muted">libres</span></span>
            <span><span class="font-semibold text-highlighted tabular-nums">{{ formatearEntero(red.ocupacion.reservadas) }}</span> <span class="text-muted">reservadas</span></span>
        </p>
        <RedOcupacion
            :porcentaje="red.ocupacion.porcentaje"
            :detalle="`${formatearEntero(red.ocupacion.total)} en total`"
        />
        <SeccionSinApi
            titulo="Mapa de la red"
            descripcion="El mapa IP por IP todavía no lo da la API. Para saber quién tiene una IP, usa «¿De quién es?» arriba."
            icono="i-lucide-grid-3x3"
        />
        <dl>
            <RedFila
                etiqueta="Gateway"
                mono
            >
                {{ red.gateway_efectivo }}{{ red.gateway_derivado ? ' (derivado)' : '' }}
            </RedFila>
            <RedFila
                etiqueta="Rango que se entrega"
                :valor="red.rango_inicio && red.rango_fin ? `${red.rango_inicio} – ${red.rango_fin}` : 'Toda la red'"
                :mono="Boolean(red.rango_inicio)"
            />
            <RedFila
                etiqueta="DNS"
                :valor="[red.dns_primario, red.dns_secundario].filter(Boolean).join(' · ') || 'Los del router'"
                :mono="Boolean(red.dns_primario)"
            />
            <RedFila
                etiqueta="Tipo"
                :valor="red.tipo === 'pool' ? 'Pool (se asigna sola)' : 'Estático (IP fija por servicio)'"
            />
        </dl>
    </div>
</template>
