<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Menú del usuario en el encabezado (diseño final, IslasA5/A6): un círculo flotante con las
 * iniciales. El nombre, el rol y la empresa activa van dentro del menú, junto con la empresa (con
 * más de una), el tema, «Mi cuenta», «Ayuda y atajos», «Qué cambió» y, aparte y en rojo, «Cerrar
 * sesión». En el teléfono (bajo 1024 px) el círculo abre el panel de la cuenta desde abajo
 * (`CuentaDrawer`, tablero PerfilDrawer); los dos salen de la misma lista (`useMenuCuenta`).
 */
const { usuario } = useAuth()
const toast = useToast()
const {
    iniciales,
    rol,
    empresaActiva,
    conSelector,
    opcionesEmpresa,
    eleccion,
    tema,
    abierto: cuentaAbierta,
    queCambioAbierto,
    atajosAbierto,
    elegirEmpresa,
    cerrarSesion,
} = useMenuCuenta()

/*
 * Versión instalada (`GET /version`): se ve en el menú y abre "Qué cambió". La primera vez que el
 * usuario entra a una versión publicada distinta de la última que vio, un aviso discreto lo ofrece
 * (la última vista se recuerda por usuario en `localStorage`; sin almacenamiento, no pasa nada).
 */
const { version, cargar: cargarVersion } = useVersion()

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

/*
 * Desde 1024 px, el menú desplegable; debajo, el círculo abre el panel de la cuenta que sube desde
 * abajo (`CuentaDrawer`, tablero PerfilDrawer). Los dos salen de `useMenuCuenta`.
 */
const escritorio = ref(true)
let consulta: MediaQueryList | null = null
function medir() {
    escritorio.value = consulta?.matches ?? true
}
onMounted(() => {
    consulta = window.matchMedia('(min-width: 1024px)')
    medir()
    consulta.addEventListener('change', medir)
})
onBeforeUnmount(() => consulta?.removeEventListener('change', medir))

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
                ...opcionesEmpresa.value.map(opcion => ({
                    label: opcion.etiqueta,
                    description: opcion.nit ?? undefined,
                    icon: opcion.valor === 'todas' ? 'i-lucide-layers' : undefined,
                    type: 'checkbox' as const,
                    checked: eleccion.value === opcion.valor,
                    onSelect: () => elegirEmpresa(opcion.valor),
                })),
            ]]
        : []),
    [{
        label: 'Tema',
        icon: 'i-lucide-sun-moon',
        children: TEMAS_CUENTA.map(opcion => ({
            label: opcion.etiqueta,
            icon: opcion.icono,
            type: 'checkbox' as const,
            checked: tema.value === opcion.valor,
            onSelect(evento: Event) {
                evento.preventDefault()
                tema.value = opcion.valor
            },
        })),
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
            cerrarSesion()
        },
    }],
])
</script>

<template>
    <UDropdownMenu
        v-if="escritorio"
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
    <UButton
        v-else
        color="neutral"
        variant="ghost"
        class="boton-flotante boton-circulo boton-cuenta"
        :aria-label="`Tu cuenta: ${usuario?.nombre ?? ''}`"
        aria-haspopup="dialog"
        :aria-expanded="cuentaAbierta"
        :title="usuario?.nombre"
        data-prueba="menu-usuario"
        @click="cuentaAbierta = true"
    >
        <span aria-hidden="true">{{ iniciales }}</span>
        <span
            v-if="conSelector && empresaActiva"
            class="sr-only"
            data-prueba="empresa-activa"
        >{{ empresaActiva }}</span>
    </UButton>
    <QueCambioModal v-model:open="queCambioAbierto" />
    <AtajosTecladoModal v-model:open="atajosAbierto" />
</template>
