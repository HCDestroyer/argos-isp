<script setup lang="ts">
/**
 * Lo que hará `POST /routers/:id/unir` según su simulación (`simular: true`, schema `UnionRouters`
 * de A1): qué router queda, cuántos servicios y sesiones pasan, redes, bloques y planes, las claves
 * que comparten, los bloqueos y los avisos. Solo muestra lo que manda la API.
 */
const props = defineProps<{
    vista: UnionRouters
}>()

/** Servicios que se listan antes de «y N más». */
const MAXIMO_SERVICIOS = 8

const servicios = computed(() => props.vista.servicios.slice(0, MAXIMO_SERVICIOS))
const ocultos = computed(() => Math.max(0, props.vista.servicios.length - MAXIMO_SERVICIOS))
const direccionamiento = computed(() => props.vista.redes_ipv4.length + props.vista.ipv6_bloques.length)
const planes = computed(() => props.vista.planes_movidos.length + props.vista.planes_descartados.length)

const resumen = computed(() => [
    { etiqueta: 'Servicios que pasan', valor: props.vista.servicios.length, prueba: 'union-servicios' },
    { etiqueta: 'Sesiones abiertas que pasan', valor: props.vista.sesiones_abiertas, prueba: 'union-sesiones' },
    { etiqueta: 'Redes y bloques IP', valor: direccionamiento.value, prueba: 'union-redes' },
    { etiqueta: 'Planes', valor: planes.value, prueba: 'union-planes' },
])

const detallePlanes = computed(() => {
    const partes = []
    if (props.vista.planes_movidos.length) {
        partes.push(`${enPlural(props.vista.planes_movidos.length, 'implementación pasa', 'implementaciones pasan')} al que queda`)
    }
    if (props.vista.planes_descartados.length) {
        partes.push(`${enPlural(props.vista.planes_descartados.length, 'se descarta', 'se descartan')} porque el que queda ya implementa ese plan`)
    }
    return partes.join('; ')
})

const detalleRedes = computed(() => {
    const partes = []
    if (props.vista.redes_ipv4.length) {
        partes.push(enPlural(props.vista.redes_ipv4.length, 'red IPv4', 'redes IPv4'))
    }
    if (props.vista.ipv6_bloques.length) {
        partes.push(`${enPlural(props.vista.ipv6_bloques.length, 'bloque IPv6', 'bloques IPv6')} con sus pools`)
    }
    return partes.join(' y ')
})
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="union-vista-previa"
    >
        <div class="flex flex-col gap-2 surface-card p-3 sm:flex-row sm:items-center sm:gap-3">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-xs text-muted">Queda</span>
                <span
                    class="truncate text-sm font-semibold text-highlighted"
                    data-prueba="union-queda"
                >{{ vista.router.nombre }}</span>
                <span class="font-mono text-xs text-muted">{{ hostYNas(vista.router) }}</span>
            </div>
            <UIcon
                name="i-lucide-arrow-left"
                class="hidden size-5 shrink-0 text-muted sm:block"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-xs text-muted">Se absorbe y queda desactivado</span>
                <span
                    class="truncate text-sm font-semibold text-highlighted"
                    data-prueba="union-absorbido"
                >{{ vista.absorbido.nombre }}</span>
                <span class="font-mono text-xs text-muted">{{ hostYNas(vista.absorbido) }}</span>
            </div>
        </div>

        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div
                v-for="dato in resumen"
                :key="dato.prueba"
                class="flex flex-col gap-0.5 surface-card p-3"
            >
                <dt class="text-xs text-muted">
                    {{ dato.etiqueta }}
                </dt>
                <dd
                    class="text-lg font-semibold text-highlighted tabular-nums"
                    :data-prueba="dato.prueba"
                >
                    {{ dato.valor }}
                </dd>
            </div>
        </dl>

        <UAlert
            color="success"
            variant="subtle"
            icon="i-lucide-plug-zap"
            title="Nadie se desconecta"
            :description="`${enPlural(vista.servicios.length, 'servicio conserva', 'servicios conservan')} sus direcciones IPv4 e IPv6 y ${enPlural(vista.sesiones_abiertas, 'sesión abierta pasa', 'sesiones abiertas pasan')} a «${vista.router.nombre}» tal como están. El cambio viaja con el motivo «unión de routers» y no se envía ningún Disconnect: es el mismo equipo.`"
            data-prueba="union-sin-desconexion"
        />

        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted">Por qué son el mismo MikroTik</span>
            <div
                v-if="vista.coincidencias.length"
                class="flex flex-wrap gap-1.5"
                data-prueba="union-coincidencias"
            >
                <UBadge
                    v-for="motivo in vista.coincidencias"
                    :key="motivo"
                    :label="MOTIVOS_DUPLICADO[motivo].etiqueta"
                    :icon="MOTIVOS_DUPLICADO[motivo].icono"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                />
            </div>
            <span
                v-else
                class="text-sm text-warning"
                data-prueba="union-sin-coincidencias"
            >No comparten la dirección de la API, la IP del NAS ni el número de serie.</span>
        </div>

        <UAlert
            v-for="bloqueo in vista.bloqueos"
            :key="bloqueo"
            color="error"
            variant="subtle"
            icon="i-lucide-octagon-x"
            :title="`No se puede unir: ${BLOQUEOS_UNION[bloqueo].titulo.toLowerCase()}`"
            :description="BLOQUEOS_UNION[bloqueo].paso"
            :data-prueba="`union-bloqueo-${bloqueo}`"
        />

        <UAlert
            v-if="vista.avisos.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Antes de confirmar"
            data-prueba="union-avisos"
        >
            <template #description>
                <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                    <li
                        v-for="(aviso, indice) in vista.avisos"
                        :key="indice"
                    >
                        {{ aviso }}
                    </li>
                </ul>
            </template>
        </UAlert>

        <div
            v-if="detalleRedes || detallePlanes"
            class="flex flex-col gap-1 text-sm text-muted"
        >
            <p v-if="detalleRedes">
                Pasan {{ detalleRedes }}.
            </p>
            <p v-if="detallePlanes">
                Planes: {{ detallePlanes }}.
            </p>
        </div>

        <div
            v-if="servicios.length"
            class="flex flex-col gap-1.5"
        >
            <span class="text-xs font-medium text-muted">Servicios que pasan</span>
            <ul
                class="flex flex-col divide-y divide-default surface-card"
                data-prueba="union-lista-servicios"
            >
                <li
                    v-for="servicio in servicios"
                    :key="servicio.servicio_id"
                    class="flex items-center justify-between gap-2 px-3 py-2"
                >
                    <span class="min-w-0 truncate font-mono text-sm">{{ servicio.user_ppp ?? `Servicio ${servicio.servicio_id}` }}</span>
                    <EstadoServicioBadge
                        v-if="esEstadoServicio(servicio.estado)"
                        :estado="servicio.estado"
                        size="sm"
                    />
                    <UBadge
                        v-else
                        :label="servicio.estado"
                        color="neutral"
                        variant="subtle"
                        size="sm"
                    />
                </li>
            </ul>
            <span
                v-if="ocultos"
                class="text-xs text-muted"
            >y {{ enPlural(ocultos, 'servicio más', 'servicios más') }}.</span>
        </div>
    </div>
</template>
