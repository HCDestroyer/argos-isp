<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha del router: destino del autologin desde Horus (`/routers/:id`, `rutaDestino` de A1), "Ver
 * en Horus", su estado en línea con el último contacto (`en_linea` null = desconocido) y su
 * direccionamiento (redes IPv4, bloques y pools IPv6). «Editar» y el menú de acciones del router
 * (`RouterAcciones`) van en la barra superior.
 */
definePageMeta({ permiso: 'routers.ver' })

const route = useRoute()
const routerId = computed(() => Number(route.params.id))

const nas = shallowRef<RouterNas | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${nas.value?.nombre ?? 'Router'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = Number.isInteger(routerId.value) && routerId.value > 0
        ? await useRouters().ver(routerId.value)
        : null
    cargando.value = false
    nas.value = resultado?.ok ? resultado.data : null
    problema.value = resultado && !resultado.ok ? resultado.problema : null
}

onMounted(cargar)

const contacto = computed(() => ESTADOS_ROUTER[nas.value ? estadoContactoRouter(nas.value) : 'desconocido'])

const control = computed(() => {
    const actual = nas.value
    if (!actual) {
        return null
    }
    return CONTROLES_VELOCIDAD[actual.control_velocidad ?? (actual.modo_velocidad === 'pcq' ? 'arbol_pcq' : 'simple')]
})
</script>

<template>
    <PanelPagina
        id="router"
        :titulo="nas?.nombre ?? 'Router'"
        icono="i-lucide-router"
    >
        <template #acciones>
            <VerEnHorusBoton
                v-if="nas"
                tipo="router"
                :id-externo="nas.id"
            />
            <RouterAcciones
                v-if="nas"
                :router="nas"
                con-editar
                @actualizado="nas = $event"
            />
            <UButton
                to="/routers"
                icon="i-lucide-arrow-left"
                label="Routers"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <USkeleton
            v-if="cargando"
            class="h-40 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404 || (!problema && !nas)"
            icon="i-lucide-router"
            title="Router no encontrado"
            :description="`No existe un router con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a routers', to: '/routers', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <section
            v-else-if="nas"
            class="surface-card mx-auto w-full max-w-4xl p-4 sm:p-6"
            aria-label="Datos del router"
        >
            <dl class="grid gap-4 sm:grid-cols-3">
                <DatoFicha
                    etiqueta="Host"
                    :valor="nas.host"
                    mono
                />
                <DatoFicha
                    etiqueta="NAS"
                    :valor="nas.nas_ip"
                    mono
                />
                <DatoFicha etiqueta="Estado">
                    <UBadge
                        :label="nas.activo ? 'Activo' : 'Inactivo'"
                        :icon="nas.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                        :color="nas.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </DatoFicha>
                <DatoFicha etiqueta="En línea">
                    <UBadge
                        :label="contacto.etiqueta"
                        :icon="contacto.icono"
                        :color="contacto.color"
                        variant="subtle"
                        size="sm"
                        :data-prueba="`en-linea-${nas.id}`"
                    />
                </DatoFicha>
                <DatoFicha
                    etiqueta="Último contacto"
                    :valor="nas.ultimo_contacto ? `${formatearFechaHora(nas.ultimo_contacto)} (${textoUltimoContacto(nas)})` : 'Nunca respondió'"
                    :data-prueba="`ultimo-contacto-${nas.id}`"
                />
                <DatoFicha
                    v-if="control"
                    etiqueta="Colas"
                    :valor="control.etiqueta"
                />
            </dl>
        </section>
        <RouterDireccionamiento
            v-if="nas"
            :router-id="nas.id"
            class="mx-auto mt-6 w-full max-w-4xl"
        />
    </PanelPagina>
</template>
