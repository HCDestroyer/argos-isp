<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Menú del usuario en el encabezado (diseño final, IslasA5/A6): un círculo flotante con las
 * iniciales. El nombre, el rol y la empresa activa van dentro del menú, junto con la empresa (con
 * más de una), el tema, «Mi cuenta», «Ayuda y atajos», «Qué cambió» y, aparte y en rojo, «Cerrar
 * sesión».
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
        description: [rol.value, usuario.value?.email].filter(Boolean).join(' · '),
    }],
    // Empresa activa (con más de una): opciones a la vista, sin submenú (en el teléfono un submenú
    // se sale de la pantalla).
    ...(conSelector.value
        ? [[
                { type: 'label' as const, label: empresaActiva.value ? `Empresa: ${empresaActiva.value}` : 'Empresa', icon: 'i-lucide-building-2' },
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
            ]]
        : []),
    [{
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
            class="boton-flotante boton-circulo boton-cuenta"
            :aria-label="`Menú de usuario: ${usuario?.nombre ?? ''}`"
            :title="usuario?.nombre"
            data-prueba="menu-usuario"
        >
            <span aria-hidden="true">{{ iniciales }}</span>
            <!-- La empresa activa no se ve en el círculo (está dentro del menú); queda para lectores
                 de pantalla y para las pruebas. -->
            <span
                v-if="conSelector && empresaActiva"
                class="sr-only"
                data-prueba="empresa-activa"
            >{{ empresaActiva }}</span>
        </UButton>
    </UDropdownMenu>
    <QueCambioModal v-model:open="queCambioAbierto" />
    <AtajosTecladoModal v-model:open="atajosAbierto" />
</template>
