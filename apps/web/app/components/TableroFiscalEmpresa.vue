<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Sección de una empresa en el tablero fiscal: sus alertas destacadas y una tarjeta por bloque. Las
 * cifras son las de la API (las mismas del borrador y del libro); un bloque en error o que no aplica
 * no muestra ninguna. Nunca suma entre empresas.
 */
type Empresa = Schema<'TableroFiscal'>['empresas'][number]
type Vencimiento = NonNullable<Schema<'BloqueVencimientos'>['datos']>['obligaciones'][number]

const props = withDefaults(defineProps<{
    empresa: Empresa
    nombre: string
    reintentar: () => void
    reintentando?: boolean
}>(), {
    reintentando: false,
})

const { puede } = usePermisos()

const bloques = computed(() => props.empresa.bloques)
const alertas = computed(() => alertasTablero(props.empresa))

function periodoVencimiento(o: Vencimiento): string {
    const periodicidad = esImpuestoDeclarable(o.impuesto) ? IMPUESTOS_DECLARABLES[o.impuesto].periodicidad : 'mensual'
    return periodoObligacion({ periodicidad, periodo_desde: o.periodo_desde })
}

const pc = computed(() => bloques.value.pequeno_contribuyente.datos)
const avancePc = computed(() => Math.min(100, Number(pc.value?.porcentaje ?? 0)))
const colorPc = computed(() => {
    if (!pc.value) {
        return 'neutral' as const
    }
    if (pc.value.supera_limite) {
        return 'error' as const
    }
    return pc.value.umbral_alcanzado ? 'warning' as const : 'success' as const
})

const ESTADOS_PENDIENTES: Record<string, string> = {
    pendiente: 'Por certificar',
    enviando: 'Enviando',
    error_temporal: 'Error temporal',
    contingencia: 'En contingencia',
}
</script>

<template>
    <section
        class="flex flex-col gap-4"
        :data-empresa="empresa.empresa_id"
        :aria-label="`Tablero fiscal de ${nombre}`"
    >
        <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-base font-semibold text-highlighted">
                {{ nombre }}
            </h2>
            <UBadge
                :color="empresa.regimen ? 'neutral' : 'warning'"
                variant="subtle"
                icon="i-lucide-scale"
                :label="empresa.regimen ? etiquetaRegimen(empresa.regimen) : 'Régimen sin confirmar'"
                data-prueba="tablero-regimen"
            />
        </div>

        <UAlert
            v-for="alerta in alertas"
            :key="alerta.clave"
            color="error"
            variant="subtle"
            :icon="alerta.icono"
            :title="alerta.titulo"
            :description="alerta.descripcion"
            :data-alerta="alerta.clave"
            :actions="alerta.enlace && puede(alerta.enlace.permiso) ? [{ label: alerta.enlace.etiqueta, to: alerta.enlace.ruta, color: 'error', variant: 'outline', icon: 'i-lucide-arrow-right' }] : undefined"
        />

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <!-- Vencimientos: lo pendiente o en borrador que vence en 30 días o ya venció. -->
            <TableroBloque
                nombre="vencimientos"
                :bloque="bloques.vencimientos"
                :reintentar="reintentar"
                :reintentando="reintentando"
                class="lg:col-span-2"
            >
                <template
                    v-if="bloques.vencimientos.datos && puede('declaraciones.ver')"
                    #insignia
                >
                    <UButton
                        to="/fiscal/calendario"
                        label="Calendario"
                        icon="i-lucide-calendar-check"
                        color="neutral"
                        variant="link"
                        size="sm"
                        data-prueba="tablero-calendario"
                    />
                </template>
                <template v-if="bloques.vencimientos.datos">
                    <p
                        v-if="!bloques.vencimientos.datos.obligaciones.length"
                        class="text-sm text-muted"
                    >
                        Nada vence hasta el {{ formatearFecha(bloques.vencimientos.datos.hasta) }}.
                    </p>
                    <ul
                        v-else
                        class="flex flex-col divide-y divide-default"
                        data-prueba="tablero-vencimientos"
                    >
                        <li
                            v-for="o in bloques.vencimientos.datos.obligaciones"
                            :key="o.obligacion_id"
                            class="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                            :data-obligacion="o.obligacion_id"
                            :data-vencida="o.vencida ? 'si' : 'no'"
                        >
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <ULink
                                    v-if="puede('declaraciones.ver')"
                                    raw
                                    :to="`/fiscal/calendario?obligacion=${o.obligacion_id}`"
                                    class="text-sm font-medium underline underline-offset-2 hover:decoration-2"
                                    :class="o.vencida ? 'text-error' : 'text-highlighted'"
                                >
                                    {{ o.nombre }}, {{ periodoVencimiento(o) }}
                                </ULink>
                                <span
                                    v-else
                                    class="text-sm font-medium"
                                    :class="o.vencida ? 'text-error' : 'text-highlighted'"
                                >
                                    {{ o.nombre }}, {{ periodoVencimiento(o) }}
                                </span>
                                <span class="text-xs text-muted">
                                    Vence el {{ formatearFecha(o.vence_en) }} · {{ o.formulario ?? 'formulario por confirmar' }} · {{ o.estado === 'presentada' ? 'presentada, con impuesto por pagar' : o.estado === 'borrador' ? 'en borrador' : 'sin borrador' }}
                                </span>
                            </div>
                            <div class="flex flex-col gap-0.5 sm:items-end">
                                <UBadge
                                    :color="o.vencida ? 'error' : o.dias_restantes <= 7 ? 'warning' : 'neutral'"
                                    variant="subtle"
                                    :icon="o.vencida ? 'i-lucide-alarm-clock-off' : 'i-lucide-clock'"
                                    :label="textoDiasRestantes(o) ?? ''"
                                    class="self-start sm:self-end"
                                />
                                <span
                                    v-if="o.a_pagar !== null"
                                    class="text-xs tabular-nums text-muted"
                                    data-prueba="vencimiento-pendiente"
                                >
                                    <template v-if="o.pagado !== null && !new Decimal(o.pagado).isZero()">Pagado {{ formatearQuetzales(o.pagado) }} · </template>Pendiente {{ formatearQuetzales(o.a_pagar) }}
                                </span>
                                <span
                                    v-if="o.mora_estimada !== null"
                                    class="text-xs font-medium tabular-nums text-error"
                                    data-prueba="mora-estimada"
                                >
                                    Mora estimada {{ formatearQuetzales(o.mora_estimada) }} · confirmar con contador
                                </span>
                                <span
                                    v-else-if="o.vencida"
                                    class="text-xs text-error"
                                >
                                    Mora: calcule el borrador para estimarla
                                </span>
                                <UButton
                                    v-if="o.declaracion_id !== null && puede('declaraciones.ver')"
                                    :to="`/declaraciones/${o.declaracion_id}`"
                                    label="Ver declaración"
                                    color="neutral"
                                    variant="link"
                                    size="xs"
                                    class="self-start px-0 sm:self-end"
                                />
                            </div>
                        </li>
                    </ul>
                    <p
                        v-if="bloques.vencimientos.datos.mora_tributaria"
                        class="mt-2 text-xs text-muted"
                    >
                        Mora estimada con {{ bloques.vencimientos.datos.mora_tributaria }} % diario sobre lo pendiente (lo declarado menos lo pagado), por cada día de atraso.
                    </p>
                </template>
            </TableroBloque>

            <!-- IVA (o pequeño contribuyente) del mes en curso. -->
            <TableroBloque
                nombre="iva"
                :bloque="bloques.iva"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <TableroEstimado
                    v-if="bloques.iva.datos"
                    :estimado="bloques.iva.datos"
                />
                <p class="mt-2 text-xs text-muted">
                    {{ AVISO_ESTIMADO }}
                </p>
            </TableroBloque>

            <!-- ISR: mensual (opcional simplificado) o trimestral y anual proyectado (utilidades). -->
            <TableroBloque
                nombre="isr"
                :bloque="bloques.isr"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <div
                    v-if="bloques.isr.datos"
                    class="flex flex-col gap-3"
                >
                    <TableroEstimado
                        v-if="bloques.isr.datos.mensual"
                        :estimado="bloques.isr.datos.mensual"
                    />
                    <TableroEstimado
                        v-if="bloques.isr.datos.trimestral"
                        :estimado="bloques.isr.datos.trimestral"
                    />
                    <p
                        v-else-if="bloques.isr.datos.trimestral_con_la_anual"
                        class="text-sm text-muted"
                        data-prueba="isr-con-la-anual"
                    >
                        El 4.º trimestre no se declara aparte: va con la declaración anual.
                    </p>
                    <template v-if="bloques.isr.datos.anual">
                        <TableroEstimado
                            :estimado="bloques.isr.datos.anual"
                            :titulo="`ISR anual a la fecha (${bloques.isr.datos.anual.meses_transcurridos} ${bloques.isr.datos.anual.meses_transcurridos === 1 ? 'mes' : 'meses'})`"
                        />
                        <dl
                            class="grid grid-cols-2 gap-2 rounded-md border border-dashed border-default p-2"
                            data-prueba="isr-proyeccion"
                        >
                            <DatoFicha etiqueta="Renta proyectada al año">
                                <span class="tabular-nums">{{ formatearQuetzales(bloques.isr.datos.anual.renta_proyectada) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="ISR proyectado al año">
                                <span class="tabular-nums">{{ formatearQuetzales(bloques.isr.datos.anual.isr_proyectado) }}</span>
                            </DatoFicha>
                        </dl>
                        <p class="text-xs text-muted">
                            Proyección lineal: lo del año × 12 ÷ meses transcurridos.
                        </p>
                    </template>
                </div>
                <p class="mt-2 text-xs text-muted">
                    {{ AVISO_ESTIMADO }}
                </p>
            </TableroBloque>

            <!-- ISO: el trimestre en curso (solo sobre utilidades). -->
            <TableroBloque
                nombre="iso"
                :bloque="bloques.iso"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <TableroEstimado
                    v-if="bloques.iso.datos"
                    :estimado="bloques.iso.datos"
                />
                <p class="mt-2 text-xs text-muted">
                    {{ AVISO_ESTIMADO }}
                </p>
            </TableroBloque>

            <!-- Pequeño contribuyente: ventas del año frente al límite anual. -->
            <TableroBloque
                nombre="pequeno_contribuyente"
                :bloque="bloques.pequeno_contribuyente"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <div
                    v-if="pc"
                    class="flex flex-col gap-3"
                >
                    <div class="flex flex-col gap-1.5">
                        <div class="flex items-baseline justify-between gap-2 text-sm">
                            <span class="text-muted">Ventas de {{ pc.anio }}</span>
                            <span
                                class="font-semibold tabular-nums"
                                :class="pc.supera_limite ? 'text-error' : 'text-highlighted'"
                                data-prueba="pc-porcentaje"
                            >{{ pc.porcentaje }} % del límite</span>
                        </div>
                        <UProgress
                            :model-value="avancePc"
                            :max="100"
                            :color="colorPc"
                            size="sm"
                            :aria-label="`${pc.porcentaje} % del límite anual`"
                        />
                    </div>
                    <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <DatoFicha etiqueta="Acumulado">
                            <span class="tabular-nums">{{ formatearQuetzales(pc.acumulado) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Límite anual">
                            <span class="tabular-nums">{{ formatearQuetzales(pc.limite) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Disponible">
                            <span class="tabular-nums">{{ formatearQuetzales(pc.disponible) }}</span>
                        </DatoFicha>
                    </dl>
                    <p
                        v-if="pc.umbrales.length"
                        class="text-xs text-muted"
                    >
                        Avisos al {{ pc.umbrales.map(u => `${u} %`).join(' y al ') }}<template v-if="pc.umbral_alcanzado">
                            · alcanzado el {{ pc.umbral_alcanzado }} %
                        </template>. El sistema nunca cambia el régimen por su cuenta.
                    </p>
                </div>
            </TableroBloque>

            <!-- Facturado según el libro de ventas: mes y año a la fecha. -->
            <TableroBloque
                nombre="facturado"
                :bloque="bloques.facturado"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <div
                    v-if="bloques.facturado.datos"
                    class="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                    <div
                        v-for="tramo in [{ id: 'mes', titulo: 'Mes a la fecha', datos: bloques.facturado.datos.mes }, { id: 'anio', titulo: 'Año a la fecha', datos: bloques.facturado.datos.anio }]"
                        :key="tramo.id"
                        class="flex flex-col gap-2"
                        :data-facturado="tramo.id"
                    >
                        <p class="text-xs text-muted">
                            {{ tramo.titulo }} · {{ formatearFecha(tramo.datos.desde) }} al {{ formatearFecha(tramo.datos.hasta) }}
                        </p>
                        <p
                            class="text-lg font-semibold tabular-nums text-highlighted"
                            data-prueba="facturado-total"
                        >
                            {{ formatearQuetzales(tramo.datos.total) }}
                        </p>
                        <dl class="grid grid-cols-2 gap-2">
                            <DatoFicha etiqueta="Base sin IVA">
                                <span class="tabular-nums">{{ formatearQuetzales(tramo.datos.base) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="IVA">
                                <span class="tabular-nums">{{ formatearQuetzales(tramo.datos.iva) }}</span>
                            </DatoFicha>
                        </dl>
                        <p class="text-xs text-muted">
                            {{ tramo.datos.documentos === 1 ? '1 documento' : `${tramo.datos.documentos} documentos` }}<template v-if="tramo.datos.por_tipo.length">
                                · {{ tramo.datos.por_tipo.map(t => `${t.tipo} ${t.documentos}`).join(', ') }}
                            </template>
                        </p>
                    </div>
                </div>
            </TableroBloque>

            <!-- Libros legales emitibles: meses terminados sin emitir con folio. -->
            <TableroBloque
                nombre="libros"
                :bloque="bloques.libros"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <template
                    v-if="bloques.libros.datos && puede('libros.ver')"
                    #insignia
                >
                    <UButton
                        to="/libros"
                        label="Libros"
                        icon="i-lucide-book-marked"
                        color="neutral"
                        variant="link"
                        size="sm"
                        data-prueba="tablero-libros"
                    />
                </template>
                <template v-if="bloques.libros.datos">
                    <ul class="flex flex-col divide-y divide-default">
                        <li
                            v-for="libro in bloques.libros.datos.libros"
                            :key="libro.libro"
                            class="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
                            :data-libro="libro.libro"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="text-sm font-medium text-highlighted">{{ LIBROS_TABLERO[libro.libro] }}</span>
                                <UBadge
                                    :color="libro.al_dia ? 'success' : 'error'"
                                    variant="subtle"
                                    :icon="libro.al_dia ? 'i-lucide-check' : 'i-lucide-book-x'"
                                    :label="libro.al_dia ? 'Al día' : `${libro.meses_atrasados} ${libro.meses_atrasados === 1 ? 'mes atrasado' : 'meses atrasados'}`"
                                />
                            </div>
                            <span class="text-xs text-muted">
                                {{ libro.ultimo_emitido_hasta ? `Emitido hasta el ${formatearFecha(libro.ultimo_emitido_hasta)}` : 'Nunca emitido' }} · {{ libro.meses_sin_emitir === 1 ? '1 mes sin emitir' : `${libro.meses_sin_emitir} meses sin emitir` }}<template v-if="!libro.habilitado">
                                    · sin habilitación de folios
                                </template>
                            </span>
                            <span
                                v-if="libro.atrasados.length"
                                class="text-xs text-error"
                            >
                                Atrasados: {{ libro.atrasados.slice(0, 6).map(mesAtrasado).join(', ') }}<template v-if="libro.meses_atrasados > 6">
                                    y {{ libro.meses_atrasados - 6 }} más
                                </template>
                            </span>
                        </li>
                    </ul>
                    <p class="mt-2 text-xs text-muted">
                        Desde el {{ formatearFecha(bloques.libros.datos.inicio_libros) }}; un mes se considera atrasado pasados {{ bloques.libros.datos.ventana_meses }} meses de terminado.
                    </p>
                </template>
            </TableroBloque>

            <!-- FEL: modo de la empresa, obligación legal y DTE pendientes. -->
            <TableroBloque
                nombre="fel"
                :bloque="bloques.fel"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <template
                    v-if="bloques.fel.datos && puede('fel.ver')"
                    #insignia
                >
                    <UButton
                        to="/configuracion/fel"
                        label="FEL"
                        icon="i-lucide-settings"
                        color="neutral"
                        variant="link"
                        size="sm"
                    />
                </template>
                <div
                    v-if="bloques.fel.datos"
                    class="flex flex-col gap-3"
                >
                    <div class="flex flex-wrap items-center gap-2">
                        <UBadge
                            :color="MODOS_FEL[bloques.fel.datos.modo].color"
                            variant="subtle"
                            :icon="MODOS_FEL[bloques.fel.datos.modo].icono"
                            :label="`Modo ${MODOS_FEL[bloques.fel.datos.modo].etiqueta.toLowerCase()}`"
                            data-prueba="fel-modo"
                        />
                        <UBadge
                            v-if="bloques.fel.datos.contingencia_activa"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-cloud-off"
                            label="Contingencia activa"
                        />
                    </div>
                    <dl class="grid grid-cols-2 gap-2">
                        <DatoFicha
                            etiqueta="Obligación legal"
                            :valor="bloques.fel.datos.obligacion_legal === 'obligatoria' ? 'Obligatoria' : bloques.fel.datos.obligacion_legal ?? 'Sin confirmar'"
                        />
                        <DatoFicha
                            etiqueta="Certificador"
                            :valor="bloques.fel.datos.proveedor ? etiquetaProveedor(bloques.fel.datos.proveedor) : 'Sin configurar'"
                        />
                    </dl>
                    <p
                        v-if="!bloques.fel.datos.dte_pendientes.length"
                        class="text-xs text-muted"
                    >
                        Sin DTE pendientes de certificar.
                    </p>
                    <ul
                        v-else
                        class="flex flex-wrap gap-2"
                    >
                        <li
                            v-for="p in bloques.fel.datos.dte_pendientes"
                            :key="p.estado"
                        >
                            <UBadge
                                color="warning"
                                variant="subtle"
                                :label="`${ESTADOS_PENDIENTES[p.estado] ?? p.estado}: ${p.cantidad}`"
                            />
                        </li>
                    </ul>
                </div>
            </TableroBloque>

            <!-- Compras del año desde el límite sin NIT del proveedor (fase 8 PR D). -->
            <TableroBloque
                nombre="compras_sin_nit"
                :bloque="bloques.compras_sin_nit"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <div
                    v-if="bloques.compras_sin_nit.datos"
                    class="flex flex-col gap-3"
                >
                    <p
                        class="text-sm"
                        :class="bloques.compras_sin_nit.datos.cantidad ? 'text-highlighted' : 'text-muted'"
                        data-prueba="compras-sin-nit-resumen"
                    >
                        <template v-if="bloques.compras_sin_nit.datos.cantidad">
                            {{ bloques.compras_sin_nit.datos.cantidad === 1 ? '1 compra' : `${bloques.compras_sin_nit.datos.cantidad} compras` }} de {{ bloques.compras_sin_nit.datos.anio }} desde {{ formatearQuetzales(bloques.compras_sin_nit.datos.limite) }} sin NIT del proveedor: {{ formatearQuetzales(bloques.compras_sin_nit.datos.total) }}.
                        </template>
                        <template v-else>
                            Ninguna compra de {{ bloques.compras_sin_nit.datos.anio }} desde {{ formatearQuetzales(bloques.compras_sin_nit.datos.limite) }} sin NIT del proveedor.
                        </template>
                    </p>
                    <ul
                        v-if="bloques.compras_sin_nit.datos.compras.length"
                        class="flex flex-col divide-y divide-default"
                    >
                        <li
                            v-for="c in bloques.compras_sin_nit.datos.compras"
                            :key="c.compra_id"
                            class="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                            :data-compra="c.compra_id"
                        >
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <span class="text-sm font-medium text-highlighted">{{ c.proveedor }} · {{ c.documento }}</span>
                                <span class="text-xs text-muted">{{ formatearFecha(c.fecha) }} · {{ c.identificacion }}</span>
                            </div>
                            <div class="flex flex-col gap-0.5 sm:items-end">
                                <span class="text-sm tabular-nums">{{ formatearQuetzales(c.total) }}</span>
                                <ULink
                                    v-if="puede('compras.ver')"
                                    raw
                                    :to="`/compras/${c.compra_id}`"
                                    class="text-xs underline underline-offset-2 hover:decoration-2"
                                    data-prueba="compra-enlace"
                                >
                                    Ver la compra #{{ c.compra_id }}
                                </ULink>
                            </div>
                        </li>
                    </ul>
                    <p
                        v-if="bloques.compras_sin_nit.datos.cantidad > bloques.compras_sin_nit.datos.compras.length"
                        class="text-xs text-muted"
                    >
                        Se muestran las primeras {{ bloques.compras_sin_nit.datos.compras.length }}.
                    </p>
                </div>
            </TableroBloque>

            <!-- Reserva de incobrables: la misma cuenta que la estimación de cartera. -->
            <TableroBloque
                nombre="incobrables"
                :bloque="bloques.incobrables"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <template
                    v-if="bloques.incobrables.datos && puede('reportes.ver')"
                    #insignia
                >
                    <UButton
                        to="/cartera"
                        label="Cartera"
                        icon="i-lucide-shield-alert"
                        color="neutral"
                        variant="link"
                        size="sm"
                    />
                </template>
                <div
                    v-if="bloques.incobrables.datos"
                    class="flex flex-col gap-3"
                >
                    <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <DatoFicha etiqueta="Saldos deudores">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.incobrables.datos.base) }}</span>
                        </DatoFicha>
                        <DatoFicha :etiqueta="`Tope (${bloques.incobrables.datos.porcentaje} %)`">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.incobrables.datos.tope) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Registrada (1.1.12)">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.incobrables.datos.estimacion) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Por provisionar">
                            <span
                                class="font-semibold tabular-nums"
                                data-prueba="incobrables-disponible"
                            >{{ formatearQuetzales(bloques.incobrables.datos.disponible) }}</span>
                        </DatoFicha>
                    </dl>
                    <UBadge
                        v-if="bloques.incobrables.datos.sobre_tope"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        label="La estimación registrada pasa el tope deducible"
                        class="self-start"
                    />
                    <p class="text-xs text-muted">
                        Al {{ formatearFecha(bloques.incobrables.datos.corte) }}. Confirmar con contador.
                    </p>
                </div>
            </TableroBloque>

            <!-- Activos que se deprecian a una tasa menor que el máximo legal de su clase. -->
            <TableroBloque
                nombre="depreciacion"
                :bloque="bloques.depreciacion"
                :reintentar="reintentar"
                :reintentando="reintentando"
                class="lg:col-span-2"
            >
                <div
                    v-if="bloques.depreciacion.datos"
                    class="flex flex-col gap-3"
                >
                    <p
                        class="text-sm"
                        :class="bloques.depreciacion.datos.bajo_maximo ? 'text-highlighted' : 'text-muted'"
                        data-prueba="depreciacion-resumen"
                    >
                        <template v-if="bloques.depreciacion.datos.bajo_maximo">
                            {{ bloques.depreciacion.datos.bajo_maximo }} de {{ bloques.depreciacion.datos.activos }} activos bajo el máximo: al máximo, el gasto deducible anual sería {{ formatearQuetzales(bloques.depreciacion.datos.diferencia_anual) }} mayor.
                        </template>
                        <template v-else>
                            {{ bloques.depreciacion.datos.activos === 1 ? 'El activo vigente se deprecia' : `Los ${bloques.depreciacion.datos.activos} activos vigentes se deprecian` }} al máximo de su clase.
                        </template>
                    </p>
                    <ul
                        v-if="bloques.depreciacion.datos.detalle.length"
                        class="flex flex-col divide-y divide-default"
                    >
                        <li
                            v-for="a in bloques.depreciacion.datos.detalle"
                            :key="a.activo_id"
                            class="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                            :data-activo="a.activo_id"
                        >
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <ULink
                                    v-if="puede('activos.ver')"
                                    raw
                                    :to="`/activos/${a.activo_id}`"
                                    class="text-sm font-medium text-highlighted underline underline-offset-2 hover:decoration-2"
                                    data-prueba="activo-enlace"
                                >
                                    {{ a.descripcion }}
                                </ULink>
                                <span
                                    v-else
                                    class="text-sm font-medium text-highlighted"
                                >{{ a.descripcion }}</span>
                                <span class="text-xs text-muted">{{ etiquetaClaseActivo(a.clase) }} · activo #{{ a.activo_id }} · costo {{ formatearQuetzales(a.costo) }} · {{ a.tasa_anual }} % de un máximo de {{ a.tasa_maxima }} %</span>
                                <span
                                    class="text-xs text-muted"
                                    data-prueba="por-depreciar"
                                >Depreciado {{ formatearQuetzales(a.acumulada) }} · por depreciar {{ formatearQuetzales(a.por_depreciar) }}</span>
                            </div>
                            <div class="flex flex-col gap-0.5 text-xs sm:items-end">
                                <span class="tabular-nums text-muted">Anual {{ formatearQuetzales(a.depreciacion_anual) }} · máxima {{ formatearQuetzales(a.depreciacion_anual_maxima) }}</span>
                                <span class="font-medium tabular-nums text-highlighted">+{{ formatearQuetzales(a.diferencia_anual) }} al año</span>
                            </div>
                        </li>
                    </ul>
                    <p class="text-xs text-muted">
                        Cada deducción se acota a lo que le queda por depreciar al activo. La tasa se fija al dar de alta el activo. Máximos del parámetro «depreciacion»: confirmar con contador.
                    </p>
                </div>
            </TableroBloque>
        </div>
    </section>
</template>
