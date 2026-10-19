<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * "Qué cambió" en la versión instalada (`GET /version`): la sección del CHANGELOG dibujada sin HTML
 * crudo (`MarkdownSeguro`) y el enlace a las notas de la versión si viene. Con error, el aviso con
 * "Reintentar" y nada más.
 */
const abierto = defineModel<boolean>('open', { default: false })

const { version, cargar } = useVersion()
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function leer() {
    cargando.value = true
    problema.value = null
    const resultado = await cargar()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor && (!version.value || problema.value)) {
        void leer()
    }
}, { immediate: true })
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="version ? `Qué cambió en la versión ${version.version}` : 'Qué cambió'"
        :description="version ? [version.compilada ? `Compilada el ${formatearFechaHora(version.compilada)}` : null, version.commit ? `commit ${version.commit.slice(0, 7)}` : null].filter(Boolean).join(' · ') || undefined : undefined"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="leer"
                :reintentando="cargando"
                data-prueba="version-error"
            />
            <USkeleton
                v-else-if="cargando && !version"
                class="h-32 w-full"
            />
            <template v-else-if="version">
                <MarkdownSeguro
                    v-if="version.cambios"
                    :markdown="version.cambios"
                    data-prueba="version-cambios"
                />
                <UEmpty
                    v-else
                    icon="i-lucide-scroll-text"
                    title="Sin notas para esta versión"
                    :description="versionPublicada(version.version) ? 'El CHANGELOG no tiene una sección para esta versión.' : 'Es una compilación de desarrollo, sin versión publicada.'"
                    variant="naked"
                />
            </template>
        </template>

        <template #footer>
            <div class="flex w-full flex-wrap items-center justify-between gap-2">
                <UButton
                    v-if="version?.notas_url"
                    :to="version.notas_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    label="Notas de la versión"
                    icon="i-lucide-external-link"
                    color="neutral"
                    variant="outline"
                    data-prueba="version-notas"
                />
                <span v-else />
                <UButton
                    label="Cerrar"
                    color="neutral"
                    variant="ghost"
                    @click="abierto = false"
                />
            </div>
        </template>
    </UModal>
</template>
