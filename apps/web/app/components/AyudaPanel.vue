<script setup lang="ts">
/**
 * Panel de la ayuda de la pantalla actual (contrato `documentacion.md` §6): el resumen del manual
 * (`INDICE_AYUDA`), sus temas y «Ver manual completo». Lo abren el botón «?» (`AyudaBoton`) y
 * «Ayuda de esta pantalla» del panel de la cuenta del teléfono (`CuentaDrawer`, por el layout).
 * Sin resumen para la pantalla no pinta nada.
 */
const abierto = defineModel<boolean>('open', { default: false })

const route = useRoute()
const config = useRuntimeConfig()

const clave = computed(() => claveAyudaDeRuta(route.matched))
const url = computed(() => clave.value ? urlAyuda(String(config.public.docsUrl), clave.value) : null)
const entrada = computed(() => (clave.value ? INDICE_AYUDA[clave.value] ?? null : null))
</script>

<template>
    <USlideover
        v-if="entrada && url"
        v-model:open="abierto"
        :title="entrada.titulo"
        description="Ayuda de esta pantalla, del manual de ArgosIsp"
        :ui="{ content: 'max-w-md', body: 'flex flex-col gap-5' }"
    >
        <template #body>
            <div
                class="flex items-start gap-3 rounded-(--ax-radio) bg-(--ax-panel) p-4"
                data-prueba="ayuda-resumen"
            >
                <span class="pastilla-icono tono-marca pastilla-tono">
                    <UIcon
                        name="i-lucide-book-open"
                        class="size-5"
                    />
                </span>
                <p class="text-sm text-default">
                    {{ entrada.resumen }}
                </p>
            </div>
            <section
                v-if="entrada.temas.length"
                class="flex flex-col gap-2"
                aria-labelledby="ayuda-temas"
            >
                <h3
                    id="ayuda-temas"
                    class="text-xs font-semibold tracking-[0.04em] text-muted uppercase"
                >
                    En el manual
                </h3>
                <ul class="flex flex-col gap-1.5 text-sm">
                    <li
                        v-for="tema in entrada.temas"
                        :key="tema"
                        class="flex items-center gap-2"
                    >
                        <UIcon
                            name="i-lucide-dot"
                            class="size-4 shrink-0 text-primary"
                        />
                        {{ tema }}
                    </li>
                </ul>
            </section>
            <UButton
                :to="url"
                target="_blank"
                rel="noopener"
                label="Ver manual completo"
                trailing-icon="i-lucide-external-link"
                block
                aria-label="Ver manual completo (se abre en otra pestaña)"
                data-prueba="ayuda-manual"
            />
        </template>
    </USlideover>
</template>
