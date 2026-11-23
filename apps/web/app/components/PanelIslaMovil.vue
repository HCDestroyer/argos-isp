<script setup lang="ts">
/**
 * Navegación del teléfono (pedido del PM, como la barra del portal): una isla flotante abajo, a 12 px
 * de los bordes, con el radio y la sombra del menú lateral, y fuera del área segura del iPhone
 * (`env(safe-area-inset-bottom)`). Solo bajo `lg`: desde 1024 px manda el menú lateral.
 *
 * Lleva Inicio, los 2 primeros accesos rápidos del usuario (los mismos del encabezado de escritorio;
 * Cobrar en verde), Avisos con su punto y «Más», que abre el menú completo a pantalla completa con el
 * buscador. Todo según permisos: sin el permiso el destino no aparece (nunca deshabilitado). El
 * espacio que ocupa lo reserva `--ax-isla-reserva` (`main.css`), que usan el contenido, las barras de
 * acción (`PanelBarraAccion`, `FormularioAcciones`) y los avisos emergentes.
 */
const props = defineProps<{
    /** Ruta de Inicio del usuario (`rutaInicio`: el cajero entra a su caja). */
    inicio: string
}>()

/** El menú completo (el lateral, a pantalla completa en el teléfono). */
const menuAbierto = defineModel<boolean>('menuAbierto', { default: false })

const route = useRoute()
const { puede } = usePermisos()
const { accesos } = useAccesosRapidos()
const comprobantes = useComprobantes()

interface DestinoIsla {
    id: string
    etiqueta: string
    nombre: string
    icono: string
    ruta: string
    exito?: boolean
}

function enRuta(ruta: string): boolean {
    return route.path === ruta || route.path.startsWith(`${ruta}/`)
}

const avisos = computed(() => textoContador(comprobantes.contador.value))

const destinos = computed<DestinoIsla[]>(() => [
    { id: 'inicio', etiqueta: 'Inicio', nombre: 'Inicio', icono: 'i-lucide-house', ruta: props.inicio },
    ...accesos.value.slice(0, 2).map(seccion => ({
        id: seccion.id,
        etiqueta: seccion.etiqueta,
        nombre: seccion.etiqueta,
        icono: seccion.icono,
        ruta: seccion.ruta,
        exito: seccion.id === 'cobro',
    })),
    ...(puede('comprobantes.ver')
        ? [{
                id: 'avisos',
                etiqueta: 'Avisos',
                nombre: avisos.value ? `Avisos: ${avisos.value} comprobantes por verificar` : 'Avisos: nada pendiente',
                icono: 'i-lucide-bell',
                ruta: '/comprobantes',
            }]
        : []),
])

/** El destino activo: el de la ruta (Inicio solo exacto) y nunca dos a la vez; con el menú abierto, «Más». */
const activo = computed(() => {
    if (menuAbierto.value) {
        return 'mas'
    }
    if (route.path === props.inicio) {
        return 'inicio'
    }
    return destinos.value.find(destino => destino.id !== 'inicio' && enRuta(destino.ruta))?.id ?? null
})

const COLUMNAS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }

function claseDestino(destino: { id: string, exito?: boolean }): string {
    const base = 'min-h-14 w-full flex-col justify-center gap-1 rounded-2xl px-1 py-1.5 text-[0.6875rem] leading-none font-semibold'
    if (destino.exito) {
        return `${base} isla-exito ${activo.value === destino.id ? 'isla-exito-activo' : ''}`
    }
    return `${base} ${activo.value === destino.id ? 'isla-activo' : 'text-muted hover:text-highlighted'}`
}
</script>

<template>
    <nav
        aria-label="Navegación inferior"
        class="isla-movil fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 lg:hidden"
        data-prueba="isla-movil"
    >
        <ul
            class="grid gap-0.5 p-1.5"
            :class="COLUMNAS[destinos.length + 1] ?? 'grid-cols-5'"
        >
            <li
                v-for="destino in destinos"
                :key="destino.id"
                class="min-w-0"
            >
                <UChip
                    :show="destino.id === 'avisos' && Boolean(avisos)"
                    color="secondary"
                    size="md"
                    class="w-full"
                    :ui="{ base: 'top-2.5 right-[calc(50%-0.875rem)] ring-2 ring-(--ax-tarjeta)' }"
                >
                    <UButton
                        :to="destino.ruta"
                        color="neutral"
                        variant="ghost"
                        :aria-label="destino.nombre"
                        :aria-current="activo === destino.id ? 'page' : undefined"
                        :class="claseDestino(destino)"
                        :data-acceso="destino.id"
                    >
                        <UIcon
                            :name="destino.icono"
                            class="size-[1.375rem] shrink-0"
                        />
                        <span class="max-w-full truncate">{{ destino.etiqueta }}</span>
                    </UButton>
                </UChip>
            </li>
            <li class="min-w-0">
                <UButton
                    color="neutral"
                    variant="ghost"
                    aria-label="Más: menú completo y buscador"
                    :aria-expanded="menuAbierto"
                    aria-haspopup="dialog"
                    :class="claseDestino({ id: 'mas' })"
                    data-prueba="isla-mas"
                    @click="menuAbierto = true"
                >
                    <UIcon
                        name="i-lucide-layout-grid"
                        class="size-[1.375rem] shrink-0"
                    />
                    <span>Más</span>
                </UButton>
            </li>
        </ul>
    </nav>
</template>
