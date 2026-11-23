<script setup lang="ts">
/**
 * «Datos del equipo» de la pestaña Conexión de la ficha del router (tablero RedRouterFicha): host,
 * API, serial, servidor DHCP, interfaz de clientes y último contacto. Va en su propio componente
 * para que la ficha reciba el router ya cargado como prop (en la página, vue-tsc perdía el
 * `v-else-if="nas"` en las pestañas siguientes).
 */
defineProps<{
    router: RouterNas
}>()
</script>

<template>
    <RedTarjeta
        titulo="Datos del equipo"
        icono="i-lucide-hard-drive"
    >
        <dl>
            <RedFila
                etiqueta="Host"
                :valor="router.host"
                mono
            />
            <RedFila
                etiqueta="API"
                :valor="router.api_url ?? `https://${router.host}`"
                mono
            />
            <RedFila
                etiqueta="Serial"
                :valor="router.serial ?? 'Sin leer'"
                :mono="Boolean(router.serial)"
            />
            <RedFila
                etiqueta="Servidor DHCP"
                :valor="router.dhcp_servidor ?? 'El de la configuración'"
                :mono="Boolean(router.dhcp_servidor)"
            />
            <RedFila
                etiqueta="Interfaz de clientes"
                :valor="router.interfaz_clientes ?? 'La de la configuración'"
                :mono="Boolean(router.interfaz_clientes)"
            />
            <RedFila
                etiqueta="Último contacto"
                :valor="router.ultimo_contacto ? `${formatearFechaHora(router.ultimo_contacto)} (${textoUltimoContacto(router)})` : 'Nunca respondió'"
            />
        </dl>
    </RedTarjeta>
</template>
