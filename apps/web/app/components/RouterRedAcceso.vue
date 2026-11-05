<script setup lang="ts">
/**
 * Pestaña «Red de acceso» del router (núcleo de routers, `contratos/red-acceso.md` de A1): OLT →
 * puertos PON (1–2 VLAN) → VLAN → servidor PPPoE → red IPv4 (gateway) y pools IPv6, con «Descubrir
 * en el router» y «Adoptar». Mientras la API de A1 no esté en `packages/contracts`, la pestaña lo
 * dice y no muestra datos (`.claude/integration/a4.md`).
 */
defineProps<{
    router: RouterNas
}>()
</script>

<template>
    <RouterSeccion
        id-titulo="titulo-red-acceso"
        titulo="Red de acceso"
        icono="i-lucide-cable"
        descripcion="OLT y puertos PON, VLAN, servidores PPPoE y la red que entrega cada uno (con su gateway)."
        data-prueba="router-red-acceso"
    >
        <UEmpty
            icon="i-lucide-cable"
            title="Todavía no disponible"
            description="Esta pestaña mostrará la red de acceso del router y lo que ya existe en el MikroTik para adoptarlo. Falta que la API la publique."
            variant="naked"
        />
    </RouterSeccion>
</template>
