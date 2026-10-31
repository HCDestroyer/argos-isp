<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Revisar un borrador de compra (A3, `contratos/inventario.md` D.5): los datos que leyó el parser del
 * XML o la IA (con la confianza por campo resaltada: ámbar media, rojo baja), corregirlos («Guardar
 * cambios», `compras.editar_borrador`), elegir el proveedor y qué hacer con cada línea (producto
 * existente, uno nuevo con su tipo y modalidad, o gasto) y confirmar (`compras.confirmar_borrador`: la
 * compra la registra `compras.registrar`) o descartar con motivo.
 */
definePageMeta({ permiso: 'compras.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const id = computed(() => Number(route.params.id))
const borrador = shallowRef<BorradorCompra | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead({ title: () => (borrador.value?.numero ? `Borrador ${borrador.value.numero} · ArgosIsp` : 'Borrador de compra · ArgosIsp') })

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA })
const editable = computed(() => borrador.value?.estado === 'borrador')
const puedeEditar = computed(() => editable.value && puede('compras.editar_borrador'))
const puedeConfirmar = computed(() => editable.value && puede('compras.confirmar_borrador') && puede('compras.registrar'))

/* Catálogos para confirmar */
const productos = shallowRef<Producto[]>([])
const tipos = shallowRef<TipoProducto[]>([])
const bodegas = shallowRef<Bodega[]>([])
const proveedores = shallowRef<Proveedor[]>([])
const problemaCatalogos = ref<Problem | null>(null)

async function cargarCatalogos() {
    if (!puede('inventario.ver')) {
        problemaCatalogos.value = { type: 'about:blank', title: 'Sin permiso', status: 403, detail: 'Para elegir productos y bodegas falta el permiso inventario.ver.' }
        return
    }
    const [rProductos, rTipos, rBodegas, rProveedores] = await Promise.all([
        useProductos().activos(),
        useTiposProducto().activos(),
        useBodegas().activas(),
        puede('proveedores.ver') ? useProveedores().listar({ limit: 200 }) : null,
    ])
    productos.value = rProductos.ok ? rProductos.data : []
    tipos.value = rTipos.ok ? rTipos.data : []
    bodegas.value = rBodegas.ok ? rBodegas.data : []
    proveedores.value = rProveedores?.ok ? rProveedores.data.data : []
    problemaCatalogos.value = (!rProductos.ok ? rProductos.problema : null) ?? (!rTipos.ok ? rTipos.problema : null) ?? (!rBodegas.ok ? rBodegas.problema : null) ?? (rProveedores && !rProveedores.ok ? rProveedores.problema : null)
}

/* Datos de la factura */
const formularioDatos = useTemplateRef('formularioDatos')
const datos = reactive<EntradaDatosCompra>(datosDesdeBorrador({}, hoy()))
const guardado = ref('')
const sucio = computed(() => JSON.stringify(cuerpoDatosCompra(datos)) !== guardado.value)
const guardandoDatos = ref(false)
const problemaDatos = ref<Problem | null>(null)

/* Confirmación */
const formularioConfirmar = useTemplateRef('formularioConfirmar')
const confirmacion = reactive<EntradaConfirmacion>(confirmacionDesdePropuesta(null, datos, [], []))
const confirmando = ref(false)
const problemaConfirmar = ref<Problem | null>(null)
const receptorDistinto = ref(false)
let claveConfirmar = nuevaClaveIdempotencia()

function aplicar(nuevo: BorradorCompra) {
    borrador.value = nuevo
    Object.assign(datos, datosDesdeBorrador(nuevo.datos, hoy()))
    guardado.value = JSON.stringify(cuerpoDatosCompra(datos))
    Object.assign(confirmacion, confirmacionDesdePropuesta(nuevo.propuesta, datos, productos.value, tipos.value))
    claveConfirmar = nuevaClaveIdempotencia()
}

async function cargar() {
    cargando.value = true
    const [resultado] = await Promise.all([useBorradoresCompra().ver(id.value), cargarCatalogos()])
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        aplicar(resultado.data)
    }
}

onMounted(cargar)

const confianza = computed(() => borrador.value?.confianza ?? null)
const nivel = (campo: string) => nivelConfianza(confianzaCampo(confianza.value, campo))
const nivelLinea = (indice: number, campo: string) => nivelConfianza(confianzaLinea(confianza.value, indice, campo))
const cuadre = computed(() => cuadreLineas(datos))
const errorExtraccion = computed(() => (borrador.value?.error_extraccion ? textoErrorExtraccion(borrador.value.error_extraccion) : null))
const itemsDocumento: SelectItem[] = Object.entries(TIPOS_DOCUMENTO_COMPRA).map(([value, descripcion]) => ({ label: value, value, description: descripcion }))
const itemsBienServicio: SelectItem[] = [{ label: 'Bien', value: 'B' }, { label: 'Servicio', value: 'S' }]

function agregarLinea() {
    datos.lineas.push(lineaCompraVacia())
}

function quitarLinea(indice: number) {
    datos.lineas.splice(indice, 1)
}

async function guardarDatos(evento: FormSubmitEvent<EntradaDatosCompra>) {
    if (!borrador.value) {
        return
    }
    guardandoDatos.value = true
    problemaDatos.value = null
    const resultado = await useBorradoresCompra().editar(borrador.value, cuerpoDatosCompra(evento.data), nuevaClaveIdempotencia())
    guardandoDatos.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.replace(/^datos\./, '') }))
        if (errores.length) {
            formularioDatos.value?.setErrors(errores)
        }
        problemaDatos.value = resultado.problema
        return
    }
    aplicar(resultado.data)
    toast.add({ title: 'Cambios guardados', description: 'La propuesta de proveedor y productos se recalculó.', icon: 'i-lucide-circle-check', color: 'success' })
}

/* Líneas de la confirmación */
const itemsProveedor = computed<SelectItem[]>(() => proveedores.value.map(p => ({ label: p.nombre, value: p.id, description: p.nit ?? undefined })))
const itemsProducto = computed<SelectItem[]>(() => productos.value.map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id, description: `${SEGUIMIENTOS[p.seguimiento].etiqueta}${p.modalidad ? ` · ${MODALIDADES[p.modalidad].etiqueta}` : ''}` })))
const itemsTipo = computed<SelectItem[]>(() => tipos.value.map(t => ({ label: t.nombre, value: t.codigo })))
const itemsBodega = computed<SelectItem[]>(() => bodegas.value.map(b => ({ label: b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono })))
const itemsAccion: RadioGroupItem[] = [
    { label: 'Producto existente', value: 'existente' },
    { label: 'Producto nuevo', value: 'crear' },
    { label: 'Gasto', value: 'gasto' },
]
const itemsCondicion: RadioGroupItem[] = [{ label: 'Al crédito', value: 'credito' }, { label: 'Al contado', value: 'contado' }]

function itemsModalidad(linea: LineaConfirmacion): SelectItem[] {
    const tipo = tipos.value.find(t => t.codigo === linea.tipo)
    return [
        { label: tipo ? `La del tipo (${MODALIDADES[tipo.modalidad_defecto].etiqueta})` : 'La del tipo', value: 'del_tipo' },
        ...(Object.keys(MODALIDADES) as ModalidadProducto[]).filter(m => modalidadCompatible(m, linea.seguimiento)).map(m => ({ label: MODALIDADES[m].etiqueta, value: m })),
    ]
}

function elegirProducto(linea: LineaConfirmacion, valor: unknown) {
    linea.producto_id = typeof valor === 'number' ? valor : null
    linea.seguimiento = productos.value.find(p => p.id === linea.producto_id)?.seguimiento ?? 'cantidad'
}

function elegirTipo(linea: LineaConfirmacion, valor: unknown) {
    linea.tipo = typeof valor === 'string' ? valor : linea.tipo
    linea.seguimiento = tipos.value.find(t => t.codigo === linea.tipo)?.seguimiento_defecto ?? 'cantidad'
    linea.modalidad = 'del_tipo'
}

function cambiarAccion(linea: LineaConfirmacion, valor: unknown) {
    if (valor === 'existente' || valor === 'crear' || valor === 'gasto') {
        linea.accion = valor
        linea.seguimiento = valor === 'existente'
            ? (productos.value.find(p => p.id === linea.producto_id)?.seguimiento ?? 'cantidad')
            : (tipos.value.find(t => t.codigo === linea.tipo)?.seguimiento_defecto ?? 'cantidad')
    }
}

const propuestaDe = (indice: number) => borrador.value?.propuesta?.lineas.find(l => l.indice === indice) ?? null

async function confirmar(evento: FormSubmitEvent<EntradaConfirmacion>) {
    if (!borrador.value) {
        return
    }
    confirmando.value = true
    problemaConfirmar.value = null
    const resultado = await useBorradoresCompra().confirmar(borrador.value.id, cuerpoConfirmacion(evento.data, borrador.value.version), claveConfirmar)
    confirmando.value = false
    if (!resultado.ok) {
        receptorDistinto.value = codigoProblema(resultado.problema) === 'receptor_distinto' || (resultado.problema.errors ?? []).some(e => e.field === 'forzar_receptor')
        const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name ? campoConfirmacion(e.name) : e.name }))
        if (errores.length) {
            formularioConfirmar.value?.setErrors(errores)
        }
        problemaConfirmar.value = resultado.problema
        return
    }
    aplicar(resultado.data)
    toast.add({ title: 'Compra registrada', description: 'Con su asiento y su entrada al inventario.', icon: 'i-lucide-circle-check', color: 'success' })
}

/* Descartar y archivo */
const descartarAbierto = ref(false)

function descartar(motivo: string, clave: string): Promise<Resultado<BorradorCompra>> {
    return borrador.value ? useBorradoresCompra().descartar(borrador.value, motivo, clave) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'El borrador no está cargado', status: 400 } })
}

function alDescartar(nuevo: BorradorCompra) {
    aplicar(nuevo)
    toast.add({ title: 'Borrador descartado', icon: 'i-lucide-file-x', color: 'success' })
}

const abriendoArchivo = ref(false)

async function verArchivo() {
    if (!borrador.value) {
        return
    }
    const ventana = window.open('', '_blank')
    abriendoArchivo.value = true
    const resultado = await useBorradoresCompra().archivo(borrador.value.id)
    abriendoArchivo.value = false
    if (!resultado.ok) {
        ventana?.close()
        toast.add({ title: 'No se pudo abrir el archivo', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const url = URL.createObjectURL(resultado.data)
    if (ventana) {
        ventana.location.href = url
    }
    else {
        guardarBlob(resultado.data, borrador.value.archivo_nombre ?? `factura-${borrador.value.id}`)
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
</script>

<template>
    <PanelPagina
        id="compras-borrador"
        :titulo="borrador?.numero ? `Factura ${borrador.serie ?? ''} ${borrador.numero}` : 'Borrador de compra'"
        icono="i-lucide-file-pen"
    >
        <template #acciones>
            <UButton
                v-if="puede('compras.cargar_borrador')"
                label="Cargar otra"
                icon="i-lucide-file-up"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
                to="/compras/cargar"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!borrador"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-20 w-full" />
            <USkeleton class="h-64 w-full" />
        </div>
        <div
            v-else
            class="mx-auto flex w-full max-w-6xl flex-col gap-5"
            data-prueba="borrador-compra"
        >
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                        :label="ESTADOS_BORRADOR[borrador.estado].etiqueta"
                        :icon="ESTADOS_BORRADOR[borrador.estado].icono"
                        :color="ESTADOS_BORRADOR[borrador.estado].color"
                        variant="subtle"
                        data-prueba="borrador-estado"
                    />
                    <UBadge
                        :label="FUENTES_BORRADOR[borrador.fuente].etiqueta"
                        :icon="FUENTES_BORRADOR[borrador.fuente].icono"
                        color="neutral"
                        variant="outline"
                    />
                    <span
                        v-if="borrador.ia_proveedor"
                        class="text-xs text-muted"
                    >{{ borrador.ia_proveedor }} · {{ borrador.ia_modelo }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="borrador.archivo_sha256"
                        :label="borrador.archivo_nombre ?? 'Ver archivo'"
                        icon="i-lucide-paperclip"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :loading="abriendoArchivo"
                        :ui="{ label: 'truncate max-w-48' }"
                        @click="verArchivo"
                    />
                    <UButton
                        v-if="borrador.compra_id && puede('compras.ver')"
                        label="Ver la compra"
                        icon="i-lucide-shopping-cart"
                        size="sm"
                        :to="`/compras/${borrador.compra_id}`"
                        data-prueba="borrador-ver-compra"
                    />
                </div>
            </div>

            <UAlert
                v-if="errorExtraccion && editable"
                color="warning"
                variant="subtle"
                icon="i-lucide-keyboard"
                :title="errorExtraccion.titulo"
                :description="errorExtraccion.detalle"
                data-prueba="borrador-error-extraccion"
            />
            <UAlert
                v-if="borrador.estado === 'descartado'"
                color="neutral"
                variant="subtle"
                icon="i-lucide-file-x"
                title="Borrador descartado"
                :description="borrador.motivo_descarte ?? undefined"
            />
            <UAlert
                v-if="confianza && editable"
                color="info"
                variant="subtle"
                icon="i-lucide-sparkles"
                title="Leído con IA: revisa lo marcado"
                description="Los campos en ámbar tienen confianza media y en rojo baja. Corrige y guarda antes de confirmar."
            />

            <UCard>
                <template #header>
                    <div class="flex items-center justify-between gap-2">
                        <h2 class="text-sm font-semibold text-highlighted">
                            Datos de la factura
                        </h2>
                        <UBadge
                            v-if="sucio && puedeEditar"
                            label="Cambios sin guardar"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                </template>
                <UForm
                    ref="formularioDatos"
                    :schema="esquemaDatosCompra"
                    :state="datos"
                    :disabled="!puedeEditar"
                    class="flex flex-col gap-4"
                    @submit="guardarDatos"
                >
                    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <UFormField
                            label="NIT del emisor"
                            name="emisor.nit"
                            required
                            :class="nivel('emisor')?.clase"
                            :hint="nivel('emisor')?.etiqueta"
                        >
                            <UInput
                                v-model="datos.emisor.nit"
                                class="w-full font-mono"
                                data-prueba="borrador-emisor-nit"
                            />
                        </UFormField>
                        <UFormField
                            label="Emisor"
                            name="emisor.nombre"
                            required
                            class="lg:col-span-3"
                            :class="nivel('emisor')?.clase"
                        >
                            <UInput
                                v-model="datos.emisor.nombre"
                                class="w-full"
                                data-prueba="borrador-emisor-nombre"
                            />
                        </UFormField>
                        <UFormField
                            label="Tipo"
                            name="tipo_documento"
                            required
                        >
                            <USelect
                                v-model="datos.tipo_documento"
                                :items="itemsDocumento"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Serie"
                            name="serie"
                            :class="nivel('serie')?.clase"
                            :hint="nivel('serie')?.etiqueta"
                        >
                            <UInput
                                v-model="datos.serie"
                                class="w-full font-mono"
                                data-prueba="borrador-serie"
                            />
                        </UFormField>
                        <UFormField
                            label="Número"
                            name="numero"
                            required
                            :class="nivel('numero')?.clase"
                            :hint="nivel('numero')?.etiqueta"
                        >
                            <UInput
                                v-model="datos.numero"
                                class="w-full font-mono"
                                data-prueba="borrador-numero"
                            />
                        </UFormField>
                        <UFormField
                            label="Fecha"
                            name="fecha"
                            required
                            :class="nivel('fecha')?.clase"
                            :hint="nivel('fecha')?.etiqueta"
                        >
                            <UInput
                                v-model="datos.fecha"
                                type="date"
                                class="w-full"
                                data-prueba="borrador-fecha"
                            />
                        </UFormField>
                        <UFormField
                            label="Autorización (UUID FEL)"
                            name="autorizacion"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="datos.autorizacion"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            label="NIT del receptor"
                            name="receptor.nit"
                        >
                            <UInput
                                v-model="datos.receptor.nit"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            label="Moneda"
                            name="moneda"
                            required
                        >
                            <UInput
                                v-model="datos.moneda"
                                class="w-full font-mono uppercase"
                                maxlength="3"
                            />
                        </UFormField>
                    </div>

                    <div class="flex flex-col gap-3">
                        <div
                            v-for="(linea, i) in datos.lineas"
                            :key="i"
                            class="flex flex-col gap-3 rounded-md border border-default p-3"
                            :data-linea-borrador="i"
                        >
                            <div class="flex items-start justify-between gap-2">
                                <span class="text-xs font-medium text-muted">Línea {{ i + 1 }}</span>
                                <UButton
                                    v-if="puedeEditar"
                                    icon="i-lucide-trash-2"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :aria-label="`Quitar la línea ${i + 1}`"
                                    @click="quitarLinea(i)"
                                />
                            </div>
                            <div class="grid gap-3 sm:grid-cols-6">
                                <UFormField
                                    label="Descripción"
                                    :name="`lineas.${i}.descripcion`"
                                    required
                                    class="sm:col-span-4"
                                    :class="nivelLinea(i, 'descripcion')?.clase"
                                    :hint="nivelLinea(i, 'descripcion')?.etiqueta"
                                >
                                    <UInput
                                        v-model="linea.descripcion"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Código"
                                    :name="`lineas.${i}.codigo`"
                                >
                                    <UInput
                                        v-model="linea.codigo"
                                        class="w-full font-mono"
                                    />
                                </UFormField>
                                <UFormField
                                    label="B/S"
                                    :name="`lineas.${i}.bien_o_servicio`"
                                    required
                                >
                                    <USelect
                                        v-model="linea.bien_o_servicio"
                                        :items="itemsBienServicio"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Cantidad"
                                    :name="`lineas.${i}.cantidad`"
                                    required
                                    :class="nivelLinea(i, 'cantidad')?.clase"
                                    :hint="nivelLinea(i, 'cantidad')?.etiqueta"
                                >
                                    <UInput
                                        v-model="linea.cantidad"
                                        inputmode="decimal"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Unidad"
                                    :name="`lineas.${i}.unidad`"
                                >
                                    <UInput
                                        v-model="linea.unidad"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Precio unitario"
                                    :name="`lineas.${i}.precio_unitario`"
                                    required
                                >
                                    <UInput
                                        v-model="linea.precio_unitario"
                                        inputmode="decimal"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Descuento"
                                    :name="`lineas.${i}.descuento`"
                                    required
                                >
                                    <UInput
                                        v-model="linea.descuento"
                                        inputmode="decimal"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="IVA"
                                    :name="`lineas.${i}.iva`"
                                    required
                                >
                                    <UInput
                                        v-model="linea.iva"
                                        inputmode="decimal"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Total con IVA"
                                    :name="`lineas.${i}.total`"
                                    required
                                    :class="nivelLinea(i, 'total')?.clase"
                                    :hint="nivelLinea(i, 'total')?.etiqueta"
                                >
                                    <UInput
                                        v-model="linea.total"
                                        inputmode="decimal"
                                        class="w-full"
                                    />
                                </UFormField>
                            </div>
                        </div>
                        <UFormField name="lineas" />
                        <UButton
                            v-if="puedeEditar"
                            label="Agregar línea"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="self-start"
                            @click="agregarLinea"
                        />
                    </div>

                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField
                            label="Total de la factura"
                            name="totales.total"
                            required
                            :class="nivel('totales')?.clase"
                            :hint="nivel('totales')?.etiqueta"
                        >
                            <UInput
                                v-model="datos.totales.total"
                                inputmode="decimal"
                                class="w-full"
                                data-prueba="borrador-total"
                            />
                        </UFormField>
                        <UFormField
                            label="IVA"
                            name="totales.iva"
                            required
                        >
                            <UInput
                                v-model="datos.totales.iva"
                                inputmode="decimal"
                                class="w-full"
                            />
                        </UFormField>
                        <div class="flex items-end">
                            <UBadge
                                :label="cuadre.cuadra ? `Las líneas suman ${formatearQuetzales(cuadre.suma)}` : `Las líneas suman ${formatearQuetzales(cuadre.suma)}: no cuadra con el total`"
                                :color="cuadre.cuadra ? 'success' : 'warning'"
                                :icon="cuadre.cuadra ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                                variant="subtle"
                                data-prueba="borrador-cuadre"
                            />
                        </div>
                    </div>
                    <ProblemaAlerta
                        v-if="problemaDatos"
                        :problema="problemaDatos"
                        con-errores
                    />
                    <div
                        v-if="puedeEditar"
                        class="flex justify-end"
                    >
                        <UButton
                            type="submit"
                            label="Guardar cambios"
                            icon="i-lucide-save"
                            color="neutral"
                            variant="outline"
                            :disabled="!sucio"
                            :loading="guardandoDatos"
                            data-prueba="borrador-guardar"
                        />
                    </div>
                </UForm>
            </UCard>

            <UCard v-if="editable">
                <template #header>
                    <div class="flex flex-col gap-1">
                        <h2 class="text-sm font-semibold text-highlighted">
                            Confirmar la compra
                        </h2>
                        <p class="text-xs text-muted">
                            Elige el proveedor y qué hacer con cada línea. Lo que va a un producto entra al inventario en unidades enteras; lo demás va a gasto.
                        </p>
                    </div>
                </template>
                <ProblemaAlerta
                    v-if="problemaCatalogos"
                    :problema="problemaCatalogos"
                    :reintentar="cargarCatalogos"
                />
                <UForm
                    v-else
                    ref="formularioConfirmar"
                    :schema="esquemaConfirmacion"
                    :state="confirmacion"
                    :disabled="!puedeConfirmar"
                    class="flex flex-col gap-5"
                    @submit="confirmar"
                >
                    <div class="flex flex-col gap-3">
                        <URadioGroup
                            v-model="confirmacion.proveedor_modo"
                            :items="[{ label: 'Proveedor existente', value: 'existente' }, { label: 'Crear el proveedor', value: 'crear' }]"
                            orientation="horizontal"
                            data-prueba="confirmar-proveedor-modo"
                        />
                        <UFormField
                            v-if="confirmacion.proveedor_modo === 'existente'"
                            label="Proveedor"
                            name="proveedor_id"
                            required
                        >
                            <USelectMenu
                                v-model="confirmacion.proveedor_id"
                                :items="itemsProveedor"
                                value-key="value"
                                placeholder="Busca por nombre o NIT"
                                class="w-full sm:max-w-md"
                                data-prueba="confirmar-proveedor"
                            />
                        </UFormField>
                        <div
                            v-else
                            class="grid gap-3 sm:grid-cols-3"
                        >
                            <UFormField
                                label="NIT"
                                name="proveedor_nit"
                            >
                                <UInput
                                    v-model="confirmacion.proveedor_nit"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                            <UFormField
                                label="Nombre del proveedor"
                                name="proveedor_nombre"
                                required
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="confirmacion.proveedor_nombre"
                                    class="w-full"
                                    data-prueba="confirmar-proveedor-nombre"
                                />
                            </UFormField>
                        </div>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2">
                        <UFormField
                            label="Condición"
                            name="condicion"
                        >
                            <URadioGroup
                                v-model="confirmacion.condicion"
                                :items="itemsCondicion"
                                orientation="horizontal"
                            />
                        </UFormField>
                        <UFormField
                            v-if="confirmacion.condicion === 'credito'"
                            label="Vence"
                            name="vence_en"
                            help="Vacío = los días de crédito del proveedor."
                        >
                            <UInput
                                v-model="confirmacion.vence_en"
                                type="date"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <MedioPagoCampos
                        v-if="confirmacion.condicion === 'contado'"
                        v-model:metodo="confirmacion.metodo"
                        v-model:caja-id="confirmacion.caja_id"
                        v-model:banco-id="confirmacion.banco_id"
                        v-model:cuenta-bancaria-id="confirmacion.cuenta_bancaria_id"
                    />

                    <div class="flex flex-col gap-3">
                        <div
                            v-for="(linea, i) in confirmacion.lineas"
                            :key="linea.indice"
                            class="flex flex-col gap-3 rounded-md border border-default p-3"
                            :data-confirmar-linea="linea.indice"
                        >
                            <div class="flex flex-col gap-1">
                                <span class="text-sm font-medium text-highlighted">{{ datos.lineas[linea.indice]?.descripcion }}</span>
                                <span class="text-xs text-muted">
                                    {{ datos.lineas[linea.indice]?.cantidad }} {{ datos.lineas[linea.indice]?.unidad }} · {{ formatearQuetzales(datos.lineas[linea.indice]?.total ?? '0') }}
                                    <template v-if="propuestaDe(linea.indice)?.producto_id && propuestaDe(linea.indice)?.coincidencia">
                                        · coincide con {{ propuestaDe(linea.indice)?.producto_sku }} {{ COINCIDENCIAS[propuestaDe(linea.indice)?.coincidencia ?? ''] }}
                                    </template>
                                </span>
                            </div>
                            <URadioGroup
                                :model-value="linea.accion"
                                :items="itemsAccion"
                                orientation="horizontal"
                                size="sm"
                                data-prueba="confirmar-accion"
                                @update:model-value="v => cambiarAccion(linea, v)"
                            />
                            <div
                                v-if="linea.accion === 'existente'"
                                class="grid gap-3 sm:grid-cols-2"
                            >
                                <UFormField
                                    label="Producto"
                                    :name="`lineas.${i}.producto_id`"
                                    required
                                >
                                    <USelectMenu
                                        :model-value="linea.producto_id ?? undefined"
                                        :items="itemsProducto"
                                        value-key="value"
                                        placeholder="Busca por nombre o SKU"
                                        class="w-full"
                                        @update:model-value="v => elegirProducto(linea, v)"
                                    />
                                </UFormField>
                            </div>
                            <div
                                v-else-if="linea.accion === 'crear'"
                                class="grid gap-3 sm:grid-cols-4"
                            >
                                <UFormField
                                    label="SKU"
                                    :name="`lineas.${i}.sku`"
                                    required
                                >
                                    <UInput
                                        v-model="linea.sku"
                                        class="w-full font-mono"
                                        data-prueba="confirmar-sku"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Nombre"
                                    :name="`lineas.${i}.nombre`"
                                    required
                                    class="sm:col-span-3"
                                >
                                    <UInput
                                        v-model="linea.nombre"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Tipo"
                                    :name="`lineas.${i}.tipo`"
                                    required
                                >
                                    <USelect
                                        :model-value="linea.tipo"
                                        :items="itemsTipo"
                                        class="w-full"
                                        data-prueba="confirmar-tipo"
                                        @update:model-value="v => elegirTipo(linea, v)"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Modalidad"
                                    :name="`lineas.${i}.modalidad`"
                                >
                                    <USelect
                                        v-model="linea.modalidad"
                                        :items="itemsModalidad(linea)"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Unidad"
                                    :name="`lineas.${i}.unidad`"
                                >
                                    <UInput
                                        v-model="linea.unidad"
                                        class="w-full"
                                    />
                                </UFormField>
                            </div>
                            <div
                                v-if="linea.accion !== 'gasto'"
                                class="grid gap-3 sm:grid-cols-2"
                            >
                                <UFormField
                                    label="Entra a"
                                    :name="`lineas.${i}.bodega_id`"
                                    required
                                >
                                    <USelect
                                        :model-value="linea.bodega_id ?? undefined"
                                        :items="itemsBodega"
                                        placeholder="Bodega"
                                        class="w-full"
                                        data-prueba="confirmar-bodega"
                                        @update:model-value="v => linea.bodega_id = typeof v === 'number' ? v : null"
                                    />
                                </UFormField>
                                <UFormField
                                    v-if="linea.seguimiento === 'serie'"
                                    label="Series o MAC"
                                    :name="`lineas.${i}.series`"
                                    required
                                    :help="`Una por unidad: ${linea.cantidad}.`"
                                >
                                    <UTextarea
                                        v-model="linea.series"
                                        :rows="2"
                                        autoresize
                                        class="w-full font-mono"
                                    />
                                </UFormField>
                                <UFormField
                                    :name="`lineas.${i}.cantidad`"
                                    class="sm:col-span-2"
                                />
                            </div>
                            <UFormField
                                v-else
                                label="Cuenta de gasto"
                                :name="`lineas.${i}.cuenta`"
                                help="Vacío = la cuenta por defecto de compras."
                            >
                                <UInput
                                    v-model="linea.cuenta"
                                    placeholder="5.2.01"
                                    class="w-full font-mono sm:w-48"
                                />
                            </UFormField>
                        </div>
                    </div>

                    <UCheckbox
                        v-if="receptorDistinto"
                        v-model="confirmacion.forzar_receptor"
                        label="Confirmar aunque el NIT del receptor no sea el de la empresa"
                        data-prueba="confirmar-forzar-receptor"
                    />
                    <ProblemaAlerta
                        v-if="problemaConfirmar"
                        :problema="problemaConfirmar"
                        con-errores
                    />
                    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <span
                            v-if="sucio"
                            class="text-xs text-warning sm:mr-auto"
                        >Guarda los cambios de la factura antes de confirmar.</span>
                        <UButton
                            v-if="puede('compras.descartar_borrador')"
                            label="Descartar"
                            icon="i-lucide-file-x"
                            color="error"
                            variant="ghost"
                            data-prueba="borrador-descartar"
                            @click="descartarAbierto = true"
                        />
                        <UButton
                            v-if="puedeConfirmar"
                            type="submit"
                            label="Confirmar compra"
                            icon="i-lucide-check"
                            :disabled="sucio"
                            :loading="confirmando"
                            data-prueba="borrador-confirmar"
                        />
                    </div>
                </UForm>
            </UCard>

            <AccionMotivoModal
                v-model:open="descartarAbierto"
                titulo="Descartar borrador"
                efecto="El borrador queda descartado y no se registra ninguna compra. El archivo se conserva."
                confirmar="Descartar"
                icono="i-lucide-file-x"
                color="error"
                :ejecutar="descartar"
                @hecho="alDescartar"
            />
        </div>
    </PanelPagina>
</template>
