<script setup lang="ts">
/** «Ayuda y atajos» del menú del usuario: atajos de teclado del panel y el manual de esta pantalla. */
const abierto = defineModel<boolean>('open', { default: false })
const route = useRoute()
const config = useRuntimeConfig()

const clave = computed(() => claveAyudaDeRuta(route.matched))
const urlManual = computed(() => (clave.value ? urlAyuda(String(config.public.docsUrl), clave.value) : String(config.public.docsUrl)))

const ATAJOS: { teclas: string[], que: string }[] = [
    { teclas: ['meta', 'K'], que: 'Buscar una sección' },
    { teclas: ['Alt', '1…9'], que: 'Abrir tus accesos rápidos (en el orden de «Personalizar»)' },
    { teclas: ['Esc'], que: 'En Cobrar: limpiar o empezar el siguiente cobro; en ventanas y menús: cerrar' },
    { teclas: ['Enter'], que: 'En Cobrar: registrar el pago' },
    { teclas: ['Tab'], que: 'Pasar al siguiente botón o campo (el foco siempre se ve)' },
]
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Ayuda y atajos"
        description="Atajos de teclado del panel y el manual de esta pantalla."
    >
        <template #title>
            <ModalTitulo
                texto="Ayuda y atajos"
                :icono="ICONOS.ayuda"
            />
        </template>
        <template #body>
            <ul class="flex flex-col divide-y divide-(--ax-borde)">
                <li
                    v-for="atajo in ATAJOS"
                    :key="atajo.que"
                    class="flex items-center justify-between gap-4 py-2.5 text-sm"
                >
                    <span>{{ atajo.que }}</span>
                    <span class="flex shrink-0 gap-1">
                        <UKbd
                            v-for="tecla in atajo.teclas"
                            :key="tecla"
                            :value="tecla"
                        />
                    </span>
                </li>
            </ul>
        </template>
        <template #footer>
            <UButton
                label="Cerrar"
                :icon="ICONOS.cancelar"
                color="neutral"
                variant="outline"
                @click="abierto = false"
            />
            <UButton
                :to="urlManual"
                target="_blank"
                rel="noopener"
                label="Abrir el manual de esta pantalla"
                :icon="ICONOS.ayuda"
                trailing-icon="i-lucide-external-link"
            />
        </template>
    </UModal>
</template>
