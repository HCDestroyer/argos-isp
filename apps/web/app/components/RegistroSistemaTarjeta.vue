<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Últimos eventos del registro del sistema (`GET /sistema/registro`, `sistema.ver_registro`) para
 * el inicio: nivel con color + icono, título, origen y hace cuánto, enlace a la entidad y «Ver
 * todo». Con error, «Reintentar»; nunca una lista vacía que parezca «sin fallos».
 */
const props = withDefaults(defineProps<{
    limite?: number
}>(), {
    limite: 5,
})

const { puede, enlace } = usePermisos()
const filas = shallowRef<EntradaRegistro[] | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    if (!puede('sistema.ver_registro')) {
        return
    }
    cargando.value = true
    const resultado = await useSistema().registro({ limit: props.limite })
    cargando.value = false
    filas.value = resultado.ok ? resultado.data.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

const TONO_NIVEL: Record<EntradaRegistro['nivel'], string> = {
    error: 'bg-error/10 text-error',
    advertencia: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
}
</script>

<template>
    <section
        class="flex min-w-0 flex-col gap-3 surface-card p-4 sm:p-5"
        aria-labelledby="titulo-registro"
        data-prueba="registro-sistema"
    >
        <header class="flex items-center justify-between gap-2">
            <h3
                id="titulo-registro"
                class="text-sm font-semibold text-highlighted"
            >
                Registro del sistema
            </h3>
            <UButton
                v-if="enlace('/sistema/registro')"
                :to="enlace('/sistema/registro')"
                label="Ver todo"
                trailing-icon="i-lucide-arrow-right"
                color="neutral"
                variant="link"
                size="sm"
            />
        </header>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="filas === null"
            class="flex flex-col gap-2"
        >
            <USkeleton
                v-for="i in 3"
                :key="i"
                class="h-11 w-full"
            />
        </div>
        <ul
            v-else-if="filas.length"
            class="flex flex-col divide-y divide-(--ax-borde)"
        >
            <li
                v-for="fila in filas"
                :key="fila.id"
                class="flex items-start gap-3 py-2.5"
            >
                <span
                    class="flex size-7 shrink-0 items-center justify-center rounded-lg"
                    :class="TONO_NIVEL[fila.nivel]"
                    :title="NIVELES_REGISTRO[fila.nivel].etiqueta"
                >
                    <UIcon
                        :name="NIVELES_REGISTRO[fila.nivel].icono"
                        class="size-4"
                    />
                    <span class="sr-only">{{ NIVELES_REGISTRO[fila.nivel].etiqueta }}</span>
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                    <ULink
                        v-if="rutaEntidadRegistro(fila.entidad) && enlace(rutaEntidadRegistro(fila.entidad) ?? '')"
                        :to="enlace(rutaEntidadRegistro(fila.entidad) ?? '')"
                        class="truncate text-sm font-semibold text-highlighted hover:text-primary"
                    >{{ fila.titulo }}</ULink>
                    <span
                        v-else
                        class="truncate text-sm font-semibold text-highlighted"
                    >{{ fila.titulo }}</span>
                    <span class="text-xs text-muted">{{ ORIGENES_REGISTRO[fila.origen] }} · <time
                        :datetime="fila.momento"
                        :title="formatearFechaHora(fila.momento)"
                    >{{ haceCuanto(fila.momento) }}</time></span>
                </span>
            </li>
        </ul>
        <UEmpty
            v-else
            icon="i-lucide-check-circle-2"
            title="Sin errores ni avisos recientes"
            description="Aquí aparecen los fallos de la API, la red, RADIUS y las colas de los últimos 7 días."
            variant="naked"
            size="sm"
        />
    </section>
</template>
