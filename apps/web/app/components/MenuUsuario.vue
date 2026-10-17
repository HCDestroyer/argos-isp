<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

withDefaults(defineProps<{
    collapsed?: boolean
}>(), {
    collapsed: false,
})

const { usuario, logout } = useAuth()
const colorMode = useColorMode()

const iniciales = computed(() => (usuario.value?.nombre ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(parte => parte.charAt(0).toUpperCase())
    .join(''))

const items = computed<DropdownMenuItem[][]>(() => [
    [{
        type: 'label',
        label: usuario.value?.nombre ?? '',
        description: usuario.value?.email,
    }],
    [{
        label: 'Mi cuenta',
        icon: 'i-lucide-circle-user',
        to: '/perfil',
    }, {
        label: 'Apariencia',
        icon: 'i-lucide-sun-moon',
        children: [
            {
                label: 'Claro',
                icon: 'i-lucide-sun',
                type: 'checkbox',
                checked: colorMode.preference === 'light',
                onSelect(evento: Event) {
                    evento.preventDefault()
                    colorMode.preference = 'light'
                },
            },
            {
                label: 'Oscuro',
                icon: 'i-lucide-moon',
                type: 'checkbox',
                checked: colorMode.preference === 'dark',
                onSelect(evento: Event) {
                    evento.preventDefault()
                    colorMode.preference = 'dark'
                },
            },
            {
                label: 'Sistema',
                icon: 'i-lucide-monitor',
                type: 'checkbox',
                checked: colorMode.preference === 'system',
                onSelect(evento: Event) {
                    evento.preventDefault()
                    colorMode.preference = 'system'
                },
            },
        ],
    }],
    [{
        label: 'Cerrar sesión',
        icon: 'i-lucide-log-out',
        color: 'error',
        onSelect() {
            void logout()
        },
    }],
])
</script>

<template>
    <UDropdownMenu
        :items="items"
        :content="{ align: 'center', collisionPadding: 12 }"
        :ui="{ content: collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)' }"
    >
        <UButton
            :avatar="{ text: iniciales, alt: usuario?.nombre }"
            :label="collapsed ? undefined : usuario?.nombre"
            :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            class="data-[state=open]:bg-elevated"
            :ui="{
                trailingIcon: 'text-dimmed',
            }"
            aria-label="Menú de usuario"
        />
    </UDropdownMenu>
</template>
