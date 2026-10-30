<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha del router: destino del autologin desde Horus (`/routers/:id`, `rutaDestino` de A1), "Ver
 * en Horus", su estado en línea con el último contacto (`en_linea` null = desconocido) y su
 * direccionamiento (redes IPv4, bloques y pools IPv6). «Editar» y el menú de acciones del router
 * (`RouterAcciones`) van en la barra superior.
 * Si el router está registrado dos veces, el aviso de duplicados con «Unir»; si ya se unió a otro
 * (`unido_a_id`), el enlace al que quedó (`contratos/routers.md`).
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

/** Sube al unir para volver a leer el direccionamiento (redes y bloques que llegaron o se fueron). */
const lecturas = ref(0)

function alUnir(resultado: UnionRouters) {
    lecturas.value++
    // Si esta ficha era la del absorbido, el router que sigue en uso es el que quedó.
    if (resultado.absorbido_id === routerId.value) {
        nas.value = resultado.absorbido
        return
    }
    nas.value = resultado.router
}

/** Tras probar la conexión o generar un script: estado en línea y sección «Conexión» al día. */
const seccionConexion = useTemplateRef('seccionConexion')
async function refrescar() {
    const resultado = await useRouters().ver(routerId.value)
    if (resultado.ok) {
        nas.value = resultado.data
    }
    await seccionConexion.value?.cargar()
}

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
                @probado="refrescar"
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

        <UAlert
            v-if="!cargando && nas?.unido_a_id"
            color="info"
            variant="subtle"
            icon="i-lucide-merge"
            title="Este router se unió a otro"
            description="Era el mismo MikroTik registrado dos veces: sus servicios, sesiones, redes y planes pasaron al router que quedó. Este registro queda desactivado con su historial."
            :actions="[{ label: 'Ver el router que quedó', to: `/routers/${nas.unido_a_id}`, icon: 'i-lucide-arrow-right', color: 'info', variant: 'outline' }]"
            class="mx-auto mb-4 w-full max-w-4xl"
            data-prueba="router-unido"
        />
        <RoutersDuplicadosAviso
            v-if="!cargando && nas?.activo"
            :router-id="nas.id"
            class="mx-auto mb-4 w-full max-w-4xl"
            @unido="alUnir"
        />
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
        <RouterConexionSeccion
            v-if="nas"
            ref="seccionConexion"
            :router="nas"
            class="mx-auto mt-6 w-full max-w-4xl"
        />
        <RouterDireccionamiento
            v-if="nas"
            :key="lecturas"
            :router-id="nas.id"
            class="mx-auto mt-6 w-full max-w-4xl"
        />
    </PanelPagina>
</template>
