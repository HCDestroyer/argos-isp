<script setup lang="ts">
/**
 * Detalle de una sesión abierta (tablero RedSesiones, panel derecho): cliente y estado del
 * servicio, plan, IPs, router, desde cuándo, consumo y cómo lo sabemos (RADIUS o sondeo), con
 * «Abrir cliente» y «Desconectar» (`sesiones.desconectar`). En una sesión por sondeo no hay
 * consumo y así se dice.
 */
withDefaults(defineProps<{
    sesion: Sesion
    servicio: Servicio | null
    routerNombre: string | null
    /** En el panel del teléfono el título ya va en el encabezado del panel. */
    sinEncabezado?: boolean
}>(), {
    sinEncabezado: false,
})

const emit = defineEmits<{
    desconectar: []
}>()

const { puede } = usePermisos()
</script>

<template>
    <div class="flex flex-col gap-3">
        <div
            v-if="!sinEncabezado"
            class="flex items-start gap-3"
        >
            <span class="pastilla-icono pastilla-tono tono-exito size-10 shrink-0 rounded-xl">
                <UIcon
                    name="i-lucide-wifi"
                    class="size-5"
                />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-semibold text-highlighted">{{ servicio?.cliente_nombre ?? (sesion.servicio_id ? `Servicio ${sesion.servicio_id}` : 'Sin servicio') }}</span>
                <span class="truncate font-mono text-xs text-muted">{{ sesion.user_ppp }}</span>
            </div>
            <EstadoServicioBadge
                v-if="servicio"
                :estado="servicio.estado"
                size="sm"
            />
        </div>
        <dl>
            <RedFila
                etiqueta="Plan"
                :valor="servicio?.plan_nombre ?? '—'"
            />
            <RedFila
                etiqueta="IPv4"
                :valor="sesion.ipv4"
                mono
            />
            <RedFila
                etiqueta="IPv6 de su casa"
                :valor="sesion.prefijo_delegado_v6"
                mono
            />
            <RedFila
                etiqueta="Router"
                :valor="routerNombre ?? '—'"
            />
            <RedFila
                etiqueta="Conectado desde"
                :valor="formatearFechaHora(sesion.inicio)"
            />
            <RedFila
                etiqueta="Tiempo"
                :valor="formatearDuracion(sesion.inicio)"
            />
            <RedFila
                etiqueta="Descargó / subió"
                :valor="esSesionPorSondeo(sesion) ? '— (sin RADIUS no hay consumo)' : `${formatearBytes(sesion.bytes_in)} / ${formatearBytes(sesion.bytes_out)}`"
            />
            <RedFila etiqueta="Cómo lo sabemos">
                <UBadge
                    :label="esSesionPorSondeo(sesion) ? 'Sondeo' : 'RADIUS'"
                    color="neutral"
                    variant="soft"
                    size="sm"
                />
            </RedFila>
        </dl>
        <p class="text-xs text-muted">
            «Sondeo» = el router no usa RADIUS: Argos pregunta cada minuto quién está conectado y no mide consumo.
        </p>
        <div class="mt-2 flex gap-2">
            <UButton
                v-if="servicio && puede('clientes.ver')"
                :to="`/clientes/${servicio.cliente_id}`"
                label="Abrir cliente"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center rounded-full"
            />
            <UButton
                v-else-if="sesion.servicio_id && puede('servicios.ver')"
                :to="`/servicios/${sesion.servicio_id}`"
                label="Abrir servicio"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center rounded-full"
            />
            <UButton
                v-if="puede('sesiones.desconectar')"
                label="Desconectar"
                icon="i-lucide-unplug"
                color="error"
                variant="outline"
                class="flex-1 justify-center rounded-full"
                data-prueba="desconectar-sesion"
                @click="emit('desconectar')"
            />
        </div>
    </div>
</template>
