<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { VistaPreviaEstrategia } from '~/types/controlVelocidad'

/**
 * Vista previa de un cambio de estrategia (`POST /routers/:id/vista-previa-estrategia`): servicios,
 * lotes, sesiones con CoA, sesiones que conservan lo anterior y las que se desconectarían, las
 * advertencias y, por menú de RouterOS, lo que se crea, se cambia y se borra. Solo muestra lo que
 * manda la API.
 */
const props = defineProps<{
    vista: VistaPreviaEstrategia
}>()

const MAXIMO = 50
const sinCambios = computed(() => props.vista.menus.length === 0)

type Menu = VistaPreviaEstrategia['menus'][number]
const numero = { class: { th: 'w-0 text-right', td: 'w-0 text-right tabular-nums' } }
const columnas: TableColumn<Menu>[] = [
    { accessorKey: 'ruta', header: 'Menú de RouterOS' },
    { accessorKey: 'crear', header: 'Crea', meta: numero },
    { accessorKey: 'actualizar', header: 'Cambia', meta: numero },
    { accessorKey: 'borrar', header: 'Borra', meta: numero },
]

const listas = computed(() => [
    { clave: 'crear', titulo: 'Se crea', icono: 'i-lucide-plus', objetos: props.vista.crear },
    { clave: 'actualizar', titulo: 'Se cambia', icono: 'i-lucide-pencil', objetos: props.vista.actualizar },
    { clave: 'borrar', titulo: 'Se borra (al final, cuando nadie lo usa)', icono: 'i-lucide-trash-2', objetos: props.vista.borrar },
].filter(l => l.objetos.length))

/** Pasos del cambio en el orden que manda la API (`orden`): crear → mover por lotes → borrar. */
const orden = computed(() => {
    const lotes = props.vista.lotes === 1 ? '1 lote' : `${props.vista.lotes} lotes`
    const pasos: Record<VistaPreviaEstrategia['orden'][number], string> = {
        preparar: 'se crea lo nuevo',
        lotes: `se mueve a cada cliente en ${lotes} de hasta 50`,
        terminar: 'se borra lo que ya nadie usa',
    }
    return props.vista.orden.map(paso => pasos[paso]).join(', después ')
})

const datos = computed(() => [
    { etiqueta: 'Servicios', valor: props.vista.servicios, prueba: 'previa-servicios' },
    { etiqueta: 'Lotes', valor: props.vista.lotes, prueba: 'previa-lotes' },
    { etiqueta: 'Sesiones con la velocidad nueva al instante', valor: props.vista.sesiones_coa, prueba: 'previa-coa' },
    { etiqueta: 'Sesiones que conservan lo anterior', valor: props.vista.sesiones_conservan, prueba: 'previa-conservan' },
])
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="vista-previa-estrategia"
    >
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div
                v-for="dato in datos"
                :key="dato.prueba"
                class="flex flex-col gap-0.5 surface-card p-3"
            >
                <dt class="text-xs text-muted">
                    {{ dato.etiqueta }}
                </dt>
                <dd
                    class="text-lg font-semibold text-highlighted tabular-nums"
                    :data-prueba="dato.prueba"
                >
                    {{ dato.valor.toLocaleString('es-GT') }}
                </dd>
            </div>
        </dl>

        <UAlert
            v-for="advertencia in vista.advertencias"
            :key="`${advertencia.regla}-${advertencia.mensaje}`"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="advertencia.mensaje"
            :data-advertencia="advertencia.regla"
        />

        <UAlert
            v-if="sinCambios"
            color="neutral"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Sin cambios en el router"
            description="Con esta estrategia el router queda igual."
            data-prueba="previa-sin-cambios"
        />
        <template v-else>
            <UTable
                :data="vista.menus"
                :columns="columnas"
                tabindex="0"
                aria-label="Cambios por menú de RouterOS"
            />
            <p
                class="text-xs text-muted"
                data-prueba="previa-orden"
            >
                Orden: {{ orden }}. Nadie se queda sin internet en el cambio.
            </p>
            <section
                v-for="lista in listas"
                :key="lista.clave"
                class="flex flex-col gap-1"
                :data-prueba="`previa-${lista.clave}`"
            >
                <h4 class="flex items-center gap-1.5 text-xs font-medium text-highlighted">
                    <UIcon
                        :name="lista.icono"
                        class="size-3.5"
                    />
                    {{ lista.titulo }} ({{ lista.objetos.length }})
                </h4>
                <ul class="flex flex-col gap-0.5 font-mono text-xs text-muted">
                    <li
                        v-for="objeto in lista.objetos.slice(0, MAXIMO)"
                        :key="`${objeto.ruta}-${objeto.clave}`"
                        class="break-all"
                    >
                        {{ objeto.ruta }} · {{ objeto.nombre ?? objeto.clave }}
                    </li>
                    <li v-if="lista.objetos.length > MAXIMO">
                        Y {{ lista.objetos.length - MAXIMO }} más.
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>
