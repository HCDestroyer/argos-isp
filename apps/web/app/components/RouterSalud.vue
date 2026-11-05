<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Franja de salud arriba de la ficha del router (pedido del PM, núcleo de routers). Solo lo que la API
 * ya da, cada dato con su propia lectura y su «Reintentar» si falla (nunca un número inventado):
 * contacto (`en_linea`, `ultimo_contacto`), túnel y API (`GET /routers/:id/conexion`), RADIUS (modo
 * de seguridad, NAS y secreto), sesiones abiertas (`GET /routers/:id/resumen-sesiones`, `sesiones.ver`)
 * y ocupación de pools IPv4/IPv6 (`GET /routers/:id/direccionamiento`). Latencia, CPU, salud de CoA y
 * deriva por recurso aún no tienen endpoint barato: pedido en `.claude/integration/a4.md`.
 */
const props = defineProps<{
    router: RouterNas
}>()

const { puede } = usePermisos()

const conexion = shallowRef<ConexionRouter | null>(null)
const problemaConexion = ref<Problem | null>(null)
const sesiones = shallowRef<ResumenSesionesRouter | null>(null)
const problemaSesiones = ref<Problem | null>(null)
const direccionamiento = shallowRef<DireccionamientoRouter | null>(null)
const problemaDireccionamiento = ref<Problem | null>(null)

async function cargarConexion() {
    problemaConexion.value = null
    const resultado = await useRouters().conexion(props.router.id)
    conexion.value = resultado.ok ? resultado.data : null
    problemaConexion.value = resultado.ok ? null : resultado.problema
}

async function cargarSesiones() {
    if (!puede('sesiones.ver')) {
        return
    }
    problemaSesiones.value = null
    // `desde` = ahora: solo importan las sesiones abiertas, no la fecha de migración.
    const resultado = await useRouters().resumenSesiones(props.router.id, new Date().toISOString())
    sesiones.value = resultado.ok ? resultado.data : null
    problemaSesiones.value = resultado.ok ? null : resultado.problema
}

async function cargarDireccionamiento() {
    problemaDireccionamiento.value = null
    const resultado = await useRouters().direccionamiento(props.router.id)
    direccionamiento.value = resultado.ok ? resultado.data : null
    problemaDireccionamiento.value = resultado.ok ? null : resultado.problema
}

function cargar() {
    void cargarConexion()
    void cargarSesiones()
    void cargarDireccionamiento()
}

watch(() => props.router.id, cargar, { immediate: true })

defineExpose({ cargar })

const tunel = computed(() => conexion.value ? ESTADOS_TUNEL[conexion.value.estado] : null)
const sinRadius = computed(() => esSinRadius(props.router))

/** La entrega IPv6 más ocupada (enlace o delegación), que es la que se acaba primero. */
const ipv6MasOcupado = computed(() => {
    const entregas = direccionamiento.value?.ocupacion.ipv6 ?? []
    return [...entregas].sort((a, b) => b.ocupacion.porcentaje - a.ocupacion.porcentaje)[0] ?? null
})

function colorOcupacion(porcentaje: number): 'success' | 'warning' | 'error' {
    if (porcentaje >= 90) {
        return 'error'
    }
    return porcentaje >= 75 ? 'warning' : 'success'
}

function numero(valor: number): string {
    return valor.toLocaleString('es-GT')
}
</script>

<template>
    <section
        class="grid grid-cols-2 gap-3 lg:grid-cols-5"
        aria-label="Salud del router"
        data-prueba="router-salud"
    >
        <div
            class="surface-card flex flex-col gap-1.5 p-3"
            data-salud="contacto"
        >
            <span class="text-xs text-muted">Contacto</span>
            <RouterContacto
                :router="router"
                compacto
                class="flex-col items-start"
            />
        </div>

        <div
            class="surface-card flex flex-col gap-1.5 p-3"
            data-salud="api"
        >
            <span class="text-xs text-muted">Túnel y API</span>
            <template v-if="problemaConexion">
                <span class="text-sm text-error">No se pudo leer</span>
                <UButton
                    label="Reintentar"
                    icon="i-lucide-rotate-cw"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="self-start p-0"
                    @click="cargarConexion"
                />
            </template>
            <USkeleton
                v-else-if="!tunel"
                class="h-5 w-24"
            />
            <template v-else>
                <UBadge
                    :label="tunel.etiqueta"
                    :icon="tunel.icono"
                    :color="tunel.color"
                    variant="subtle"
                    size="sm"
                    class="self-start"
                    data-prueba="salud-tunel"
                />
                <span class="text-xs text-muted">
                    {{ tieneCredencialesApi(router) ? `API: ${router.api_usuario}` : 'Sin credenciales de la API' }}
                </span>
            </template>
        </div>

        <div
            class="surface-card flex flex-col gap-1.5 p-3"
            data-salud="radius"
        >
            <span class="text-xs text-muted">RADIUS y CoA</span>
            <UBadge
                :label="MODOS_SEGURIDAD[router.modo_seguridad].etiqueta"
                :icon="MODOS_SEGURIDAD[router.modo_seguridad].icono"
                :color="sinRadius ? 'neutral' : (router.tiene_radius_secret ? 'success' : 'warning')"
                variant="subtle"
                size="sm"
                class="self-start"
            />
            <span
                class="text-xs"
                :class="sinRadius || router.tiene_radius_secret ? 'text-muted' : 'text-warning'"
            >
                {{ sinRadius ? 'PPPoE con secrets locales' : (router.tiene_radius_secret ? `NAS ${router.nas_ip ?? '—'}` : 'Falta el secreto RADIUS') }}
            </span>
        </div>

        <div
            v-if="puede('sesiones.ver')"
            class="surface-card flex flex-col gap-1.5 p-3"
            data-salud="sesiones"
        >
            <span class="text-xs text-muted">Sesiones abiertas</span>
            <template v-if="problemaSesiones">
                <span class="text-sm text-error">No se pudo leer</span>
                <UButton
                    label="Reintentar"
                    icon="i-lucide-rotate-cw"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="self-start p-0"
                    @click="cargarSesiones"
                />
            </template>
            <USkeleton
                v-else-if="!sesiones"
                class="h-5 w-16"
            />
            <template v-else>
                <span
                    class="text-lg font-semibold text-highlighted tabular-nums"
                    data-prueba="salud-sesiones"
                >{{ numero(sesiones.sesiones_activas) }}</span>
                <span class="text-xs text-muted">{{ numero(sesiones.con_sesion_activa) }} de {{ numero(sesiones.servicios) }} servicios PPPoE conectados</span>
            </template>
        </div>

        <div
            class="surface-card col-span-2 flex flex-col gap-1.5 p-3 lg:col-span-1"
            data-salud="pools"
        >
            <span class="text-xs text-muted">Ocupación de pools</span>
            <template v-if="problemaDireccionamiento">
                <span class="text-sm text-error">No se pudo leer</span>
                <UButton
                    label="Reintentar"
                    icon="i-lucide-rotate-cw"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="self-start p-0"
                    @click="cargarDireccionamiento"
                />
            </template>
            <USkeleton
                v-else-if="!direccionamiento"
                class="h-5 w-full"
            />
            <div
                v-else
                class="flex flex-col gap-2"
            >
                <div
                    class="flex flex-col gap-1"
                    data-prueba="salud-ipv4"
                >
                    <span class="flex justify-between text-xs">
                        <span class="text-default">IPv4</span>
                        <span class="text-muted tabular-nums">{{ direccionamiento.ocupacion.ipv4.total ? `${direccionamiento.ocupacion.ipv4.porcentaje}% · ${numero(direccionamiento.ocupacion.ipv4.libres)} libres` : 'Sin redes' }}</span>
                    </span>
                    <UProgress
                        v-if="direccionamiento.ocupacion.ipv4.total"
                        :model-value="direccionamiento.ocupacion.ipv4.porcentaje"
                        :color="colorOcupacion(direccionamiento.ocupacion.ipv4.porcentaje)"
                        size="xs"
                    />
                </div>
                <div
                    class="flex flex-col gap-1"
                    data-prueba="salud-ipv6"
                >
                    <span class="flex justify-between text-xs">
                        <span class="text-default">IPv6</span>
                        <span class="text-muted tabular-nums">{{ ipv6MasOcupado ? `${ipv6MasOcupado.ocupacion.porcentaje}% · /${ipv6MasOcupado.tamano_entrega} ${ipv6MasOcupado.tipo === 'delegacion' ? 'delegados' : 'de enlace'}` : 'Sin pools' }}</span>
                    </span>
                    <UProgress
                        v-if="ipv6MasOcupado"
                        :model-value="ipv6MasOcupado.ocupacion.porcentaje"
                        :color="colorOcupacion(ipv6MasOcupado.ocupacion.porcentaje)"
                        size="xs"
                    />
                </div>
            </div>
        </div>
    </section>
</template>
