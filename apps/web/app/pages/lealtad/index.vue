<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Lealtad (tablero OperLealtad): contadores arriba; en la tarjeta, las pestañas Programa y premios,
 * Canjes y Referidos con el interruptor del programa a la derecha. Aquí: cómo se ganan puntos (cada
 * regla con su interruptor, `PUT /lealtad/reglas/:id` con `activa`), los premios, el vencimiento y
 * los datos del programa. Crear, editar, activar y desactivar con motivo (`lealtad.configurar`).
 */
definePageMeta({ permiso: 'lealtad.ver' })

useHead({ title: 'Lealtad · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const programa = shallowRef<ProgramaLealtad | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const problemaActivar = ref<Problem | null>(null)
const activando = ref(false)

const editandoPrograma = ref(false)
const desactivando = ref(false)

const reglas = usePaginacionCursor(cursor => (programa.value ? useReglasLealtad().listar({ programa_id: programa.value.id }, cursor) : Promise.resolve({ ok: true as const, data: { data: [], nextCursor: null } })))
const reglaEditada = shallowRef<ReglaLealtad | null>(null)
const reglaAbierta = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useProgramasLealtad().actual()
    cargando.value = false
    programa.value = resultado.ok ? resultado.data.programa : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok && resultado.data.programa) {
        void reglas.recargar()
    }
}

async function activar() {
    if (!programa.value) {
        return
    }
    activando.value = true
    problemaActivar.value = null
    const resultado = await useProgramasLealtad().activar(programa.value.id, nuevaClaveIdempotencia())
    activando.value = false
    if (!resultado.ok) {
        problemaActivar.value = resultado.problema
        return
    }
    programa.value = resultado.data
    toast.add({ title: 'Programa activado', description: `${resultado.data.nombre}: los clientes empiezan a ganar puntos desde hoy.`, icon: 'i-lucide-circle-check', color: 'success' })
}

function desactivar(motivo: string, clave: string) {
    if (!programa.value) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin programa', status: 0 } })
    }
    return useProgramasLealtad().desactivar(programa.value.id, motivo, clave)
}

function alDesactivar(actual: ProgramaLealtad) {
    programa.value = actual
    toast.add({ title: 'Programa desactivado', description: 'Los puntos ganados se conservan; no se otorgan nuevos.', icon: 'i-lucide-circle-pause', color: 'neutral' })
}

function alGuardarPrograma(actual: ProgramaLealtad) {
    const nuevo = programa.value === null
    programa.value = actual
    toast.add({ title: nuevo ? 'Programa creado' : 'Programa actualizado', description: nuevo ? 'Queda inactivo hasta que lo actives.' : actual.nombre, icon: 'i-lucide-circle-check', color: 'success' })
    void reglas.recargar()
}

function abrirRegla(regla: ReglaLealtad | null) {
    reglaEditada.value = regla
    reglaAbierta.value = true
}

function alGuardarRegla(regla: ReglaLealtad) {
    toast.add({ title: reglaEditada.value ? 'Regla actualizada' : 'Regla creada', description: `${TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta} · ${formatearPuntos(regla.puntos)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void reglas.recargar()
}

/* Premios del programa (los primeros, para la tarjeta; todos en /lealtad/premios). */
const premios = shallowRef<PremioLealtad[] | null>(null)
const problemaPremios = ref<Problem | null>(null)

async function cargarPremios() {
    premios.value = null
    problemaPremios.value = null
    const resultado = await usePremiosLealtad().listar({ activo: true, limit: 6 })
    premios.value = resultado.ok ? resultado.data.data : null
    problemaPremios.value = resultado.ok ? null : resultado.problema
}

/*
 * Contadores: puntos vivos y canjeados del mes (reporte de lealtad, `reportes.ver`) y referidos
 * que calificaron (hasta 200). Sin poder leer: «No se pudo leer» con Reintentar.
 */
const reporte = shallowRef<{ vivos: number, canjeados: number } | null>(null)
const problemaReporte = ref<Problem | null>(null)
const calificados = ref<string | null>(null)
const problemaReferidos = ref<Problem | null>(null)

async function cargarContadores() {
    const hoy = hoyGuatemala()
    if (puede('reportes.ver')) {
        reporte.value = null
        problemaReporte.value = null
        const resultado = await usePuntosLealtad().reporte(`${hoy.slice(0, 8)}01`, hoy)
        if (resultado.ok) {
            const empresas = resultado.data.empresas
            reporte.value = { vivos: empresas.reduce((suma, e) => suma + e.puntos_vivos, 0), canjeados: empresas.reduce((suma, e) => suma + e.canjeados, 0) }
        }
        else {
            problemaReporte.value = resultado.problema
        }
    }
    calificados.value = null
    problemaReferidos.value = null
    const referidos = await useReferidos().listar({ estado: 'calificado', limit: 200 })
    if (referidos.ok) {
        calificados.value = referidos.data.nextCursor ? '200+' : String(referidos.data.data.length)
    }
    else {
        problemaReferidos.value = referidos.problema
    }
}

/* Interruptor de cada regla: `activa` con la `version` leída. */
const cambiandoRegla = ref<number | null>(null)

async function alternarRegla(regla: ReglaLealtad, activa: boolean) {
    cambiandoRegla.value = regla.id
    const resultado = await useReglasLealtad().editar(regla.id, { version: regla.version, activa })
    cambiandoRegla.value = null
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo cambiar la regla', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    reglas.filas.value = reglas.filas.value.map(r => (r.id === regla.id ? resultado.data : r))
    toast.add({ title: activa ? 'Regla encendida' : 'Regla apagada', description: TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta, icon: 'i-lucide-circle-check', color: 'success' })
}

/* Interruptor del programa: activar directo; desactivar pide motivo. */
function alternarPrograma(valor: boolean) {
    if (valor) {
        void activar()
        return
    }
    desactivando.value = true
}

onMounted(() => {
    void cargar()
    void cargarPremios()
    void cargarContadores()
})
</script>

<template>
    <PanelPagina
        id="lealtad"
        titulo="Lealtad"
        icono="i-lucide-gem"
        descripcion="Puntos por pagar a tiempo, por antigüedad y por referir; se canjean por premios"
    >
        <template #acciones>
            <UButton
                v-if="puede('sorteos.ver')"
                to="/lealtad/sorteos"
                label="Sorteos"
                icon="i-lucide-trophy"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
            />
            <UButton
                v-if="puede('lealtad.canjear')"
                to="/lealtad/canjes?nuevo=1"
                label="Canjear puntos"
                icon="i-lucide-gift"
                size="lg"
                class="glow-brand px-5"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div
                class="grid grid-cols-2 gap-3 xl:grid-cols-3"
                data-prueba="contadores-lealtad"
            >
                <TarjetaDato
                    v-if="puede('reportes.ver')"
                    etiqueta="Puntos en circulación"
                    icono="i-lucide-star"
                    :valor="reporte ? formatearPuntos(reporte.vivos) : null"
                    :problema="problemaReporte"
                    @reintentar="cargarContadores"
                />
                <TarjetaDato
                    v-if="puede('reportes.ver')"
                    etiqueta="Canjeados este mes"
                    icono="i-lucide-gift"
                    tono="tono-exito"
                    :valor="reporte ? formatearPuntos(reporte.canjeados) : null"
                    :problema="problemaReporte"
                    @reintentar="cargarContadores"
                />
                <TarjetaDato
                    etiqueta="Referidos que calificaron"
                    icono="i-lucide-users"
                    tono="tono-2"
                    :valor="calificados"
                    :problema="problemaReferidos"
                    @reintentar="cargarContadores"
                />
            </div>

            <section class="surface-card flex min-w-0 flex-col overflow-hidden rounded-[1.375rem]">
                <LealtadPestanas actual="programa">
                    <template
                        v-if="programa && puede('lealtad.configurar')"
                        #derecha
                    >
                        <USwitch
                            :model-value="programa.activo"
                            :label="`Programa «${programa.nombre}»`"
                            :loading="activando"
                            size="lg"
                            :ui="{ root: 'flex-row-reverse gap-3', label: 'text-sm font-normal text-muted' }"
                            :data-prueba="programa.activo ? 'desactivar-programa' : 'activar-programa'"
                            @update:model-value="alternarPrograma($event === true)"
                        />
                    </template>
                </LealtadPestanas>

                <div class="flex flex-col gap-4 p-3 sm:p-4">
                    <USkeleton
                        v-if="cargando && !programa"
                        class="h-40 w-full"
                    />
                    <ProblemaAlerta
                        v-else-if="problema"
                        :problema="problema"
                        :reintentar="cargar"
                        :reintentando="cargando"
                        data-prueba="programa-error-carga"
                    />
                    <UEmpty
                        v-else-if="!programa"
                        icon="i-lucide-gem"
                        title="Esta empresa no tiene programa de lealtad"
                        description="Los clientes ganan puntos por pagar a tiempo, su antigüedad, referir clientes o pagar por adelantado."
                        :actions="puede('lealtad.configurar') ? [{ label: 'Crear programa', icon: 'i-lucide-plus', onClick: () => { editandoPrograma = true } }] : []"
                        data-prueba="sin-programa"
                    />
                    <template v-else>
                        <ProblemaAlerta
                            v-if="problemaActivar"
                            :problema="problemaActivar"
                            data-prueba="activar-error"
                        />
                        <div class="grid gap-4 lg:grid-cols-2">
                            <!-- Cómo se ganan puntos. -->
                            <section
                                class="flex flex-col rounded-2xl border border-(--ax-borde) p-4"
                                data-prueba="tabla-reglas-lealtad"
                            >
                                <header class="flex items-center justify-between gap-2 border-b border-(--ax-borde) pb-2">
                                    <h2 class="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                                        <UIcon
                                            name="i-lucide-star"
                                            class="size-4"
                                        />
                                        Cómo se ganan puntos
                                    </h2>
                                    <UButton
                                        v-if="puede('lealtad.configurar')"
                                        label="Nueva regla"
                                        color="primary"
                                        variant="link"
                                        size="sm"
                                        data-prueba="nueva-regla"
                                        @click="abrirRegla(null)"
                                    />
                                </header>
                                <ProblemaAlerta
                                    v-if="reglas.problema.value"
                                    :problema="reglas.problema.value"
                                    :reintentar="reglas.recargar"
                                    :reintentando="reglas.cargando.value"
                                    class="mt-2"
                                />
                                <USkeleton
                                    v-else-if="reglas.cargando.value && !reglas.filas.value.length"
                                    class="mt-2 h-24"
                                />
                                <p
                                    v-else-if="!reglas.filas.value.length"
                                    class="py-3 text-sm text-muted"
                                >
                                    Sin reglas: nadie gana puntos aunque el programa esté activo.
                                </p>
                                <ul
                                    v-else
                                    class="flex flex-col divide-y divide-(--ax-borde)"
                                >
                                    <li
                                        v-for="regla in reglas.filas.value"
                                        :key="regla.id"
                                        class="flex items-center gap-3 py-2.5"
                                    >
                                        <span class="pastilla-icono pastilla-tono tono-marca size-9 shrink-0 rounded-xl">
                                            <UIcon
                                                :name="TIPOS_REGLA_LEALTAD[regla.tipo].icono"
                                                class="size-4"
                                            />
                                        </span>
                                        <ULink
                                            v-if="puede('lealtad.configurar')"
                                            class="flex min-w-0 flex-1 flex-col text-start"
                                            :aria-label="`Editar la regla ${TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta}`"
                                            @click="abrirRegla(regla)"
                                        >
                                            <span class="font-semibold text-highlighted">{{ TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta }}</span>
                                            <span class="text-[0.8125rem] text-muted">{{ formatearPuntos(regla.puntos) }} · {{ resumenCondiciones(regla) }}</span>
                                        </ULink>
                                        <div
                                            v-else
                                            class="flex min-w-0 flex-1 flex-col"
                                        >
                                            <span class="font-semibold text-highlighted">{{ TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta }}</span>
                                            <span class="text-[0.8125rem] text-muted">{{ formatearPuntos(regla.puntos) }} · {{ resumenCondiciones(regla) }}</span>
                                        </div>
                                        <USwitch
                                            :model-value="regla.activa"
                                            :disabled="!puede('lealtad.configurar') || cambiandoRegla === regla.id"
                                            :loading="cambiandoRegla === regla.id"
                                            size="lg"
                                            :aria-label="`${regla.activa ? 'Apagar' : 'Encender'} la regla ${TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta}`"
                                            @update:model-value="alternarRegla(regla, $event === true)"
                                        />
                                    </li>
                                </ul>
                            </section>

                            <!-- Premios. -->
                            <section class="flex flex-col rounded-2xl border border-(--ax-borde) p-4">
                                <header class="flex items-center justify-between gap-2 border-b border-(--ax-borde) pb-2">
                                    <h2 class="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                                        <UIcon
                                            name="i-lucide-gift"
                                            class="size-4"
                                        />
                                        Premios
                                    </h2>
                                    <UButton
                                        to="/lealtad/premios"
                                        :label="puede('lealtad.configurar') ? 'Nuevo premio' : 'Ver todos'"
                                        color="primary"
                                        variant="link"
                                        size="sm"
                                    />
                                </header>
                                <ProblemaAlerta
                                    v-if="problemaPremios"
                                    :problema="problemaPremios"
                                    :reintentar="cargarPremios"
                                    class="mt-2"
                                />
                                <USkeleton
                                    v-else-if="premios === null"
                                    class="mt-2 h-24"
                                />
                                <p
                                    v-else-if="!premios.length"
                                    class="py-3 text-sm text-muted"
                                >
                                    Todavía no hay premios activos.
                                </p>
                                <ul
                                    v-else
                                    class="flex flex-col divide-y divide-(--ax-borde)"
                                >
                                    <li
                                        v-for="premio in premios"
                                        :key="premio.id"
                                        class="flex items-center gap-3 py-2.5"
                                    >
                                        <span class="pastilla-icono pastilla-tono tono-2 size-9 shrink-0 rounded-xl">
                                            <UIcon
                                                :name="TIPOS_PREMIO[premio.tipo].icono"
                                                class="size-4"
                                            />
                                        </span>
                                        <span class="min-w-0 flex-1 truncate font-semibold text-highlighted">{{ premio.nombre }}</span>
                                        <span class="font-semibold tabular-nums text-highlighted">{{ formatearPuntos(premio.costo_puntos) }}</span>
                                    </li>
                                </ul>
                            </section>

                            <!-- Vencimiento y datos del programa. -->
                            <section
                                class="flex flex-col rounded-2xl border border-(--ax-borde) p-4"
                                data-prueba="programa"
                            >
                                <header class="flex items-center justify-between gap-2 border-b border-(--ax-borde) pb-2">
                                    <h2 class="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                                        <UIcon
                                            name="i-lucide-clock"
                                            class="size-4"
                                        />
                                        Vencimiento y programa
                                    </h2>
                                    <UButton
                                        v-if="puede('lealtad.configurar')"
                                        label="Editar"
                                        :icon="ICONOS.editar"
                                        color="primary"
                                        variant="link"
                                        size="sm"
                                        @click="editandoPrograma = true"
                                    />
                                </header>
                                <dl class="flex flex-col divide-y divide-(--ax-borde) text-sm">
                                    <div class="flex justify-between gap-3 py-2">
                                        <dt class="text-muted">
                                            Los puntos vencen
                                        </dt>
                                        <dd class="text-end text-highlighted">
                                            <template v-if="programa.vencimiento_meses">
                                                <strong>{{ programa.vencimiento_meses }} meses</strong> después de ganarlos
                                            </template>
                                            <template v-else>
                                                No vencen
                                            </template>
                                        </dd>
                                    </div>
                                    <div
                                        v-if="programa.vencimiento_meses"
                                        class="flex justify-between gap-3 py-2"
                                    >
                                        <dt class="text-muted">
                                            Aviso antes de vencer
                                        </dt>
                                        <dd class="text-end text-highlighted">
                                            {{ programa.aviso_vencimiento_dias }} días
                                        </dd>
                                    </div>
                                    <div class="flex justify-between gap-3 py-2">
                                        <dt class="text-muted">
                                            Valor del punto
                                        </dt>
                                        <dd class="text-end text-highlighted">
                                            {{ formatearQuetzales(programa.valor_punto) }}
                                        </dd>
                                    </div>
                                    <div class="flex justify-between gap-3 py-2">
                                        <dt class="text-muted">
                                            Mínimo para canjear
                                        </dt>
                                        <dd class="text-end text-highlighted">
                                            {{ formatearPuntos(programa.minimo_canje) }}
                                        </dd>
                                    </div>
                                    <div class="flex justify-between gap-3 py-2">
                                        <dt class="text-muted">
                                            Portal del cliente
                                        </dt>
                                        <dd class="text-end text-highlighted">
                                            {{ programa.canje_portal ? 'Ve sus puntos y canjea' : programa.visible_portal ? 'Ve sus puntos (sin canjear)' : 'Oculto' }}
                                        </dd>
                                    </div>
                                    <div class="flex justify-between gap-3 py-2">
                                        <dt class="text-muted">
                                            Diferimiento (NIIF 15)
                                        </dt>
                                        <dd
                                            class="text-end text-highlighted"
                                            data-prueba="estado-programa"
                                        >
                                            {{ programa.diferimiento ? `Sí · pasivo Q ${programa.valor_pasivo_punto} por punto` : 'No: solo indicador' }}
                                            · {{ programa.activo ? 'Activo' : 'Inactivo' }}
                                        </dd>
                                    </div>
                                    <div class="flex justify-between gap-3 py-2">
                                        <dt class="text-muted">
                                            Vigencia
                                        </dt>
                                        <dd class="text-end text-highlighted">
                                            Desde {{ formatearFecha(programa.vigente_desde) }}{{ programa.vigente_hasta ? ` hasta ${formatearFecha(programa.vigente_hasta)}` : '' }}
                                        </dd>
                                    </div>
                                </dl>
                            </section>

                            <div class="flex flex-col gap-3">
                                <UAlert
                                    color="primary"
                                    variant="subtle"
                                    icon="i-lucide-info"
                                    description="Si una factura se anula o un pago se revierte, sus puntos se revierten solos. El cliente ve sus puntos en el portal."
                                />
                                <p
                                    v-if="programa.terminos"
                                    class="text-xs whitespace-pre-line text-muted"
                                >
                                    {{ programa.terminos }}
                                </p>
                            </div>
                        </div>
                    </template>
                </div>
            </section>
        </div>

        <ProgramaLealtadModal
            v-if="puede('lealtad.configurar')"
            v-model:open="editandoPrograma"
            :programa="programa"
            @hecho="alGuardarPrograma"
        />
        <ReglaLealtadModal
            v-if="programa && puede('lealtad.configurar')"
            v-model:open="reglaAbierta"
            :programa="programa"
            :regla="reglaEditada"
            @hecho="alGuardarRegla"
        />
        <AccionMotivoModal
            v-model:open="desactivando"
            titulo="Desactivar programa"
            :descripcion="programa?.nombre"
            efecto="Los clientes dejan de ganar puntos desde hoy. Los puntos ganados se conservan y los reversos siguen aplicándose."
            confirmar="Desactivar"
            icono="i-lucide-circle-pause"
            placeholder="Ej.: se rediseña el programa para el próximo año"
            :ejecutar="desactivar"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
