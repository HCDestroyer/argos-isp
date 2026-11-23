<script setup lang="ts">
import type { RadioGroupItem, TabsItem } from '@nuxt/ui'
import type { Aplicacion, Estrategia, EstrategiaParcial, EstrategiasPlan, EstrategiasRouter, Extra, MatrizControlVelocidad, Padre, TipoCola, TipoConexionVelocidad } from '~/types/controlVelocidad'
import type { Disponibilidad } from '~/utils/estrategiaVelocidad'

/**
 * Editor por capas de la estrategia de velocidad (`contratos/control-velocidad.md` §1–§3): una
 * pestaña por tipo de conexión con las cuatro capas (aplicación por cliente, padre, tipo de cola y
 * extras). Las opciones que la matriz no admite para ese tipo o esa versión de RouterOS se ven
 * deshabilitadas con el porqué. Cada opción dice en lenguaje simple qué hace y para qué escenario.
 *
 * - Modo router (`router`): edita las tres estrategias completas; «Igual para todos» copia una a las
 *   demás ajustada a lo que admite cada tipo.
 * - Modo plan (`plan`): edita la excepción del plan en el router; cada capa tiene «Heredar del router».
 *
 * Router sin RADIUS (`sinRadius`, `contratos/pppoe-local.md` §5): en la pestaña PPPoE se muestra el
 * porqué con el mensaje de la regla `pppoe_sin_radius` de la matriz (el panel no copia la regla); si
 * se elige algo que no admite, el 422 de la vista previa sale junto a la capa.
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
    /** El router no usa RADIUS (`modo_seguridad = 'api'`): PPPoE va con secrets locales. */
    sinRadius?: boolean
    /**
     * Solo el tipo de conexión del router (es uno por router): sin pestañas de tipo ni «Igual para
     * todos» (ficha del router, pestaña Velocidad del rediseño).
     */
    tipoFijo?: TipoConexionVelocidad
    /** Qué se muestra: las capas 1 a 3, los extras o todo (la ficha pone los extras en su columna). */
    partes?: 'todo' | 'capas' | 'extras'
}>(), {
    errores: () => ({}),
    sinRadius: false,
    tipos: () => [...TIPOS_CONEXION_VELOCIDAD],
    tipoFijo: undefined,
    partes: 'todo',
})

/** Modo router: las tres estrategias completas. */
const estrategias = defineModel<EstrategiasRouter>('estrategias')
/** Modo plan: la excepción parcial (null = hereda todo). */
const excepcion = defineModel<EstrategiasPlan | null>('excepcion')

const modoPlan = computed(() => estrategias.value === undefined)
const HEREDAR = 'heredar'

const tipo = ref<TipoConexionVelocidad>(props.tipoFijo ?? props.tipos[0] ?? 'pppoe')
watch(() => props.tipoFijo, (valor) => {
    if (valor) {
        tipo.value = valor
    }
})
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

/** El porqué de la regla `pppoe_sin_radius`, tal como la publica la matriz. */
const reglaSinRadius = computed(() => (props.sinRadius && tipo.value === 'pppoe'
    ? props.matriz.reglas.find(r => r.rule === 'pppoe_sin_radius')?.mensaje ?? null
    : null))

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

/*
 * Control de velocidad: 3 a la vista y «Ver las otras» (decisión del PM, tablero RedRouterFicha):
 * Árbol con PCQ, RADIUS y Cola simple; Perfil PPP y PCQ por plan quedan plegadas salvo que una
 * de ellas sea la elegida.
 */
const VISIBLES: readonly Aplicacion[] = ['arbol_pcq', 'radius_rate_limit', 'cola_simple']
const verOtras = ref(false)
const otrasCuantas = APLICACIONES.length - VISIBLES.length
const elegidaOculta = computed(() => !VISIBLES.includes(efectiva.value.aplicacion) && !(modoPlan.value && valorCapa('aplicacion') === HEREDAR))
const aplicacionesVistas = computed(() => (verOtras.value || elegidaOculta.value ? APLICACIONES : VISIBLES))

const itemsAplicacion = computed<RadioGroupItem[]>(() => [
    ...heredado('aplicacion', OPCIONES_APLICACION),
    ...aplicacionesVistas.value.map((valor) => {
        const disponible = aplicacionDisponible(props.matriz, valor, tipo.value)
        return {
            label: OPCIONES_APLICACION[valor].etiqueta,
            value: valor,
            description: disponible.valida
                ? OPCIONES_APLICACION[valor].explicacion
                : `No disponible: ${disponible.motivo}`,
            disabled: !disponible.valida,
        }
    }),
])

/* Capas 2 y 3 como fichas (tablero RedRouterFicha): cada tipo de cola con su «?» que explica cómo funciona. */
const opcionesPadre = computed(() => [
    ...(modoPlan.value ? [{ valor: HEREDAR, etiqueta: `Heredar (${OPCIONES_PADRE[props.router[tipo.value].padre].etiqueta})`, explicacion: 'Si cambias el router, este plan sigue el cambio.' }] : []),
    ...PADRES.map(valor => ({ valor, etiqueta: OPCIONES_PADRE[valor].etiqueta, explicacion: OPCIONES_PADRE[valor].explicacion })),
])
const padreElegido = computed(() => opcionesPadre.value.find(o => o.valor === valorCapa('padre')))

const opcionesCola = computed(() => [
    ...(modoPlan.value ? [{ valor: HEREDAR, etiqueta: `Heredar (${OPCIONES_TIPO_COLA[props.router[tipo.value].tipo_cola].etiqueta})`, explicacion: 'Si cambias el router, este plan sigue el cambio.', valida: true, motivo: null as string | null }] : []),
    ...TIPOS_COLA.map((valor) => {
        const disponible = tipoColaDisponible(props.matriz, valor, efectiva.value.aplicacion, props.version)
        return { valor, etiqueta: OPCIONES_TIPO_COLA[valor].etiqueta, explicacion: OPCIONES_TIPO_COLA[valor].explicacion, valida: disponible.valida, motivo: disponible.motivo }
    }),
])
/** La cola que explica la tarjeta de abajo: la del «?» tocado o la elegida. */
const colaVista = ref<string | null>(null)
const colaExplicada = computed(() => opcionesCola.value.find(o => o.valor === (colaVista.value ?? valorCapa('tipo_cola'))) ?? opcionesCola.value[0])
watch(tipo, () => {
    colaVista.value = null
})

function valorExtra(extra: Extra): boolean {
    return efectiva.value.extras[extra]
}

/** Extras que publica la matriz (`matriz.extras`), en el orden del panel. */
const extrasVisibles = computed(() => EXTRAS.filter(extra => props.matriz.extras.some(e => e.valor === extra)))

/**
 * Si el extra se puede prender aquí (hoy solo `qos`: árbol y FastTrack verificado). Uno ya prendido
 * no se deshabilita: se puede apagar aunque ya no combine (el error de la API sale debajo).
 */
function disponibilidadExtra(extra: Extra): Disponibilidad {
    return extraDisponible(props.matriz, extra, efectiva.value)
}

function extraDeshabilitado(extra: Extra): boolean {
    return !valorExtra(extra) && !disponibilidadExtra(extra).valida
}

function descripcionExtra(extra: Extra): string {
    const disponible = disponibilidadExtra(extra)
    return [
        OPCIONES_EXTRA[extra].explicacion,
        extraHeredado(extra) ? '(heredado del router)' : null,
        disponible.valida ? null : `No disponible: ${disponible.motivo}`,
    ].filter(Boolean).join(' ')
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
        <div
            v-if="!tipoFijo && partes !== 'extras'"
            class="flex flex-wrap items-center justify-between gap-2"
        >
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

        <p
            v-if="partes !== 'extras'"
            class="text-sm text-muted"
        >
            <span class="font-medium text-highlighted">{{ ETIQUETAS_TIPO_CONEXION[tipo] }}:</span>
            {{ resumenEstrategia(efectiva) }}
        </p>

        <UAlert
            v-if="reglaSinRadius && partes !== 'extras'"
            color="info"
            variant="subtle"
            icon="i-lucide-plug"
            title="Router sin RADIUS: PPPoE va con secrets locales"
            :description="`${reglaSinRadius.charAt(0).toUpperCase()}${reglaSinRadius.slice(1)}. Una estrategia guardada que no lo admite se aplica con el perfil PPP del plan hasta que la cambies.`"
            data-prueba="estrategia-sin-radius"
        />

        <template v-if="partes !== 'extras'">
            <UFormField
                :error="erroresDe('aplicacion')"
                :ui="{ label: 'flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted' }"
            >
                <template #label>
                    <UIcon
                        name="i-lucide-gauge"
                        class="size-4"
                    />
                    1 · Cómo se limita a cada cliente
                </template>
                <URadioGroup
                    :model-value="valorCapa('aplicacion')"
                    :items="itemsAplicacion"
                    variant="card"
                    class="w-full"
                    :ui="{ fieldset: 'grid gap-2 sm:grid-cols-3', item: 'rounded-xl', label: 'font-semibold' }"
                    data-prueba="capa-aplicacion"
                    @update:model-value="valor => fijar('aplicacion', valor as Aplicacion)"
                >
                    <template #label="{ item }">
                        <span class="flex flex-wrap items-center gap-1.5">
                            {{ (item as RadioGroupItem & { label: string }).label }}
                            <UBadge
                                v-if="(item as RadioGroupItem & { value: string }).value === 'arbol_pcq'"
                                label="Recomendado"
                                color="success"
                                variant="soft"
                                size="sm"
                            />
                        </span>
                    </template>
                </URadioGroup>
                <UButton
                    v-if="!elegidaOculta"
                    :label="verOtras ? 'Ocultar las otras' : `Ver las otras (${otrasCuantas})`"
                    :trailing-icon="verOtras ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    variant="link"
                    size="sm"
                    class="mt-1 px-0"
                    data-prueba="ver-otras-aplicaciones"
                    @click="verOtras = !verOtras"
                />
            </UFormField>

            <UFormField
                :error="erroresDe('padre')"
                :ui="{ label: 'flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted' }"
            >
                <template #label>
                    <UIcon
                        name="i-lucide-layers"
                        class="size-4"
                    />
                    2 · Cómo se reparte cuando se llena
                </template>
                <div
                    role="radiogroup"
                    aria-label="Cómo se reparte cuando se llena"
                    class="flex flex-wrap gap-2"
                    data-prueba="capa-padre"
                >
                    <UButton
                        v-for="opcion in opcionesPadre"
                        :key="opcion.valor"
                        role="radio"
                        :aria-checked="valorCapa('padre') === opcion.valor"
                        :value="opcion.valor"
                        :label="opcion.etiqueta"
                        :color="valorCapa('padre') === opcion.valor ? 'primary' : 'neutral'"
                        :variant="valorCapa('padre') === opcion.valor ? 'soft' : 'outline'"
                        size="sm"
                        class="rounded-full"
                        :class="valorCapa('padre') === opcion.valor ? 'ring-1 ring-primary' : ''"
                        @click="fijar('padre', opcion.valor as Padre)"
                    />
                </div>
                <p
                    v-if="padreElegido"
                    class="mt-2 text-sm text-muted"
                >
                    <span class="font-medium text-default">{{ padreElegido.etiqueta }}:</span> {{ padreElegido.explicacion }}
                </p>
            </UFormField>

            <UFormField
                :error="erroresDe('tipo_cola')"
                :help="version ? `RouterOS ${version}. Toca el «?» de cada una para ver cómo funciona; las tachadas no aplican con el modo elegido.` : 'Versión de RouterOS desconocida: «Probar conexión» la lee.'"
                :ui="{ label: 'flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted' }"
            >
                <template #label>
                    <UIcon
                        name="i-lucide-list"
                        class="size-4"
                    />
                    3 · Tipo de cola
                </template>
                <div
                    role="radiogroup"
                    aria-label="Tipo de cola"
                    class="flex flex-wrap gap-2"
                    data-prueba="capa-tipo-cola"
                >
                    <span
                        v-for="opcion in opcionesCola"
                        :key="opcion.valor"
                        class="inline-flex items-center rounded-full ring-1"
                        :class="valorCapa('tipo_cola') === opcion.valor ? 'bg-primary/10 ring-primary' : 'ring-(--ax-borde)'"
                    >
                        <UButton
                            role="radio"
                            :aria-checked="valorCapa('tipo_cola') === opcion.valor"
                            :value="opcion.valor"
                            :title="opcion.valida ? undefined : `No disponible: ${opcion.motivo}`"
                            :label="opcion.etiqueta"
                            :disabled="!opcion.valida"
                            color="neutral"
                            variant="link"
                            size="sm"
                            class="rounded-full ps-3 pe-1"
                            :class="[valorCapa('tipo_cola') === opcion.valor ? 'font-semibold text-primary' : 'text-default', opcion.valida ? '' : 'line-through']"
                            @click="fijar('tipo_cola', opcion.valor as TipoCola)"
                        />
                        <UButton
                            icon="i-lucide-circle-help"
                            color="neutral"
                            variant="link"
                            size="xs"
                            class="rounded-full pe-2"
                            :aria-label="`Cómo funciona ${opcion.etiqueta}`"
                            :aria-pressed="colaExplicada?.valor === opcion.valor"
                            data-ayuda
                            @click="colaVista = opcion.valor"
                        />
                    </span>
                </div>
                <div
                    v-if="colaExplicada"
                    class="mt-3 flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"
                    data-prueba="explicacion-cola"
                    aria-live="polite"
                >
                    <span class="flex flex-wrap items-center gap-2">
                        <span class="font-semibold text-highlighted">{{ colaExplicada.etiqueta }}</span>
                        <UBadge
                            :label="valorCapa('tipo_cola') === colaExplicada.valor ? 'En uso' : (colaExplicada.valida ? 'Disponible' : 'No disponible aquí')"
                            :color="valorCapa('tipo_cola') === colaExplicada.valor ? 'success' : (colaExplicada.valida ? 'neutral' : 'warning')"
                            variant="soft"
                            size="sm"
                        />
                    </span>
                    <span class="text-default">{{ colaExplicada.explicacion }}</span>
                    <span
                        v-if="colaExplicada.motivo"
                        class="text-muted"
                    ><span class="font-medium">{{ colaExplicada.valida ? 'Ojo:' : 'Por qué no:' }}</span> {{ colaExplicada.motivo }}</span>
                </div>
            </UFormField>
        </template>

        <fieldset
            v-if="partes !== 'capas'"
            class="flex flex-col"
        >
            <legend class="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                <UIcon
                    name="i-lucide-zap"
                    class="size-4"
                />
                4 · Extras
            </legend>
            <div
                v-for="extra in extrasVisibles"
                :key="extra"
                class="flex flex-col gap-1 border-t border-(--ax-borde) py-2.5 first-of-type:border-t-0"
                :data-extra="extra"
            >
                <USwitch
                    :model-value="valorExtra(extra)"
                    :label="OPCIONES_EXTRA[extra].etiqueta"
                    :description="descripcionExtra(extra)"
                    :disabled="extraDeshabilitado(extra)"
                    size="lg"
                    :data-prueba="`extra-${extra}`"
                    @update:model-value="valor => fijarExtra(extra, valor)"
                />
                <p
                    v-if="erroresDe(`extras.${extra}`)"
                    class="text-sm text-error"
                    :data-prueba="`error-extra-${extra}`"
                >
                    {{ erroresDe(`extras.${extra}`) }}
                </p>
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
