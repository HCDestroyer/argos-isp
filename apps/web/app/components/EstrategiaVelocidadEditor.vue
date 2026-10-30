<script setup lang="ts">
import type { RadioGroupItem, TabsItem } from '@nuxt/ui'
import type { Aplicacion, Estrategia, EstrategiaParcial, EstrategiasPlan, EstrategiasRouter, Extra, MatrizControlVelocidad, Padre, TipoCola, TipoConexionVelocidad } from '~/types/controlVelocidad'

/**
 * Editor por capas de la estrategia de velocidad (`contratos/control-velocidad.md` §1–§3): una
 * pestaña por tipo de conexión con las cuatro capas (aplicación por cliente, padre, tipo de cola y
 * extras). Las opciones que la matriz no admite para ese tipo o esa versión de RouterOS se ven
 * deshabilitadas con el porqué. Cada opción dice en lenguaje simple qué hace y para qué escenario.
 *
 * - Modo router (`router`): edita las tres estrategias completas; «Igual para todos» copia una a las
 *   demás ajustada a lo que admite cada tipo.
 * - Modo plan (`plan`): edita la excepción del plan en el router; cada capa tiene «Heredar del router».
 */
const props = withDefaults(defineProps<{
    matriz: MatrizControlVelocidad
    /** Versión de RouterOS del router (para CAKE y fq_codel); null si no se conoce. */
    version: string | null
    /** Estrategias del router: lo que se edita (modo router) o de dónde se hereda (modo plan). */
    router: EstrategiasRouter
    /** Errores 422 de la API por `<tipo>.<capa>`. */
    errores?: Record<string, string[]>
    /** Tipos de conexión con servicios en el router: se muestra primero el primero de ellos. */
    tipos?: TipoConexionVelocidad[]
}>(), {
    errores: () => ({}),
    tipos: () => [...TIPOS_CONEXION_VELOCIDAD],
})

/** Modo router: las tres estrategias completas. */
const estrategias = defineModel<EstrategiasRouter>('estrategias')
/** Modo plan: la excepción parcial (null = hereda todo). */
const excepcion = defineModel<EstrategiasPlan | null>('excepcion')

const modoPlan = computed(() => estrategias.value === undefined)
const HEREDAR = 'heredar'

const tipo = ref<TipoConexionVelocidad>(props.tipos[0] ?? 'pppoe')
const itemsTipos = computed<TabsItem[]>(() => TIPOS_CONEXION_VELOCIDAD.map(t => ({
    label: ETIQUETAS_TIPO_CONEXION[t],
    value: t,
    badge: Object.keys(props.errores).some(clave => clave.startsWith(`${t}.`)) ? { label: '!', color: 'error' as const } : undefined,
})))

/** Lo que rige en el tipo elegido: la estrategia del router o la efectiva del plan. */
const efectiva = computed<Estrategia>(() => (modoPlan.value
    ? estrategiaEfectiva(props.router[tipo.value], excepcion.value?.[tipo.value])
    : (estrategias.value ?? props.router)[tipo.value]))

const parcial = computed<EstrategiaParcial>(() => excepcion.value?.[tipo.value] ?? {})

function fijar<C extends 'aplicacion' | 'padre' | 'tipo_cola'>(capa: C, valor: Estrategia[C] | typeof HEREDAR) {
    if (modoPlan.value) {
        const nueva: EstrategiasPlan = clonarEstrategia(excepcion.value ?? {})
        // «Heredar» quita la capa del plan (sin `delete` dinámico: se arma sin ella).
        const propia: EstrategiaParcial = Object.fromEntries(Object.entries(nueva[tipo.value] ?? {}).filter(([clave]) => clave !== capa))
        if (valor !== HEREDAR) {
            propia[capa] = valor
        }
        nueva[tipo.value] = propia
        excepcion.value = tieneExcepcion(nueva) ? nueva : null
        return
    }
    if (!estrategias.value || valor === HEREDAR) {
        return
    }
    const nuevas = clonarEstrategia(estrategias.value)
    nuevas[tipo.value][capa] = valor
    // Al cambiar la aplicación, el tipo de cola se ajusta a lo que admite (p. ej. PCQ con árbol).
    nuevas[tipo.value] = ajustarEstrategia(props.matriz, nuevas[tipo.value], tipo.value, props.version)
    estrategias.value = nuevas
}

function fijarExtra(extra: Extra, valor: boolean | typeof HEREDAR) {
    if (modoPlan.value) {
        const nueva: EstrategiasPlan = clonarEstrategia(excepcion.value ?? {})
        const { extras: anteriores, ...resto } = nueva[tipo.value] ?? {}
        const extras: Partial<Record<Extra, boolean>> = Object.fromEntries(Object.entries(anteriores ?? {}).filter(([clave]) => clave !== extra))
        if (valor !== HEREDAR) {
            extras[extra] = valor
        }
        const propia: EstrategiaParcial = Object.keys(extras).length ? { ...resto, extras } : resto
        nueva[tipo.value] = propia
        excepcion.value = tieneExcepcion(nueva) ? nueva : null
        return
    }
    if (!estrategias.value || valor === HEREDAR) {
        return
    }
    const nuevas = clonarEstrategia(estrategias.value)
    nuevas[tipo.value].extras[extra] = valor
    estrategias.value = nuevas
}

function igualParaTodosLos() {
    if (estrategias.value) {
        estrategias.value = igualParaTodos(props.matriz, tipo.value, estrategias.value, props.version)
    }
}

/** Valor del radio: en modo plan, «heredar» si el plan no fija la capa. */
function valorCapa<C extends 'aplicacion' | 'padre' | 'tipo_cola'>(capa: C): string {
    return modoPlan.value ? (parcial.value[capa] ?? HEREDAR) : efectiva.value[capa]
}

function heredado<C extends 'aplicacion' | 'padre' | 'tipo_cola'>(capa: C, etiquetas: Record<string, { etiqueta: string }>): RadioGroupItem[] {
    return modoPlan.value
        ? [{ label: `Heredar del router (${etiquetas[props.router[tipo.value][capa]]?.etiqueta})`, value: HEREDAR, description: 'Si cambias el router, este plan sigue el cambio.' }]
        : []
}

const itemsAplicacion = computed<RadioGroupItem[]>(() => [
    ...heredado('aplicacion', OPCIONES_APLICACION),
    ...APLICACIONES.map((valor) => {
        const disponible = aplicacionDisponible(props.matriz, valor, tipo.value)
        return {
            label: OPCIONES_APLICACION[valor].etiqueta,
            value: valor,
            description: disponible.valida
                ? `${OPCIONES_APLICACION[valor].explicacion} Ejemplo: ${OPCIONES_APLICACION[valor].escenario}`
                : `${OPCIONES_APLICACION[valor].explicacion} No disponible: ${disponible.motivo}`,
            disabled: !disponible.valida,
        }
    }),
])

const itemsPadre = computed<RadioGroupItem[]>(() => [
    ...heredado('padre', OPCIONES_PADRE),
    ...PADRES.map(valor => ({ label: OPCIONES_PADRE[valor].etiqueta, value: valor, description: OPCIONES_PADRE[valor].explicacion })),
])

const itemsTipoCola = computed<RadioGroupItem[]>(() => [
    ...heredado('tipo_cola', OPCIONES_TIPO_COLA),
    ...TIPOS_COLA.map((valor) => {
        const disponible = tipoColaDisponible(props.matriz, valor, efectiva.value.aplicacion, props.version)
        return {
            label: OPCIONES_TIPO_COLA[valor].etiqueta,
            value: valor,
            description: disponible.valida
                ? [OPCIONES_TIPO_COLA[valor].explicacion, disponible.motivo].filter(Boolean).join(' ')
                : `${OPCIONES_TIPO_COLA[valor].explicacion} No disponible: ${disponible.motivo}`,
            disabled: !disponible.valida,
        }
    }),
])

function valorExtra(extra: Extra): boolean {
    return efectiva.value.extras[extra]
}

function extraHeredado(extra: Extra): boolean {
    return modoPlan.value && parcial.value.extras?.[extra] === undefined
}

function erroresDe(capa: string): string | undefined {
    return props.errores[`${tipo.value}.${capa}`]?.join(' · ')
}
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="editor-estrategia"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <UTabs
                v-model="tipo"
                :items="itemsTipos"
                :content="false"
                size="sm"
                class="min-w-0"
                data-prueba="tipos-conexion"
            />
            <UButton
                v-if="!modoPlan"
                label="Igual para todos"
                icon="i-lucide-copy-check"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="`Usar lo de ${ETIQUETAS_TIPO_CONEXION[tipo]} en los demás tipos de conexión`"
                data-prueba="igual-para-todos"
                @click="igualParaTodosLos"
            />
        </div>

        <p class="text-sm text-muted">
            <span class="font-medium text-highlighted">{{ ETIQUETAS_TIPO_CONEXION[tipo] }}:</span>
            {{ resumenEstrategia(efectiva) }}
        </p>

        <UFormField
            label="1 · Cómo se limita a cada cliente"
            :error="erroresDe('aplicacion')"
        >
            <URadioGroup
                :model-value="valorCapa('aplicacion')"
                :items="itemsAplicacion"
                variant="card"
                class="w-full"
                :ui="{ fieldset: 'grid gap-2' }"
                data-prueba="capa-aplicacion"
                @update:model-value="valor => fijar('aplicacion', valor as Aplicacion)"
            />
        </UFormField>

        <UFormField
            label="2 · Cómo se agrupan (padre)"
            :error="erroresDe('padre')"
        >
            <URadioGroup
                :model-value="valorCapa('padre')"
                :items="itemsPadre"
                variant="card"
                class="w-full"
                :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                data-prueba="capa-padre"
                @update:model-value="valor => fijar('padre', valor as Padre)"
            />
        </UFormField>

        <UFormField
            label="3 · Tipo de cola"
            :error="erroresDe('tipo_cola')"
            :help="version ? `RouterOS ${version}` : 'Versión de RouterOS desconocida: «Probar conexión» la lee.'"
        >
            <URadioGroup
                :model-value="valorCapa('tipo_cola')"
                :items="itemsTipoCola"
                variant="card"
                class="w-full"
                :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                data-prueba="capa-tipo-cola"
                @update:model-value="valor => fijar('tipo_cola', valor as TipoCola)"
            />
        </UFormField>

        <fieldset class="flex flex-col gap-3">
            <legend class="mb-2 text-sm font-medium text-default">
                4 · Extras
            </legend>
            <div
                v-for="extra in EXTRAS"
                :key="extra"
                class="flex flex-col gap-1"
                :data-extra="extra"
            >
                <USwitch
                    :model-value="valorExtra(extra)"
                    :label="OPCIONES_EXTRA[extra].etiqueta"
                    :description="`${OPCIONES_EXTRA[extra].explicacion}${extraHeredado(extra) ? ' (heredado del router)' : ''}`"
                    @update:model-value="valor => fijarExtra(extra, valor)"
                />
                <UButton
                    v-if="modoPlan && !extraHeredado(extra)"
                    label="Volver a heredar"
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="self-start"
                    @click="fijarExtra(extra, 'heredar')"
                />
            </div>
        </fieldset>
    </div>
</template>
