<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Menú del usuario. `tarjeta` (barra lateral, arriba): avatar, nombre y rol; `avatar` (barra
 * superior): solo el avatar.
 */
const props = withDefaults(defineProps<{
    collapsed?: boolean
    variante?: 'tarjeta' | 'avatar'
}>(), {
    collapsed: false,
    variante: 'tarjeta',
})

const { usuario, logout } = useAuth()
const colorMode = useColorMode()
const toast = useToast()

/*
 * Versión instalada (`GET /version`): se ve en el menú y abre "Qué cambió". La primera vez que el
 * usuario entra a una versión publicada distinta de la última que vio, un aviso discreto lo ofrece
 * (la última vista se recuerda por usuario en `localStorage`; sin almacenamiento, no pasa nada).
 */
const { version, cargar: cargarVersion } = useVersion()
const queCambioAbierto = ref(false)

async function revisarVersion() {
    const resultado = await cargarVersion()
    const id = usuario.value?.id
    if (!resultado.ok || !id || !versionPublicada(resultado.data.version)) {
        return
    }
    const vista = leerVersionVista(id)
    guardarVersionVista(id, resultado.data.version)
    if (debeAvisarVersion(resultado.data.version, vista)) {
        toast.add({
            id: `version-${resultado.data.version}`,
            title: `ArgosIsp se actualizó a la versión ${resultado.data.version}`,
            icon: 'i-lucide-sparkles',
            color: 'neutral',
            actions: [{ label: 'Qué cambió', icon: 'i-lucide-scroll-text', color: 'neutral', variant: 'outline', onClick: () => { queCambioAbierto.value = true } }],
        })
    }
}

watch(() => usuario.value?.id, (id) => {
    if (id) {
        void revisarVersion()
    }
}, { immediate: true })

const iniciales = computed(() => (usuario.value?.nombre ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(parte => parte.charAt(0).toUpperCase())
    .join(''))

/** Rol principal, legible («Admin», «Cajero»…). */
const rol = computed(() => {
    const primero = usuario.value?.roles[0]
    return primero ? primero.charAt(0).toUpperCase() + primero.slice(1).replace(/_/g, ' ') : 'Usuario'
})

const soloAvatar = computed(() => props.collapsed || props.variante === 'avatar')

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
        label: 'Qué cambió',
        icon: 'i-lucide-scroll-text',
        description: version.value ? `Versión ${version.value.version}` : undefined,
        onSelect() {
            queCambioAbierto.value = true
        },
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
        :content="{ align: variante === 'avatar' ? 'end' : 'center', collisionPadding: 12 }"
        :ui="{ content: soloAvatar ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)' }"
    >
        <UButton
            v-if="soloAvatar"
            :avatar="{ text: iniciales, alt: usuario?.nombre, ui: { root: 'bg-primary/10', fallback: 'text-primary font-semibold' } }"
            color="neutral"
            variant="ghost"
            square
            class="data-[state=open]:bg-elevated"
            aria-label="Menú de usuario"
        />
        <UButton
            v-else
            color="neutral"
            variant="outline"
            block
            class="justify-start gap-3 rounded-(--ax-radio) bg-(--hf-card) p-2.5 ring-(--ax-borde) data-[state=open]:bg-elevated"
            aria-label="Menú de usuario"
        >
            <UAvatar
                :text="iniciales"
                :alt="usuario?.nombre"
                size="md"
                :ui="{ root: 'bg-primary/10', fallback: 'text-primary font-semibold' }"
            />
            <span class="flex min-w-0 flex-1 flex-col text-start">
                <span class="truncate text-sm font-semibold text-highlighted">{{ usuario?.nombre }}</span>
                <span class="truncate text-xs text-muted">{{ rol }}</span>
            </span>
            <UIcon
                name="i-lucide-chevrons-up-down"
                class="size-4 shrink-0 text-dimmed"
            />
        </UButton>
    </UDropdownMenu>
    <QueCambioModal v-model:open="queCambioAbierto" />
</template>
