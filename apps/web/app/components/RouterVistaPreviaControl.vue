<script setup lang="ts">
import type { AccordionItem, TableColumn } from '@nuxt/ui'

/**
 * Vista previa del cambio de modo de colas de un router (`GET /routers/:id/vista-previa-control`,
 * schema `VistaPreviaControl` de A2): servicios afectados, lotes del worker, sesiones PPPoE que se
 * desconectan y, por menú de RouterOS, lo que se crea, se actualiza y se borra. Solo muestra lo
 * que manda la API; no calcula nada sobre datos que no llegaron.
 */
const props = defineProps<{
    vista: VistaPreviaControl
}>()

/** Objetos que se listan por operación antes de "y N más" (un router grande pasa de mil). */
const MAXIMO_POR_LISTA = 100

const totales = computed(() => totalesVistaPrevia(props.vista.menus))
const sinCambios = computed(() => props.vista.menus.length === 0)

const numero = { class: { th: 'w-0 text-right', td: 'w-0 text-right tabular-nums' } }
const columnas: TableColumn<MenuVistaPrevia>[] = [
    { accessorKey: 'ruta', header: 'Menú de RouterOS' },
    { accessorKey: 'crear', header: 'Crea', meta: numero },
    { accessorKey: 'actualizar', header: 'Actualiza', meta: numero },
    { accessorKey: 'borrar', header: 'Borra', meta: numero },
]

const operaciones: OperacionVistaPrevia[] = ['crear', 'actualizar', 'borrar']

/** Una sección del desplegable por operación con objetos; el orden de `secciones` es el de `items`. */
const secciones = computed(() => operaciones
    .filter(operacion => props.vista[operacion].length > 0)
    .map(operacion => ({
        operacion,
        total: props.vista[operacion].length,
        grupos: agruparPorMenu(props.vista[operacion].slice(0, MAXIMO_POR_LISTA)),
        ocultos: Math.max(0, props.vista[operacion].length - MAXIMO_POR_LISTA),
    })))

const items = computed<AccordionItem[]>(() => secciones.value.map(seccion => ({
    label: `${OPERACIONES_VISTA_PREVIA[seccion.operacion].etiqueta} · ${seccion.total} ${seccion.total === 1 ? 'objeto' : 'objetos'}`,
    icon: OPERACIONES_VISTA_PREVIA[seccion.operacion].icono,
    value: seccion.operacion,
})))

function plural(cantidad: number, singular: string, varios: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : varios}`
}
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="vista-previa-control"
    >
        <dl class="grid grid-cols-3 gap-2">
            <div class="flex flex-col gap-0.5 rounded-lg border border-default p-3">
                <dt class="text-xs text-muted">
                    Servicios afectados
                </dt>
                <dd
                    class="text-lg font-semibold text-highlighted tabular-nums"
                    data-prueba="vista-servicios"
                >
                    {{ vista.servicios }}
                </dd>
            </div>
            <div class="flex flex-col gap-0.5 rounded-lg border border-default p-3">
                <dt class="text-xs text-muted">
                    Lotes
                </dt>
                <dd
                    class="text-lg font-semibold text-highlighted tabular-nums"
                    data-prueba="vista-lotes"
                >
                    {{ vista.lotes }}
                </dd>
            </div>
            <div class="flex flex-col gap-0.5 rounded-lg border border-default p-3">
                <dt class="text-xs text-muted">
                    Sesiones a desconectar
                </dt>
                <dd
                    class="text-lg font-semibold tabular-nums"
                    :class="vista.sesiones_a_desconectar > 0 ? 'text-error' : 'text-highlighted'"
                    data-prueba="vista-sesiones"
                >
                    {{ vista.sesiones_a_desconectar }}
                </dd>
            </div>
        </dl>

        <UAlert
            v-if="vista.sesiones_a_desconectar > 0"
            color="error"
            variant="subtle"
            icon="i-lucide-unplug"
            :title="`Se desconectarán ${plural(vista.sesiones_a_desconectar, 'sesión PPPoE', 'sesiones PPPoE')}`"
            description="Cada sesión abierta recibe un Disconnect para entrar con el perfil del modo nuevo. Los clientes se quedan sin internet unos segundos mientras su equipo vuelve a marcar; el worker lo hace por lotes, con pausa entre uno y otro."
            data-prueba="aviso-desconexiones"
        />
        <UAlert
            v-else-if="!sinCambios"
            color="info"
            variant="subtle"
            icon="i-lucide-plug"
            title="Ninguna sesión PPPoE se desconecta"
            description="No hay sesiones PPPoE abiertas en este router que deban reconectar."
        />

        <UAlert
            v-if="sinCambios"
            color="neutral"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Sin cambios en el router"
            description="La API no encontró objetos que crear, actualizar o borrar con este cambio."
            data-prueba="vista-sin-cambios"
        />
        <template v-else>
            <p class="text-sm text-muted">
                {{ plural(vista.servicios, 'servicio', 'servicios') }} en {{ plural(vista.lotes, 'lote', 'lotes') }}:
                se crean {{ totales.crear }}, se actualizan {{ totales.actualizar }} y se borran {{ totales.borrar }} objetos de ArgosIsp.
            </p>
            <UTable
                :data="vista.menus"
                :columns="columnas"
                :ui="{ th: 'px-2 sm:px-4', td: 'px-2 py-3 sm:px-4 whitespace-normal' }"
                class="rounded-lg border border-default"
                data-prueba="vista-menus"
            >
                <template #ruta-cell="{ row }">
                    <div class="flex min-w-0 flex-col">
                        <span class="font-mono text-xs break-all text-highlighted">{{ row.original.ruta }}</span>
                        <span
                            v-if="descripcionMenu(row.original.ruta)"
                            class="text-xs text-muted"
                        >{{ descripcionMenu(row.original.ruta) }}</span>
                    </div>
                </template>
                <template #crear-cell="{ row }">
                    <span :class="row.original.crear ? 'font-medium text-success' : 'text-dimmed'">{{ row.original.crear }}</span>
                </template>
                <template #actualizar-cell="{ row }">
                    <span :class="row.original.actualizar ? 'font-medium text-warning' : 'text-dimmed'">{{ row.original.actualizar }}</span>
                </template>
                <template #borrar-cell="{ row }">
                    <span :class="row.original.borrar ? 'font-medium text-error' : 'text-dimmed'">{{ row.original.borrar }}</span>
                </template>
            </UTable>

            <UAccordion
                type="multiple"
                :items="items"
                :ui="{ trigger: 'text-sm' }"
                data-prueba="vista-objetos"
            >
                <template #body="{ index }">
                    <div
                        v-if="secciones[index]"
                        class="flex flex-col gap-3"
                    >
                        <div
                            v-for="grupo in secciones[index].grupos"
                            :key="grupo.ruta"
                            class="flex flex-col gap-1"
                        >
                            <p class="font-mono text-xs font-medium text-highlighted">
                                {{ grupo.ruta }}
                            </p>
                            <ul class="flex flex-col gap-0.5 border-l border-default pl-3">
                                <li
                                    v-for="objeto in grupo.objetos"
                                    :key="`${objeto.ruta}|${objeto.clave}`"
                                    class="flex flex-wrap gap-x-2 font-mono text-xs break-all"
                                >
                                    <span class="text-default">{{ objeto.clave }}</span>
                                    <span
                                        v-if="objeto.nombre && objeto.nombre !== objeto.clave"
                                        class="text-muted"
                                    >{{ objeto.nombre }}</span>
                                </li>
                            </ul>
                        </div>
                        <p
                            v-if="secciones[index].ocultos"
                            class="text-xs text-muted"
                        >
                            Y {{ secciones[index].ocultos }} más; los totales por menú están en la tabla.
                        </p>
                    </div>
                </template>
            </UAccordion>
        </template>
    </div>
</template>
