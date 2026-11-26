<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectMenuItem } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Asiento de ajuste a mano (`POST /libro/asientos`, `libro.registrar_asiento`, decisión 10 del
 * PM; tablero ContaLibro). Panel lateral porque es un formulario largo: fecha, descripción y las
 * líneas con su cuenta, su debe o su haber. Espejo del validador de A3: al menos 2 líneas, cada
 * una con debe o haber (no ambos), Debe = Haber, cliente en cuentas con auxiliar de clientes y
 * proveedor en 2.1.03. Si la empresa pide que otra persona apruebe, el asiento no toca el libro:
 * queda como borrador en «Por aprobar» (`estado: pendiente_aprobacion`).
 */
const props = defineProps<{
    cuentas: Cuenta[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [resultado: AsientoManual]
}>()

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

interface LineaEntrada {
    cuenta: string
    debe: string
    haber: string
    cliente_id: number
    proveedor_id: number
}

const hoy = hoyGuatemala()
const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const proveedores = shallowRef<Proveedor[]>([])

const itemsCuenta = computed<SelectMenuItem[]>(() => props.cuentas
    .filter(c => c.imputable && c.activa)
    .map(c => ({ label: `${c.codigo} · ${c.nombre}`, value: c.codigo, description: TIPOS_CUENTA[c.tipo] })))

function cuentaDe(codigo: string): Cuenta | undefined {
    return props.cuentas.find(c => c.codigo === codigo)
}

function lineaVacia(): LineaEntrada {
    return { cuenta: '', debe: '', haber: '', cliente_id: 0, proveedor_id: 0 }
}

const estado = reactive<{ fecha: string, descripcion: string, lineas: LineaEntrada[] }>({
    fecha: hoy,
    descripcion: '',
    lineas: [lineaVacia(), lineaVacia()],
})

function montoDe(texto: string): Decimal {
    return MONTO.test(texto.trim()) ? new Decimal(texto.trim()) : new Decimal(0)
}

const totales = computed(() => ({
    debe: estado.lineas.reduce((suma, l) => suma.plus(montoDe(l.debe)), new Decimal(0)),
    haber: estado.lineas.reduce((suma, l) => suma.plus(montoDe(l.haber)), new Decimal(0)),
}))
const cuadra = computed(() => totales.value.debe.gt(0) && totales.value.debe.equals(totales.value.haber))

const esquema = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha del asiento'),
    descripcion: z.string().trim().min(3, 'Al menos 3 caracteres').max(500, 'Máximo 500 caracteres'),
    lineas: z.array(z.object({
        cuenta: z.string(),
        debe: z.string(),
        haber: z.string(),
        cliente_id: z.number(),
        proveedor_id: z.number(),
    })),
}).superRefine((datos, ctx) => {
    datos.lineas.forEach((linea, i) => {
        const debe = linea.debe.trim()
        const haber = linea.haber.trim()
        if (!linea.cuenta) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'cuenta'], message: 'Elige la cuenta' })
        }
        if ((debe && !MONTO.test(debe)) || (haber && !MONTO.test(haber))) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, debe && !MONTO.test(debe) ? 'debe' : 'haber'], message: 'Monto con hasta 2 decimales' })
        }
        else if ((debe && haber) || (!debe && !haber) || new Decimal(debe || haber).lte(0)) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'debe'], message: 'Escribe el debe o el haber, mayor que cero' })
        }
        const cuenta = cuentaDe(linea.cuenta)
        if (cuenta?.auxiliar_cliente && !linea.cliente_id) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'cliente_id'], message: 'Esta cuenta pide el cliente' })
        }
        if (cuenta?.auxiliar_proveedor && !linea.proveedor_id) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'proveedor_id'], message: 'Esta cuenta pide el proveedor' })
        }
    })
    if (datos.lineas.length < 2) {
        ctx.addIssue({ code: 'custom', path: ['lineas'], message: 'Un asiento tiene al menos 2 líneas' })
    }
    else {
        const debe = datos.lineas.reduce((suma, l) => suma.plus(montoDe(l.debe)), new Decimal(0))
        const haber = datos.lineas.reduce((suma, l) => suma.plus(montoDe(l.haber)), new Decimal(0))
        if (!debe.equals(haber)) {
            ctx.addIssue({ code: 'custom', path: ['lineas'], message: `No cuadra: Debe ${formatearQuetzales(debe)} y Haber ${formatearQuetzales(haber)}` })
        }
    }
})
type Datos = z.output<typeof esquema>

async function cargarProveedores() {
    if (!puede('proveedores.ver')) {
        return
    }
    const resultado = await useProveedores().listar({})
    proveedores.value = resultado.ok ? resultado.data.data : []
}

watch(abierto, (valor) => {
    if (valor) {
        estado.fecha = hoy
        estado.descripcion = ''
        estado.lineas = [lineaVacia(), lineaVacia()]
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarProveedores()
    }
})

function agregarLinea() {
    estado.lineas.push(lineaVacia())
}

function quitarLinea(indice: number) {
    if (estado.lineas.length > 2) {
        estado.lineas.splice(indice, 1)
    }
}

function cuerpoDe(datos: Datos): DatosAsientoManual {
    return {
        fecha: datos.fecha,
        descripcion: datos.descripcion.trim(),
        movimientos: datos.lineas.map(l => ({
            cuenta: l.cuenta,
            debe: l.debe.trim() ? new Decimal(l.debe.trim()).toFixed(2) : null,
            haber: l.haber.trim() ? new Decimal(l.haber.trim()).toFixed(2) : null,
            cliente_id: l.cliente_id || null,
            proveedor_id: l.proveedor_id || null,
        })),
    }
}

async function enviar(evento: FormSubmitEvent<Datos>) {
    enviando.value = true
    problema.value = null
    const resultado = await useLibro().registrarAsiento(cuerpoDe(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
        clave = nuevaClaveIdempotencia()
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'fecha' || e.name === 'descripcion')
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[40rem] sm:m-4 sm:rounded-[1.375rem] sm:h-[calc(100dvh-2rem)]', footer: 'justify-between' }"
    >
        <template #title>
            <ModalTitulo
                texto="Asiento de ajuste"
                icono="i-lucide-book-plus"
            />
        </template>
        <template #description>
            <span class="ps-13">Un movimiento del libro hecho a mano, con su motivo</span>
        </template>

        <template #body>
            <UForm
                id="form-asiento-manual"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <UFormField
                        label="Fecha del asiento"
                        name="fecha"
                        required
                    >
                        <CampoFecha
                            v-model="estado.fecha"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                        required
                    >
                        <UInput
                            v-model="estado.descripcion"
                            placeholder="Ej.: Reclasificar depósito sin identificar"
                            class="w-full"
                            data-prueba="asiento-descripcion"
                        />
                    </UFormField>
                </div>

                <UFormField
                    label="Movimientos"
                    name="lineas"
                    required
                    help="Cada línea lleva el debe o el haber. Lo que suma el debe tiene que ser igual a lo que suma el haber."
                >
                    <ul class="flex flex-col divide-y divide-(--ax-borde) rounded-2xl border border-(--ax-borde)">
                        <li
                            v-for="(linea, i) in estado.lineas"
                            :key="i"
                            class="flex flex-col gap-2 p-3"
                            :data-linea-asiento="i"
                        >
                            <div class="flex items-start gap-2">
                                <UFormField
                                    :name="`lineas.${i}.cuenta`"
                                    class="min-w-0 flex-1"
                                >
                                    <USelectMenu
                                        v-model="linea.cuenta"
                                        :items="itemsCuenta"
                                        value-key="value"
                                        placeholder="Cuenta"
                                        class="w-full"
                                        :aria-label="`Cuenta de la línea ${i + 1}`"
                                        :data-prueba="`asiento-cuenta-${i}`"
                                    />
                                </UFormField>
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="`Quitar la línea ${i + 1}`"
                                    :disabled="estado.lineas.length <= 2"
                                    @click="quitarLinea(i)"
                                />
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <UFormField :name="`lineas.${i}.debe`">
                                    <UInput
                                        v-model="linea.debe"
                                        inputmode="decimal"
                                        placeholder="Debe"
                                        class="w-full"
                                        :aria-label="`Debe de la línea ${i + 1}`"
                                        :disabled="!!linea.haber.trim()"
                                        :data-prueba="`asiento-debe-${i}`"
                                    >
                                        <template #leading>
                                            <span class="text-sm text-muted">Q</span>
                                        </template>
                                    </UInput>
                                </UFormField>
                                <UFormField :name="`lineas.${i}.haber`">
                                    <UInput
                                        v-model="linea.haber"
                                        inputmode="decimal"
                                        placeholder="Haber"
                                        class="w-full"
                                        :aria-label="`Haber de la línea ${i + 1}`"
                                        :disabled="!!linea.debe.trim()"
                                        :data-prueba="`asiento-haber-${i}`"
                                    >
                                        <template #leading>
                                            <span class="text-sm text-muted">Q</span>
                                        </template>
                                    </UInput>
                                </UFormField>
                            </div>
                            <UFormField
                                v-if="cuentaDe(linea.cuenta)?.auxiliar_cliente"
                                :name="`lineas.${i}.cliente_id`"
                                label="Cliente"
                                required
                            >
                                <ClienteSelector v-model="linea.cliente_id" />
                            </UFormField>
                            <UFormField
                                v-if="cuentaDe(linea.cuenta)?.auxiliar_proveedor"
                                :name="`lineas.${i}.proveedor_id`"
                                label="Proveedor"
                                required
                            >
                                <USelectMenu
                                    v-model="linea.proveedor_id"
                                    :items="proveedores.map(p => ({ label: p.nombre, value: p.id }))"
                                    value-key="value"
                                    placeholder="Elige el proveedor"
                                    class="w-full"
                                />
                            </UFormField>
                        </li>
                    </ul>
                    <UButton
                        label="Agregar línea"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="link"
                        size="sm"
                        class="mt-1 px-0"
                        data-prueba="asiento-agregar-linea"
                        @click="agregarLinea"
                    />
                </UFormField>

                <div
                    class="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-(--ax-panel) px-4 py-3 text-sm tabular-nums"
                    data-prueba="asiento-totales"
                >
                    <span>Debe <strong>{{ formatearQuetzales(totales.debe) }}</strong></span>
                    <span>Haber <strong>{{ formatearQuetzales(totales.haber) }}</strong></span>
                    <UBadge
                        :label="cuadra ? 'Cuadra' : 'No cuadra'"
                        :color="cuadra ? 'success' : 'neutral'"
                        variant="soft"
                    />
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="asiento-error"
                />
            </UForm>
        </template>

        <template #footer>
            <UButton
                label="Cancelar"
                :icon="ICONOS.cancelar"
                color="neutral"
                variant="ghost"
                :disabled="enviando"
                @click="abierto = false"
            />
            <UButton
                type="submit"
                form="form-asiento-manual"
                label="Registrar asiento"
                icon="i-lucide-check"
                :loading="enviando"
                data-prueba="asiento-registrar"
            />
        </template>
    </USlideover>
</template>
