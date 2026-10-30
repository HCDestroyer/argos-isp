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

const { puede } = usePermisos()
const toast = useToast()

/**
 * Eliminar sin historial (`contratos/eliminar.md`): con `routers.eliminar` (admin) se pregunta si
 * se puede; si nunca se usó, «Eliminar», y si no, los motivos y «Desactivar» (`PUT` con
 * `activo: false`, `routers.editar`). Un router inactivo se vuelve a activar igual.
 */
const puedeEliminar = computed(() => puede('routers.eliminar'))
const eliminable = shallowRef<Eliminable | null>(null)
const problemaEliminable = ref<Problem | null>(null)
const eliminarAbierto = ref(false)
const liberaRouter = ref<string[]>([])

async function cargarEliminable() {
    const actual = nas.value
    if (!actual || !puedeEliminar.value) {
        eliminable.value = null
        return
    }
    problemaEliminable.value = null
    const resultado = await useRouters().eliminable(actual.id)
    eliminable.value = resultado.ok ? resultado.data : null
    problemaEliminable.value = resultado.ok ? null : resultado.problema
}

watch(() => [nas.value?.id, nas.value?.version], () => void cargarEliminable())

/** Lo que se libera: sus redes IPv4 y sus bloques IPv6 con sus pools (los planes se conservan). */
async function abrirEliminar() {
    const actual = nas.value
    if (!actual) {
        return
    }
    // Sin `redes.ver` / `ipv6.ver` no se listan: se dice en general.
    const [redes, bloques] = await Promise.all([
        puede('redes.ver') ? useRouters().redesIpv4(actual.id) : null,
        puede('ipv6.ver') ? useRouters().ipv6Bloques(actual.id) : null,
    ])
    liberaRouter.value = [
        `NAS ${actual.nas_ip}`,
        ...(redes?.ok ? redes.data.map(r => `Red IPv4 ${r.cidr}`) : ['Sus redes IPv4']),
        ...(bloques?.ok ? bloques.data.map(b => `Bloque IPv6 ${b.prefijo} con sus pools`) : ['Sus bloques y pools IPv6']),
        'Los planes no se borran: solo deja de estar en ellos',
    ]
    eliminarAbierto.value = true
}

function alEliminar() {
    toast.add({ title: `${nas.value?.nombre ?? 'Router'} eliminado`, description: 'Sus redes y pools quedaron libres.', icon: 'i-lucide-trash-2', color: 'success' })
    void navigateTo('/routers')
}

const cambiarActivoAbierto = ref(false)
const cambiandoActivo = ref(false)
const problemaActivo = ref<Problem | null>(null)

async function cambiarActivo() {
    const actual = nas.value
    if (!actual) {
        return
    }
    cambiandoActivo.value = true
    problemaActivo.value = null
    const resultado = await useRouters().editar(actual.id, { version: actual.version, activo: !actual.activo })
    cambiandoActivo.value = false
    if (!resultado.ok) {
        problemaActivo.value = resultado.problema
        return
    }
    nas.value = resultado.data
    cambiarActivoAbierto.value = false
    toast.add({ title: resultado.data.activo ? `${resultado.data.nombre} activado` : `${resultado.data.nombre} desactivado`, icon: 'i-lucide-circle-check', color: 'success' })
}

watch(cambiarActivoAbierto, (valor) => {
    if (valor) {
        problemaActivo.value = null
    }
})

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

            <div
                v-if="puede('routers.editar') || puedeEliminar"
                class="mt-6 flex flex-col gap-2 border-t border-default pt-4"
                data-prueba="router-baja"
            >
                <ProblemaAlerta
                    v-if="problemaEliminable"
                    :problema="problemaEliminable"
                    :reintentar="cargarEliminable"
                />
                <div class="flex flex-wrap items-center gap-2">
                    <UButton
                        v-if="puedeEliminar && eliminable?.eliminable"
                        label="Eliminar"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="outline"
                        data-prueba="eliminar-router"
                        @click="abrirEliminar"
                    />
                    <UButton
                        v-if="puede('routers.editar') && !eliminable?.eliminable"
                        :label="nas.activo ? 'Desactivar' : 'Activar'"
                        :icon="nas.activo ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
                        color="neutral"
                        variant="outline"
                        data-prueba="cambiar-activo-router"
                        @click="cambiarActivoAbierto = true"
                    />
                </div>
                <p
                    v-if="puedeEliminar && eliminable?.eliminable"
                    class="text-xs text-muted"
                >
                    Nunca se usó: se puede borrar del todo.
                </p>
                <p
                    v-else-if="puedeEliminar && eliminable"
                    class="flex items-start gap-1.5 text-xs text-muted"
                    data-prueba="no-eliminable"
                >
                    <UIcon
                        name="i-lucide-history"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>{{ textoNoEliminable('router', eliminable.motivos, !nas.activo) }}</span>
                </p>
            </div>
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

        <EliminarRegistroModal
            v-if="nas && puedeEliminar && eliminable?.eliminable"
            :id="nas.id"
            v-model:open="eliminarAbierto"
            tipo="router"
            :nombre="nas.nombre"
            :version="nas.version"
            :libera="liberaRouter"
            @eliminado="alEliminar"
            @recargar="cargar"
        />

        <UModal
            v-if="nas && puede('routers.editar')"
            v-model:open="cambiarActivoAbierto"
            :title="nas.activo ? `Desactivar ${nas.nombre}` : `Activar ${nas.nombre}`"
            :description="nas.activo ? 'Argos deja de enviarle comandos. Su historial se conserva y lo encuentras en «Inactivos» de la lista de routers.' : 'Argos vuelve a enviarle comandos y aparece en la lista de routers activos.'"
            :dismissible="!cambiandoActivo"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaActivo"
                    :problema="problemaActivo"
                    :reintentar="problemaActivo.status === 409 ? cargar : undefined"
                />
                <p
                    v-else
                    class="text-sm text-muted"
                >
                    {{ nas.activo ? 'Puedes volver a activarlo cuando quieras.' : 'Revisa que el router esté en línea antes de activarlo.' }}
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="cambiandoActivo"
                        @click="cambiarActivoAbierto = false"
                    />
                    <UButton
                        :label="nas.activo ? 'Desactivar' : 'Activar'"
                        :color="nas.activo ? 'warning' : 'primary'"
                        :loading="cambiandoActivo"
                        data-prueba="confirmar-activo-router"
                        @click="cambiarActivo"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
