<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Resultado de "Enviar prueba": enviado, o el error tal cual lo dio el servidor SMTP o la Bot API
 * (la API responde 200 aunque falle). Un error de la petición (422, sin permiso) va como Problem.
 */
defineProps<{
    resultado?: { ok: true, prueba: ResultadoPruebaCanal } | { ok: false, problema: Problem }
}>()

const ORIGENES: Record<ResultadoPruebaCanal['origen'], string> = {
    global: 'la configuración global',
    empresa: 'la configuración de la empresa',
    entorno: 'las variables de entorno',
}
</script>

<template>
    <div
        v-if="resultado"
        role="status"
        data-prueba="resultado-prueba"
    >
        <UAlert
            v-if="!resultado.ok && resultado.problema.errors?.length"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="resultado.problema.title"
            :description="resultado.problema.errors.map(e => e.message).join(' · ')"
        />
        <ProblemaAlerta
            v-else-if="!resultado.ok"
            :problema="resultado.problema"
        />
        <UAlert
            v-else-if="resultado.prueba.estado === 'enviado'"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            :title="`Enviado a ${resultado.prueba.destino}`"
            :description="`Con ${ORIGENES[resultado.prueba.origen]} · envío #${resultado.prueba.envio_id}`"
        />
        <UAlert
            v-else
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            :title="`No se pudo enviar a ${resultado.prueba.destino || 'el destino'}`"
            :description="`${resultado.prueba.error ?? 'Sin detalle del servidor'} · con ${ORIGENES[resultado.prueba.origen]}`"
            data-prueba="error-prueba"
        />
    </div>
</template>
