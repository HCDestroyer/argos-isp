<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Menú del usuario en la barra superior (header liviano, pedido del PM): avatar, nombre corto, rol
 * y empresa activa; dentro, la empresa (submenú, con más de una), el tema, «Mi cuenta», «Ayuda y
 * atajos», «Qué cambió» y, aparte y en rojo, «Cerrar sesión».
 */
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

const { eleccion, empresas, alcanceGlobal, conSelector, elegir, nombre: nombreEmpresa } = useEmpresaActiva()
const atajosAbierto = ref(false)

/** Nombre corto: el primer nombre. */
const nombreCorto = computed(() => usuario.value?.nombre.split(/\s+/)[0] ?? '')
const empresaActiva = computed(() => (eleccion.value === 'todas' ? 'Todas las empresas' : eleccion.value ? nombreEmpresa(eleccion.value) : null))

/** Rol principal, legible («Admin», «Cajero»…). */
const rol = computed(() => {
    const primero = usuario.value?.roles[0]
    return primero ? primero.charAt(0).toUpperCase() + primero.slice(1).replace(/_/g, ' ') : 'Usuario'
})

const items = computed<DropdownMenuItem[][]>(() => [
    [{
        type: 'label',
        label: usuario.value?.nombre ?? '',
        description: usuario.value?.email,
    }],
    [...(conSelector.value
        ? [{
                label: `Empresa: ${empresaActiva.value ?? 'elige una'}`,
                icon: 'i-lucide-building-2',
                children: [
                    ...(alcanceGlobal.value
                        ? [{ label: 'Todas las empresas', icon: 'i-lucide-layers', type: 'checkbox' as const, checked: eleccion.value === 'todas', onSelect: () => elegir('todas') }]
                        : []),
                    ...empresas.value.map(empresa => ({
                        label: empresa.nombre_comercial,
                        description: empresa.nit ? `NIT ${empresa.nit}` : undefined,
                        type: 'checkbox' as const,
                        checked: eleccion.value === empresa.id,
                        onSelect: () => elegir(empresa.id),
                    })),
                ],
            }]
        : []), {
        label: 'Tema',
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
    }, {
        label: 'Mi cuenta',
        icon: 'i-lucide-circle-user',
        to: '/perfil',
    }, {
        label: 'Ayuda y atajos',
        icon: 'i-lucide-circle-help',
        onSelect() {
            atajosAbierto.value = true
        },
    }, {
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
        :content="{ align: 'end', collisionPadding: 12 }"
        :ui="{ content: 'w-64' }"
    >
        <UButton
            color="neutral"
            variant="ghost"
            class="gap-2 rounded-full py-1 ps-1 pe-2 data-[state=open]:bg-elevated"
            aria-label="Menú de usuario"
            data-prueba="menu-usuario"
        >
            <UAvatar
                :text="iniciales"
                :alt="usuario?.nombre"
                size="sm"
                :ui="{ root: 'bg-primary/10', fallback: 'text-primary font-semibold' }"
            />
            <span class="hidden min-w-0 flex-col text-start leading-tight md:flex">
                <span class="truncate text-sm font-semibold text-highlighted">{{ nombreCorto }}</span>
                <span class="truncate text-xs text-muted">{{ rol }}<template v-if="conSelector && empresaActiva">
                    · <span data-prueba="empresa-activa">{{ empresaActiva }}</span>
                </template></span>
            </span>
            <UIcon
                name="i-lucide-chevron-down"
                class="hidden size-4 shrink-0 text-dimmed md:block"
            />
        </UButton>
    </UDropdownMenu>
    <QueCambioModal v-model:open="queCambioAbierto" />
    <AtajosTecladoModal v-model:open="atajosAbierto" />
</template>
