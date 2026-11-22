<script setup lang="ts">
/**
 * Indicador de puntos del inicio (un `PortalKpi` por empresa): el saldo y lo que vence pronto, con
 * enlace a los premios. Solo con el programa visible en el portal; si los puntos no se pudieron
 * leer, no se muestra nada aquí (la sección «Puntos» tiene su error con «Reintentar»).
 */
const { empresas } = usePuntos()
</script>

<template>
    <PortalKpi
        v-for="puntos in empresas ?? []"
        :key="puntos.empresa.id"
        :etiqueta="(empresas?.length ?? 0) > 1 ? `Puntos con ${puntos.empresa.nombre_comercial}` : 'Mis puntos'"
        :valor="puntosEnTexto(puntos.saldo)"
        :detalle="puntos.por_vencer > 0 ? `${puntosEnTexto(puntos.por_vencer)} vencen pronto · Ver premios` : 'Ver premios para canjear'"
        icono="i-lucide-gem"
        to="/cuenta?seccion=puntos"
        data-testid="resumen-puntos"
    />
</template>
