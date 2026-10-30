<script setup lang="ts">
/**
 * Explica en lenguaje simple cómo reparte IPv6 este router: el bloque (o los bloques), el prefijo
 * de enlace /64 de cada cliente y el prefijo delegado (PD) para su red, con un ejemplo real tomado
 * de los pools y cuántos clientes caben. Sin bloques, el mismo ejemplo con un bloque de muestra.
 */
const props = defineProps<{
    bloques: Ipv6Bloque[]
    pools: Record<number, Ipv6Pool[]>
}>()

/** Bloque y pools de muestra (rango de documentación 2001:db8::/32) cuando el router no tiene. */
const MUESTRA = {
    bloque: '2001:db8:100::/40',
    pools: [
        { prefijo: '2001:db8:100::/41', tipo: 'delegacion' as const, tamano_entrega: 56 },
        { prefijo: '2001:db8:1f0::/44', tipo: 'enlace' as const, tamano_entrega: 64 },
    ],
}

const deMuestra = computed(() => props.bloques.length === 0)
const todosLosPools = computed(() => (deMuestra.value ? MUESTRA.pools : props.bloques.flatMap(b => props.pools[b.id] ?? [])))
const resumen = computed(() => resumenIpv6(todosLosPools.value))
const delegado = computed(() => resumen.value.tamanoDelegado ?? 56)
/** Redes /64 que el cliente puede armar con su prefijo delegado. */
const redesDelCliente = computed(() => cantidadPrefijos(cuantosCaben(delegado.value, 64)))

const estado = computed(() => {
    if (deMuestra.value) {
        return { color: 'neutral' as const, icono: 'i-lucide-info', texto: `Ejemplo con un bloque ${MUESTRA.bloque}: caben ${cantidadPrefijos(resumen.value.clientes)} clientes.` }
    }
    if (resumen.value.faltaEnlace || resumen.value.faltaDelegacion) {
        const falta = resumen.value.faltaEnlace && resumen.value.faltaDelegacion ? 'un pool de enlace y uno de delegación' : resumen.value.faltaEnlace ? 'un pool de enlace' : 'un pool de delegación'
        return { color: 'warning' as const, icono: 'i-lucide-triangle-alert', texto: `Falta ${falta}: hasta agregarlo, los clientes no reciben IPv6 completa.` }
    }
    return { color: 'success' as const, icono: 'i-lucide-circle-check', texto: `Caben ${cantidadPrefijos(resumen.value.clientes)} clientes con IPv6 completa.` }
})

const pasos = computed(() => [
    {
        icono: 'i-lucide-box',
        titulo: deMuestra.value || props.bloques.length === 1 ? 'El bloque' : `${props.bloques.length} bloques`,
        texto: 'Todo el espacio IPv6 que tu proveedor te dio para este router. Se reparte en pools; puedes registrar más de un bloque.',
        ejemplo: deMuestra.value ? [MUESTRA.bloque] : props.bloques.map(b => b.prefijo),
    },
    {
        icono: 'i-lucide-cable',
        titulo: 'Prefijo de enlace · /64',
        texto: 'Cada cliente recibe un /64 para la conexión PPPoE entre su router y el tuyo (la WAN del cliente).',
        ejemplo: resumen.value.ejemplos.map((e, i) => (e.enlace ? `Cliente ${i + 1}: ${e.enlace}` : null)).filter((e): e is string => e !== null),
    },
    {
        icono: 'i-lucide-house-wifi',
        titulo: `Prefijo delegado (PD) · /${delegado.value}`,
        texto: `Y un /${delegado.value} para su propia red: su router lo reparte en hasta ${redesDelCliente.value} redes /64 (Wi-Fi, invitados, cámaras…).`,
        ejemplo: resumen.value.ejemplos.map((e, i) => (e.delegado ? `Cliente ${i + 1}: ${e.delegado}` : null)).filter((e): e is string => e !== null),
    },
])
</script>

<template>
    <section
        class="flex flex-col gap-4 rounded-md border border-default p-4"
        aria-labelledby="titulo-ipv6-explicacion"
        data-prueba="ipv6-explicacion"
    >
        <div class="flex flex-col gap-1">
            <h3
                id="titulo-ipv6-explicacion"
                class="text-sm font-semibold text-highlighted"
            >
                Cómo funciona la IPv6 en este router
            </h3>
            <p class="text-xs text-muted">
                Al conectarse por PPPoE, cada cliente recibe automáticamente dos prefijos tomados de los pools.
            </p>
        </div>

        <ol class="grid gap-3 sm:grid-cols-3">
            <li
                v-for="(paso, indice) in pasos"
                :key="paso.titulo"
                class="flex flex-col gap-2 rounded-md bg-elevated/50 p-3"
            >
                <div class="flex items-center gap-2">
                    <UBadge
                        :label="String(indice + 1)"
                        color="neutral"
                        variant="soft"
                        class="h-6 shrink-0 justify-center rounded-full"
                    />
                    <UIcon
                        :name="paso.icono"
                        class="size-4 shrink-0 text-primary"
                    />
                    <span class="text-sm font-medium text-highlighted">{{ paso.titulo }}</span>
                </div>
                <p class="text-xs text-muted">
                    {{ paso.texto }}
                </p>
                <ul
                    v-if="paso.ejemplo.length"
                    class="flex flex-col gap-0.5 font-mono text-xs break-all text-default"
                >
                    <li
                        v-for="linea in paso.ejemplo"
                        :key="linea"
                    >
                        {{ linea }}
                    </li>
                </ul>
            </li>
        </ol>

        <p
            class="flex items-center gap-2 text-sm"
            :class="{ 'text-success': estado.color === 'success', 'text-warning': estado.color === 'warning', 'text-muted': estado.color === 'neutral' }"
            data-prueba="ipv6-capacidad"
        >
            <UIcon
                :name="estado.icono"
                class="size-4 shrink-0"
            />
            {{ estado.texto }}
        </p>
    </section>
</template>
