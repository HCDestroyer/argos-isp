<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { RadioGroupItem, SelectItem } from '@nuxt/ui'
import type { Aplicacion, MatrizControlVelocidad } from '~/types/controlVelocidad'
import * as z from 'zod'

/**
 * Conectar router en 4 pasos (tablero RedRouterNuevo): Equipo, Cómo trabaja, Script y Verificar.
 * Nada se guarda en los pasos 1 y 2; «Crear y generar script» hace el `POST /routers`
 * (`routers.crear`) y, si el control de velocidad elegido no es el que la API deja al crear,
 * `POST /routers/:id/cambiar-estrategia-velocidad` (`routers.cambiar_control_velocidad`). El script
 * (`GET /routers/:id/script-conexion`, `routers.generar_script`) vive solo en memoria. «Verificar»
 * lee `GET /routers/:id/conexion` cada 5 s y, al conectar, corre «Probar conexión».
 *
 * Lo que la API pide al crear y el tablero no muestra (anotado en `.claude/integration/a4.md`):
 * - `host` es obligatorio también por túnel: se pide «Dirección actual del router» (la que Argos
 *   usa hasta que el túnel se registre) y, con RADIUS, se manda como `nas_ip` (al registrarse la
 *   API la cambia por la IP del túnel).
 * - Con RADIUS el script exige un secreto: por túnel lo genera el navegador (32 caracteres).
 * - «Por código» necesita usuario y clave de la API (`corte_codigo_sin_api`): por túnel se crea
 *   «Por IP» y al conectar se ofrece pasar a «Por código».
 */
definePageMeta({ permiso: 'routers.crear' })

useHead({ title: 'Conectar router · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { conSelector: variasEmpresas, empresas } = useEmpresaActiva()

const PASOS = ['Equipo', 'Cómo trabaja', 'Script', 'Verificar'] as const
const paso = ref(1)

/* Paso 1 y 2: espejo de `crearRouterValidator` (A1) en lo que se pide aquí. */
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const SIN_EMPRESA = 0

const estado = reactive({
    nombre: '',
    empresa: SIN_EMPRESA,
    via: 'tunel' as 'tunel' | 'directo',
    host: '',
    nas_ip: '',
    api_usuario: '',
    api_password: '',
    radius_secret: '',
    modo_seguridad: 'radius' as 'radius' | 'api',
    tipo_conexion: 'pppoe' as 'pppoe' | 'ip_estatica' | 'dhcp_fija',
    aplicacion: 'radius_rate_limit' as Aplicacion,
    corte: 'codigo' as 'codigo' | 'ip',
})

const esquema1 = z.object({
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    host: z.string().trim().min(1, 'Escribe la dirección o el nombre del router').max(255, 'Máximo 255 caracteres'),
})
const esquema2 = computed(() => z.object({
    nas_ip: estado.via === 'directo' && estado.modo_seguridad === 'radius'
        ? z.string().trim().regex(IPV4, 'Escribe la IPv4 con la que el router llega a RADIUS')
        : z.string(),
    radius_secret: estado.via === 'directo' && estado.modo_seguridad === 'radius'
        ? z.string().refine(valor => valor === '' || (valor.length >= 16 && valor.length <= 128), 'Entre 16 y 128 caracteres, o vacío')
        : z.string(),
}))

const conApi = computed(() => estado.via === 'tunel' || Boolean(estado.api_usuario.trim() && estado.api_password))

const itemsEmpresa = computed<SelectItem[]>(() => [
    { label: 'Compartido entre empresas', value: SIN_EMPRESA },
    ...empresas.value.map(e => ({ label: e.nombre_comercial, value: e.id })),
])

const itemsVia: RadioGroupItem[] = [
    { label: 'Por túnel seguro', value: 'tunel', description: 'Argos crea el túnel, el usuario de la API y el RADIUS con un script. No abres puertos.' },
    { label: 'Ya tengo acceso directo', value: 'directo', description: 'Escribes a mano la dirección, el usuario y la clave de la API. Para instalaciones ya armadas.' },
]
const itemsSeguridad: RadioGroupItem[] = [
    { label: 'RADIUS', value: 'radius', description: 'PPPoE validado por Argos, con corte y cambio de velocidad al instante. Mide el consumo.' },
    { label: 'Sin RADIUS', value: 'api', description: 'Argos configura todo por la API del router. Sin consumo de datos.' },
]
const itemsTipo = computed<RadioGroupItem[]>(() => [
    { label: 'PPPoE', value: 'pppoe', description: 'Usuario y contraseña en el equipo del cliente.' },
    { label: 'IP estática', value: 'ip_estatica', description: 'IP fija, sin usuario.' },
    { label: 'DHCP fija', value: 'dhcp_fija', description: 'IP amarrada a la MAC.' },
])

/* Control de velocidad: 3 a la vista y «Ver las otras» (decisión del PM). */
const VISIBLES: Aplicacion[] = ['radius_rate_limit', 'arbol_pcq', 'cola_simple']
const OTRAS: Aplicacion[] = ['perfil_ppp', 'pcq_plan']
const verOtras = ref(false)
const matriz = shallowRef<MatrizControlVelocidad | null>(null)
const problemaMatriz = ref<Problem | null>(null)

async function cargarMatriz() {
    const resultado = await useControlVelocidad().matriz()
    matriz.value = resultado.ok ? resultado.data : null
    problemaMatriz.value = resultado.ok ? null : resultado.problema
}

const tipoVelocidad = computed(() => estado.tipo_conexion)

/** Opción de «Cómo se aplica la velocidad» (objeto, no un valor suelto: se lee `value` y `disabled`). */
interface ItemAplicacion {
    label: string
    value: Aplicacion
    description: string
    disabled: boolean
}

function itemAplicacion(valor: Aplicacion): ItemAplicacion {
    const disponible = matriz.value ? aplicacionDisponible(matriz.value, valor, tipoVelocidad.value) : { valida: true, motivo: null }
    const sinRadius = estado.modo_seguridad === 'api' && (valor === 'radius_rate_limit' || valor === 'perfil_ppp')
    return {
        label: OPCIONES_APLICACION[valor].etiqueta,
        value: valor,
        description: !disponible.valida ? `No aplica: ${disponible.motivo}` : sinRadius ? 'Necesita RADIUS.' : OPCIONES_APLICACION[valor].explicacion,
        disabled: !disponible.valida || sinRadius,
    }
}
const itemsAplicacion = computed(() => VISIBLES.map(itemAplicacion))
const itemsOtras = computed(() => OTRAS.map(itemAplicacion))

// Si lo elegido deja de aplicar (otro tipo de conexión o sin RADIUS), vuelve a la primera que aplica.
watch(() => [estado.tipo_conexion, estado.modo_seguridad, matriz.value], () => {
    const todas = [...itemsAplicacion.value, ...itemsOtras.value]
    if (todas.find(i => i.value === estado.aplicacion)?.disabled) {
        const primera = todas.find(i => !i.disabled)
        if (primera) {
            estado.aplicacion = primera.value
        }
    }
    if (OTRAS.includes(estado.aplicacion)) {
        verOtras.value = true
    }
})

const itemsCorte = computed<RadioGroupItem[]>(() => [
    { label: 'Por código', value: 'codigo', description: CORTE_IDENTIFICACION.codigo.descripcion, disabled: !conApi.value },
    { label: 'Por IP', value: 'ip', description: 'Solo si no hay NAT entre el router y Argos.' },
])

// Sin usuario y clave de la API (acceso directo), «Por código» no aplica: queda «Por IP».
watch(conApi, (valor) => {
    if (!valor && estado.corte === 'codigo') {
        estado.corte = 'ip'
    }
}, { immediate: true })

const RECOMENDADOS = new Set(['tunel', 'radius', 'radius_rate_limit', 'codigo'])

/* Navegación y creación. */
const formulario1 = useTemplateRef('formulario1')
const formulario2 = useTemplateRef('formulario2')
const creando = ref(false)
const problema = ref<Problem | null>(null)
const creado = shallowRef<RouterNas | null>(null)
const avisoVelocidad = ref<string | null>(null)

function secretoAleatorio(): string {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return Array.from(bytes, b => letras[b % letras.length]).join('')
}

async function crear() {
    creando.value = true
    problema.value = null
    const radius = estado.modo_seguridad === 'radius'
    const tunel = estado.via === 'tunel'
    const resultado = await useRouters().crear({
        nombre: estado.nombre.trim(),
        host: estado.host.trim(),
        ...(radius
            ? {
                    nas_ip: tunel ? estado.host.trim() : estado.nas_ip.trim(),
                    radius_secret: tunel ? secretoAleatorio() : (estado.radius_secret || null),
                }
            : {}),
        api_usuario: tunel ? null : (estado.api_usuario.trim() || null),
        api_password: tunel ? null : (estado.api_password || null),
        modo_seguridad: estado.modo_seguridad,
        tipo_conexion: estado.tipo_conexion,
        control_velocidad: estado.aplicacion === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
        corte_identificacion: tunel ? 'ip' : estado.corte,
        ...(variasEmpresas.value && estado.empresa !== SIN_EMPRESA ? { empresa_sugerida_id: estado.empresa } : {}),
        activo: true,
    })
    if (!resultado.ok) {
        creando.value = false
        problema.value = resultado.problema
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.some(e => e.name === 'nombre' || e.name === 'host')) {
            paso.value = 1
            await nextTick()
            formulario1.value?.setErrors(errores)
        }
        else {
            formulario2.value?.setErrors(errores)
        }
        return
    }
    let router = resultado.data
    // El control elegido: si la API dejó otro al crear, se cambia con su acción.
    const actual = router.estrategia_velocidad[estado.tipo_conexion]
    if (actual.aplicacion !== estado.aplicacion && matriz.value && puede('routers.cambiar_control_velocidad')) {
        const estrategias = estrategiasDeRouter(router)
        estrategias[estado.tipo_conexion] = ajustarEstrategia(matriz.value, { ...actual, aplicacion: estado.aplicacion }, estado.tipo_conexion, router.routeros_version)
        const cambio = await useControlVelocidad().cambiarRouter(router.id, { version: router.version, estrategia_velocidad: estrategias })
        if (cambio.ok) {
            router = cambio.data
        }
        else {
            avisoVelocidad.value = `El router quedó con «${OPCIONES_APLICACION[actual.aplicacion].etiqueta}»: ${cambio.problema.detail ?? cambio.problema.title}. Cámbialo en su ficha, pestaña Velocidad.`
        }
    }
    creado.value = router
    creando.value = false
    paso.value = estado.via === 'tunel' ? 3 : 4
    if (estado.via === 'tunel') {
        void generarScript()
    }
}

async function seguir() {
    if (paso.value === 1) {
        const valido = await formulario1.value?.validate({ silent: true }).catch(() => null)
        if (!valido) {
            await formulario1.value?.validate({ silent: false }).catch(() => null)
            return
        }
        paso.value = 2
        if (!matriz.value) {
            void cargarMatriz()
        }
        return
    }
    if (paso.value === 2) {
        const valido = await formulario2.value?.validate({ silent: true }).catch(() => null)
        if (!valido) {
            await formulario2.value?.validate({ silent: false }).catch(() => null)
            return
        }
        await crear()
        return
    }
    if (paso.value === 3) {
        paso.value = 4
        return
    }
    await navigateTo(creado.value ? `/routers/${creado.value.id}` : '/routers')
}

function atras() {
    // Con el router ya creado no se vuelve a los pasos que lo crean.
    if (paso.value > 1 && !(creado.value && paso.value <= 3)) {
        paso.value--
    }
    else if (paso.value === 4 && estado.via === 'tunel') {
        paso.value = 3
    }
}

const puedeAtras = computed(() => (creado.value ? paso.value === 4 && estado.via === 'tunel' : paso.value > 1))

const textoSeguir = computed(() => {
    if (paso.value === 1) {
        return 'Seguir'
    }
    if (paso.value === 2) {
        return estado.via === 'tunel' ? 'Crear y generar script' : 'Crear router'
    }
    if (paso.value === 3) {
        return 'Ya lo pegué, verificar'
    }
    return conectado.value ? 'Ir a la ficha del router' : 'Seguir sin esperar'
})

const pie = computed(() => {
    if (paso.value === 1) {
        return 'Paso 1 de 4 · nada se guarda todavía'
    }
    if (paso.value === 2) {
        return 'Al seguir se crea el router en Argos (queda «Por conectar»)'
    }
    if (paso.value === 3) {
        return 'El router ya existe en Argos; puedes volver más tarde por el script desde su ficha'
    }
    return conectado.value ? 'Todo en orden' : 'Puedes cerrar: la ficha del router muestra cuándo se conecta'
})

/* Paso 3: el script (solo en memoria). */
const IP_O_RED = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\/([0-9]|[12][0-9]|3[0-2]))?$/
const adminIps = ref<string[]>([])
const incluirServicio = ref(true)
const script = ref<string | null>(null)
const generando = ref(false)
const problemaScript = ref<Problem | null>(null)
const errorAdmin = ref<string | null>(null)

async function generarScript() {
    if (!creado.value || !puede('routers.generar_script')) {
        return
    }
    const malas = adminIps.value.filter(ip => !IP_O_RED.test(ip.trim()))
    errorAdmin.value = malas.length ? `Revisa: ${malas.join(', ')} (IPv4 o red como 10.0.0.0/24)` : null
    if (malas.length) {
        return
    }
    generando.value = true
    problemaScript.value = null
    const resultado = await useRouters().scriptConexion(creado.value.id, {
        ...(adminIps.value.length ? { admin: adminIps.value.map(ip => ip.trim()).join(',') } : {}),
        ...(incluirServicio.value ? { incluir: 'servicio' as const } : {}),
    })
    generando.value = false
    script.value = resultado.ok ? resultado.data : null
    problemaScript.value = resultado.ok ? null : resultado.problema
}

const nombreArchivo = computed(() => `conexion-${(creado.value?.nombre ?? 'router').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.rsc`)

function descargar() {
    if (!script.value) {
        return
    }
    const url = URL.createObjectURL(new Blob([script.value], { type: 'text/plain' }))
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombreArchivo.value
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copiar() {
    if (!script.value) {
        return
    }
    try {
        await navigator.clipboard.writeText(script.value)
        toast.add({ title: 'Script copiado', description: 'Pégalo en New Terminal del router.', color: 'neutral', icon: 'i-lucide-clipboard-check' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar', description: 'Descárgalo como archivo.', color: 'warning', icon: 'i-lucide-triangle-alert' })
    }
}

const PASOS_SCRIPT = [
    { titulo: 'Abre Winbox y entra al router', detalle: 'Con tu usuario de siempre.' },
    { titulo: 'New Terminal', detalle: 'Botón en el menú de la izquierda.' },
    { titulo: 'Pega el script y presiona Enter', detalle: 'Al final dice «argosisp: listo» o qué falló.' },
]

/* Paso 4: verificar. */
const conexion = shallowRef<ConexionRouter | null>(null)
const problemaConexion = ref<Problem | null>(null)
const prueba = shallowRef<PruebaConexion | null>(null)
const probando = ref(false)
const conectado = computed(() => (estado.via === 'directo' ? Boolean(prueba.value?.ok) : conexion.value?.estado === 'conectado'))
let sondeo: ReturnType<typeof setInterval> | undefined

async function leerConexion() {
    if (!creado.value) {
        return
    }
    const resultado = await useRouters().conexion(creado.value.id)
    conexion.value = resultado.ok ? resultado.data : null
    problemaConexion.value = resultado.ok ? null : resultado.problema
    if (conexion.value?.estado === 'conectado' && !prueba.value && !probando.value) {
        void probar()
    }
}

async function probar() {
    if (!creado.value || !puede('routers.probar_conexion')) {
        return
    }
    probando.value = true
    const resultado = await useRouters().probarConexion(creado.value.id)
    probando.value = false
    prueba.value = resultado.ok ? resultado.data : null
}

watch(paso, (valor) => {
    clearInterval(sondeo)
    if (valor === 4) {
        if (estado.via === 'tunel') {
            void leerConexion()
            sondeo = setInterval(() => void leerConexion(), 5000)
        }
        else {
            void probar()
        }
    }
})
onBeforeUnmount(() => clearInterval(sondeo))

type EstadoChequeo = 'ok' | 'error' | 'esperando' | 'pendiente'
interface FilaVerificar {
    clave: string
    titulo: string
    detalle: string
    estado: EstadoChequeo
}

function chequeo(clave: 'tunel' | 'api' | 'radius' | 'corte' | 'equipo'): EstadoChequeo {
    const fila = prueba.value?.chequeos.find(c => c.clave === clave)
    if (!fila) {
        return probando.value ? 'esperando' : 'pendiente'
    }
    return fila.ok === true ? 'ok' : fila.ok === false ? 'error' : 'pendiente'
}

function detalleChequeo(clave: string, porDefecto: string): string {
    return prueba.value?.chequeos.find(c => c.clave === clave)?.detalle ?? porDefecto
}

const filasVerificar = computed<FilaVerificar[]>(() => {
    const filas: FilaVerificar[] = []
    if (estado.via === 'tunel') {
        filas.push({
            clave: 'registro',
            titulo: conexion.value?.registrado_en ? 'El router se registró' : 'Esperando que el router se registre…',
            detalle: conexion.value?.registrado_en ? `Recibimos su clave pública ${haceCuanto(conexion.value.registrado_en)}.` : 'Lo hace el script al terminar.',
            estado: conexion.value?.registrado_en ? 'ok' : 'esperando',
        })
        filas.push({
            clave: 'saludo',
            titulo: conexion.value?.handshake_reciente ? 'El túnel saluda' : 'Esperando el saludo del túnel…',
            detalle: conexion.value?.ultimo_handshake ? `Último saludo ${haceCuanto(conexion.value.ultimo_handshake)}.` : 'Suele tardar menos de 40 segundos.',
            estado: conexion.value?.handshake_reciente ? 'ok' : (conexion.value?.registrado_en ? 'esperando' : 'pendiente'),
        })
    }
    filas.push({ clave: 'api', titulo: 'API del router', detalle: detalleChequeo('api', 'Usuario argosisp-api con los permisos mínimos.'), estado: chequeo('api') })
    if (estado.modo_seguridad === 'radius') {
        filas.push({ clave: 'radius', titulo: 'RADIUS y CoA', detalle: detalleChequeo('radius', 'Que apunte a Argos y acepte cortes al instante.'), estado: chequeo('radius') })
    }
    filas.push({ clave: 'corte', titulo: 'Página de corte', detalle: detalleChequeo('corte', 'Que un suspendido llegue a su aviso de pago.'), estado: chequeo('corte') })
    return filas
})

const ICONO_CHEQUEO: Record<EstadoChequeo, { icono: string, clase: string }> = {
    ok: { icono: 'i-lucide-circle-check', clase: 'text-success' },
    error: { icono: 'i-lucide-circle-x', clase: 'text-error' },
    esperando: { icono: 'i-lucide-loader-circle', clase: 'text-primary animate-spin motion-reduce:animate-none' },
    pendiente: { icono: 'i-lucide-clock', clase: 'text-dimmed' },
}

/* «Por código» elegido por túnel: se activa cuando la API del router ya está registrada. */
const pasandoCodigo = ref(false)
const problemaCodigo = ref<Problem | null>(null)
const corteCodigoListo = ref(false)

async function pasarACodigo() {
    if (!creado.value) {
        return
    }
    pasandoCodigo.value = true
    problemaCodigo.value = null
    const leido = await useRouters().ver(creado.value.id)
    const resultado = leido.ok ? await useRouters().editar(creado.value.id, { version: leido.data.version, corte_identificacion: 'codigo' }) : leido
    pasandoCodigo.value = false
    if (!resultado.ok) {
        problemaCodigo.value = resultado.problema
        return
    }
    creado.value = resultado.data
    corteCodigoListo.value = true
    toast.add({ title: 'Corte por código activado', description: resultado.data.nombre, icon: 'i-lucide-circle-check', color: 'success' })
}

const pegarClaveAbierta = ref(false)

function cerrar() {
    void navigateTo(creado.value ? `/routers/${creado.value.id}` : '/routers')
}
</script>

<template>
    <PanelPagina
        id="router-nuevo"
        titulo="Conectar router"
        icono="i-lucide-router"
        encabezado-propio
    >
        <div
            class="surface-card flex min-h-[calc(100dvh-9rem)] flex-col overflow-hidden rounded-[1.375rem]"
            data-prueba="conectar-router"
        >
            <!-- Encabezado: título, progreso compacto de 4 pasos, ayuda y cerrar. -->
            <header class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-(--ax-borde) px-4 py-3 sm:px-5">
                <div class="flex min-w-0 items-center gap-3">
                    <span class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl">
                        <UIcon
                            name="i-lucide-router"
                            class="size-5"
                        />
                    </span>
                    <div class="flex min-w-0 flex-col">
                        <h1 class="text-lg font-bold tracking-[-0.02em] text-highlighted">
                            Conectar router
                        </h1>
                        <span class="truncate text-xs text-muted">{{ estado.nombre || 'Router nuevo' }}</span>
                    </div>
                </div>
                <ol
                    class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
                    aria-label="Pasos"
                    data-prueba="pasos-router"
                >
                    <li
                        v-for="(nombre, indice) in PASOS"
                        :key="nombre"
                        class="flex shrink-0 items-center gap-2"
                        :aria-current="paso === indice + 1 ? 'step' : undefined"
                    >
                        <span
                            class="flex size-6 items-center justify-center rounded-full text-xs font-semibold"
                            :class="indice + 1 < paso ? 'bg-success/15 text-success' : indice + 1 === paso ? 'bg-primary text-inverted ring-4 ring-primary/15' : 'bg-(--ax-panel) text-muted'"
                        >
                            <UIcon
                                v-if="indice + 1 < paso"
                                name="i-lucide-check"
                                class="size-3.5"
                            />
                            <template v-else>{{ indice + 1 }}</template>
                        </span>
                        <span
                            class="text-sm font-medium"
                            :class="[indice + 1 === paso ? 'text-primary' : indice + 1 < paso ? 'text-success' : 'text-muted', indice + 1 === paso ? '' : 'hidden md:inline']"
                        >{{ nombre }}</span>
                        <span
                            v-if="indice < PASOS.length - 1"
                            class="hidden h-px w-6 md:block"
                            :class="indice + 1 < paso ? 'bg-success' : 'bg-(--ax-borde)'"
                            aria-hidden="true"
                        />
                    </li>
                </ol>
                <div class="ms-auto flex items-center gap-1">
                    <AyudaBoton solo-icono />
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        class="rounded-full"
                        aria-label="Cerrar"
                        @click="cerrar"
                    />
                </div>
            </header>

            <div class="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <!-- Paso 1: Equipo. -->
                <UForm
                    v-show="paso === 1"
                    ref="formulario1"
                    :schema="esquema1"
                    :state="estado"
                    class="flex max-w-3xl flex-col gap-4"
                    data-prueba="paso-equipo"
                    @submit.prevent
                >
                    <div>
                        <h2 class="text-lg font-semibold text-highlighted">
                            ¿Qué router vas a conectar?
                        </h2>
                        <p class="text-sm text-muted">
                            Lo demás lo crea el script por ti.
                        </p>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Nombre del router"
                            name="nombre"
                            required
                            help="Como lo conoce tu equipo: lugar o torre."
                        >
                            <UInput
                                v-model="estado.nombre"
                                placeholder="MK Bodega"
                                data-prueba="router-nombre"
                                class="w-full"
                                autofocus
                            />
                        </UFormField>
                        <UFormField
                            v-if="variasEmpresas"
                            label="Empresa"
                            name="empresa"
                            help="La red es infraestructura común; cada servicio lleva su empresa."
                        >
                            <USelect
                                v-model="estado.empresa"
                                :items="itemsEmpresa"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="¿Cómo se comunica con Argos?"
                        name="via"
                    >
                        <URadioGroup
                            v-model="estado.via"
                            :items="itemsVia"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2' }"
                            data-prueba="via-conexion"
                        >
                            <template #label="{ item }">
                                <span class="flex items-center gap-2 font-semibold">
                                    {{ (item as RadioGroupItem & { label: string }).label }}
                                    <UBadge
                                        v-if="RECOMENDADOS.has(String((item as RadioGroupItem & { value: string }).value))"
                                        label="Recomendado"
                                        color="success"
                                        variant="soft"
                                        size="sm"
                                    />
                                </span>
                            </template>
                        </URadioGroup>
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            :label="estado.via === 'tunel' ? 'Dirección actual del router' : 'Host de la API REST'"
                            name="host"
                            required
                            :help="estado.via === 'tunel' ? 'IP o nombre con que llega hoy. Al registrarse, Argos pasa a hablarle por el túnel.' : 'IP o nombre con que Argos llega a la API.'"
                        >
                            <UInput
                                v-model="estado.host"
                                data-prueba="router-host"
                                placeholder="190.56.12.1"
                                class="w-full font-mono"
                            />
                        </UFormField>
                    </div>
                    <template v-if="estado.via === 'directo'">
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                label="Usuario de la API"
                                name="api_usuario"
                            >
                                <UInput
                                    v-model="estado.api_usuario"
                                    autocomplete="off"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Contraseña de la API"
                                name="api_password"
                                help="Se guarda cifrada y no se vuelve a mostrar."
                            >
                                <UInput
                                    v-model="estado.api_password"
                                    type="password"
                                    autocomplete="new-password"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                    </template>
                    <UAlert
                        v-if="estado.via === 'tunel'"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-info"
                        title="Necesita RouterOS 7 (por WireGuard)."
                        description="El script lo comprueba al inicio y no toca nada si es más viejo."
                    />
                </UForm>

                <!-- Paso 2: Cómo trabaja. -->
                <UForm
                    v-show="paso === 2"
                    ref="formulario2"
                    :schema="esquema2"
                    :state="estado"
                    class="flex max-w-4xl flex-col gap-4"
                    data-prueba="paso-como-trabaja"
                    @submit.prevent
                >
                    <div>
                        <h2 class="text-lg font-semibold text-highlighted">
                            ¿Cómo trabaja este router?
                        </h2>
                        <p class="text-sm text-muted">
                            Cada decisión es una sola para todo el router. Todas se pueden cambiar después desde su ficha, con vista previa.
                        </p>
                    </div>
                    <ProblemaAlerta
                        v-if="problema && !esRouterDuplicado(problema)"
                        :problema="problema"
                    />
                    <UAlert
                        v-else-if="problema"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-copy"
                        title="Ese MikroTik ya está registrado"
                        :actions="[{ label: 'Ver routers', to: '/routers', color: 'warning', variant: 'outline' }]"
                        data-prueba="router-duplicado"
                    >
                        <template #description>
                            <p>{{ problema.detail }}</p>
                            <ul class="list-disc ps-5">
                                <li
                                    v-for="(error, indice) in problema.errors ?? []"
                                    :key="indice"
                                >
                                    {{ error.message }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <UFormField
                        label="Seguridad y control"
                        name="modo_seguridad"
                    >
                        <URadioGroup
                            v-model="estado.modo_seguridad"
                            :items="itemsSeguridad"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2' }"
                            data-prueba="modo-seguridad"
                        >
                            <template #label="{ item }">
                                <span class="flex items-center gap-2 font-semibold">
                                    {{ (item as RadioGroupItem & { label: string }).label }}
                                    <UBadge
                                        v-if="RECOMENDADOS.has(String((item as RadioGroupItem & { value: string }).value))"
                                        label="Recomendado"
                                        color="success"
                                        variant="soft"
                                        size="sm"
                                    />
                                </span>
                            </template>
                        </URadioGroup>
                    </UFormField>
                    <div
                        v-if="estado.via === 'directo' && estado.modo_seguridad === 'radius'"
                        class="grid gap-4 sm:grid-cols-2"
                    >
                        <UFormField
                            label="IP del NAS"
                            name="nas_ip"
                            required
                            help="La IP con que el router llega a RADIUS."
                        >
                            <UInput
                                v-model="estado.nas_ip"
                                data-prueba="router-nas"
                                placeholder="10.10.0.1"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            label="Secreto RADIUS"
                            name="radius_secret"
                            help="Entre 16 y 128 caracteres; se guarda cifrado. Puedes ponerlo después en «Conexión»."
                        >
                            <UInput
                                v-model="estado.radius_secret"
                                type="password"
                                autocomplete="new-password"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="Tipo de conexión de los clientes"
                        name="tipo_conexion"
                        help="Uno por router: todos sus servicios lo usan."
                    >
                        <URadioGroup
                            v-model="estado.tipo_conexion"
                            :items="itemsTipo"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-3 sm:grid-cols-3' }"
                            data-prueba="tipo-conexion"
                        />
                    </UFormField>
                    <UFormField
                        label="Control de velocidad"
                        name="aplicacion"
                    >
                        <ProblemaAlerta
                            v-if="problemaMatriz"
                            :problema="problemaMatriz"
                            :reintentar="cargarMatriz"
                            class="mb-2"
                        />
                        <URadioGroup
                            v-model="estado.aplicacion"
                            :items="verOtras ? [...itemsAplicacion, ...itemsOtras] : itemsAplicacion"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-3 sm:grid-cols-3' }"
                            data-prueba="control-velocidad"
                        >
                            <template #label="{ item }">
                                <span class="flex items-center gap-2 font-semibold">
                                    {{ (item as RadioGroupItem & { label: string }).label }}
                                    <UBadge
                                        v-if="RECOMENDADOS.has(String((item as RadioGroupItem & { value: string }).value))"
                                        label="Recomendado"
                                        color="success"
                                        variant="soft"
                                        size="sm"
                                    />
                                </span>
                            </template>
                        </URadioGroup>
                        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                            <UButton
                                :label="verOtras ? 'Ocultar las otras' : `Ver las otras (${OTRAS.length})`"
                                :trailing-icon="verOtras ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                                variant="link"
                                size="sm"
                                class="px-0"
                                data-prueba="ver-otras-control"
                                @click="verOtras = !verOtras"
                            />
                            <span>RADIUS y Perfil PPP solo con PPPoE y RADIUS. Se puede cambiar después en la ficha, pestaña Velocidad.</span>
                        </div>
                    </UFormField>
                    <UFormField
                        label="Cómo reconocer al cliente suspendido"
                        name="corte_identificacion"
                        :help="estado.via === 'tunel' && estado.corte === 'codigo' ? 'Por túnel el router se crea «Por IP»; al conectarse, en «Verificar», pasas a «Por código» con un clic (necesita la API que crea el script).' : (!conApi ? 'Sin usuario y clave de la API, solo «Por IP».' : undefined)"
                    >
                        <URadioGroup
                            v-model="estado.corte"
                            :items="itemsCorte"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2' }"
                            data-prueba="corte-identificacion"
                        >
                            <template #label="{ item }">
                                <span class="flex items-center gap-2 font-semibold">
                                    {{ (item as RadioGroupItem & { label: string }).label }}
                                    <UBadge
                                        v-if="RECOMENDADOS.has(String((item as RadioGroupItem & { value: string }).value))"
                                        label="Recomendado"
                                        color="success"
                                        variant="soft"
                                        size="sm"
                                    />
                                </span>
                            </template>
                        </URadioGroup>
                    </UFormField>
                </UForm>

                <!-- Paso 3: Script. -->
                <div
                    v-if="paso === 3"
                    class="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
                    data-prueba="paso-script"
                >
                    <div class="flex flex-col gap-4">
                        <div>
                            <h2 class="text-lg font-semibold text-highlighted">
                                Pega este script en el router
                            </h2>
                            <p class="text-sm text-muted">
                                Crea el túnel, el usuario de la API{{ estado.modo_seguridad === 'radius' ? ' y el RADIUS' : '' }}. Se puede volver a correr sin dañar nada.
                            </p>
                        </div>
                        <ol class="flex flex-col">
                            <li
                                v-for="(pasoScript, indice) in PASOS_SCRIPT"
                                :key="pasoScript.titulo"
                                class="flex items-start gap-3 border-t border-(--ax-borde) py-3 first:border-t-0"
                            >
                                <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--ax-panel) text-sm font-semibold text-highlighted">{{ indice + 1 }}</span>
                                <span class="flex flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ pasoScript.titulo }}</span>
                                    <span class="text-xs text-muted">{{ pasoScript.detalle }}</span>
                                </span>
                            </li>
                        </ol>
                        <USwitch
                            v-model="incluirServicio"
                            label="Incluir configuración de servicio"
                            description="PPPoE, perfiles y reglas de corte. Apágalo si el router ya atiende clientes."
                            size="lg"
                            @update:model-value="generarScript"
                        />
                        <UFormField
                            label="IPs de administración (opcional)"
                            help="Desde dónde puedes entrar por Winbox además del túnel. Tu sesión actual nunca se bloquea."
                            :error="errorAdmin ?? undefined"
                        >
                            <UInputTags
                                v-model="adminIps"
                                placeholder="Agregar IP…"
                                class="w-full"
                                @update:model-value="generarScript"
                            />
                        </UFormField>
                    </div>
                    <div class="flex min-w-0 flex-col gap-3">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-mono text-sm font-semibold text-highlighted">{{ nombreArchivo }}</span>
                            <UBadge
                                label="Vale 24 h · un solo uso"
                                icon="i-lucide-clock"
                                color="warning"
                                variant="soft"
                                size="sm"
                                class="rounded-full"
                            />
                            <span class="ms-auto flex gap-2">
                                <UButton
                                    label="Descargar"
                                    icon="i-lucide-download"
                                    color="neutral"
                                    variant="outline"
                                    class="rounded-full"
                                    :disabled="!script"
                                    @click="descargar"
                                />
                                <UButton
                                    label="Copiar script"
                                    icon="i-lucide-copy"
                                    class="rounded-full"
                                    :disabled="!script"
                                    data-prueba="copiar-script"
                                    @click="copiar"
                                />
                            </span>
                        </div>
                        <ProblemaAlerta
                            v-if="problemaScript"
                            :problema="problemaScript"
                            :reintentar="generarScript"
                            :reintentando="generando"
                        />
                        <UAlert
                            v-else-if="!puede('routers.generar_script')"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-lock"
                            title="Sin permiso para generar el script"
                            description="Pide a un administrador el permiso «routers.generar_script» o que lo genere desde la ficha del router."
                        />
                        <USkeleton
                            v-else-if="generando || !script"
                            class="h-72 w-full rounded-xl"
                        />
                        <pre
                            v-else
                            class="max-h-[28rem] min-h-72 overflow-auto rounded-xl bg-[#0f1424] p-4 font-mono text-xs leading-relaxed text-[#e7eaee]"
                            data-prueba="script-router"
                        >{{ script }}</pre>
                        <UAlert
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-lock"
                            :description="`El script lleva la clave de la API${estado.modo_seguridad === 'radius' ? ' y el secreto RADIUS' : ''}. Argos no lo guarda: si lo pierdes, genera otro.`"
                        />
                    </div>
                </div>

                <!-- Paso 4: Verificar. -->
                <div
                    v-if="paso === 4"
                    class="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
                    data-prueba="paso-verificar"
                >
                    <div class="flex flex-col gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-highlighted">
                                {{ conectado ? 'Conectado' : (estado.via === 'tunel' ? 'Esperando al router…' : 'Probando la conexión…') }}
                            </h2>
                            <p class="text-sm text-muted">
                                {{ conectado ? 'Argos ya puede configurarlo, cortar y medir.' : (estado.via === 'tunel' ? 'Deja esta pantalla abierta mientras corres el script. Se actualiza sola.' : 'Argos prueba la API, RADIUS y el corte con lo que escribiste.') }}
                            </p>
                        </div>
                        <UAlert
                            v-if="avisoVelocidad"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-gauge"
                            :description="avisoVelocidad"
                        />
                        <ProblemaAlerta
                            v-if="problemaConexion"
                            :problema="problemaConexion"
                            :reintentar="leerConexion"
                        />
                        <ul class="flex flex-col gap-2">
                            <li
                                v-for="fila in filasVerificar"
                                :key="fila.clave"
                                class="flex items-start gap-3 rounded-xl border border-(--ax-borde) px-4 py-3"
                                :data-chequeo="fila.clave"
                                :data-estado="fila.estado"
                            >
                                <UIcon
                                    :name="ICONO_CHEQUEO[fila.estado].icono"
                                    class="mt-0.5 size-5 shrink-0"
                                    :class="ICONO_CHEQUEO[fila.estado].clase"
                                />
                                <span class="flex flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ fila.titulo }}</span>
                                    <span class="text-xs text-muted">{{ fila.detalle }}</span>
                                </span>
                            </li>
                        </ul>
                        <div
                            v-if="estado.via === 'tunel' && estado.corte === 'codigo' && conectado && !corteCodigoListo"
                            class="flex flex-col gap-2 rounded-xl border border-(--ax-borde) bg-(--ax-panel) p-4"
                        >
                            <span class="text-sm font-semibold text-highlighted">Falta pasar a «Por código»</span>
                            <span class="text-xs text-muted">Elegiste reconocer al suspendido por código; ahora que la API del router está registrada, ya se puede.</span>
                            <ProblemaAlerta
                                v-if="problemaCodigo"
                                :problema="problemaCodigo"
                            />
                            <UButton
                                v-if="puede('routers.editar')"
                                label="Activar corte por código"
                                icon="i-lucide-ticket"
                                class="self-start rounded-full"
                                :loading="pasandoCodigo"
                                @click="pasarACodigo"
                            />
                        </div>
                        <UButton
                            v-if="estado.via === 'directo' || conectado"
                            label="Probar otra vez"
                            icon="i-lucide-activity"
                            color="neutral"
                            variant="outline"
                            class="self-start rounded-full"
                            :loading="probando"
                            :disabled="!puede('routers.probar_conexion')"
                            @click="probar"
                        />
                    </div>
                    <div
                        v-if="estado.via === 'tunel'"
                        class="flex h-fit flex-col gap-3 rounded-2xl border border-(--ax-borde) bg-(--ax-panel) p-4"
                    >
                        <h3 class="text-sm font-semibold text-highlighted">
                            ¿No avanza?
                        </h3>
                        <ul class="list-disc ps-5 text-sm text-default">
                            <li>El router necesita salida a internet por el puerto UDP de WireGuard.</li>
                            <li>Si el script dijo «la gestión NO se restringió», corrige lo que indica y genera un script nuevo.</li>
                            <li>
                                Sin internet en el router:
                                <UButton
                                    v-if="puede('routers.conexion_clave')"
                                    label="pega su clave pública a mano"
                                    variant="link"
                                    size="sm"
                                    class="px-0 underline"
                                    @click="pegarClaveAbierta = true"
                                />
                                <span v-else>pide a un administrador que pegue su clave pública.</span>
                            </li>
                        </ul>
                        <UButton
                            label="Volver al script"
                            icon="i-lucide-chevron-left"
                            color="neutral"
                            variant="outline"
                            class="self-start rounded-full"
                            @click="paso = 3"
                        />
                    </div>
                </div>
            </div>

            <!-- Pie: qué pasa al seguir, Atrás y la acción del paso. -->
            <footer class="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-(--ax-borde) bg-(--ax-tarjeta) px-4 py-3 sm:px-5">
                <span class="hidden text-sm text-muted sm:block">{{ pie }}</span>
                <span class="ms-auto flex flex-1 gap-2 sm:flex-none">
                    <UButton
                        v-if="puedeAtras"
                        label="Atrás"
                        icon="i-lucide-chevron-left"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        class="rounded-full"
                        @click="atras"
                    />
                    <UButton
                        :label="textoSeguir"
                        trailing-icon="i-lucide-chevron-right"
                        size="lg"
                        class="glow-brand flex-1 justify-center rounded-full sm:flex-none"
                        :loading="creando"
                        data-prueba="seguir-router"
                        @click="seguir"
                    />
                </span>
            </footer>
        </div>

        <RouterClaveModal
            v-if="creado && puede('routers.conexion_clave')"
            v-model:open="pegarClaveAbierta"
            :router="creado"
            @guardado="leerConexion"
        />
    </PanelPagina>
</template>
