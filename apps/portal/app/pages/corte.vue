<script setup lang="ts">
/**
 * Página de corte: aquí aterriza el cliente suspendido (dst-nat del MikroTik y detección de
 * portal cautivo). Identifica el servicio por la IP de origen (`GET /portal/quien-soy`) y solo
 * muestra nombre parcial, estado y montos.
 *
 * Día 2: estado, monto, facturas vencidas, datos de depósito y contacto. Día 4: solicitar promesa
 * de pago (tarea 4, `PromesaSolicitar`); el comprobante llega en otra tanda y el pago en línea en
 * la semana 2 (mientras, esos botones se ven apagados).
 *
 * Estado en vivo (tarea 6): después de cualquier acción del cliente, cuando la pestaña vuelve a
 * estar visible o si ya tiene una promesa activa, consulta `GET /portal/estado` cada 5 s hasta
 * 2 min; al ver `activo` muestra "Ya tienes servicio".
 */
const { seguirNavegandoUrl } = useRuntimeConfig().public
const { data: corte, status, refresh } = useCorte()
// Contacto, instrucciones y cuentas de depósito: configuración del panel (tarea 9).
const { empresa, nombre: nombreEmpresa } = useEmpresa()

useHead({ title: computed(() => `Estado del servicio · ${nombreEmpresa.value}`) })

const cargando = computed(() => status.value === 'idle' || status.value === 'pending')
const mensaje = computed(() => corte.value ? mensajeCorte(corte.value) : null)
const identificado = computed(() => corte.value?.identificado === true)
const retirado = computed(() => corte.value?.estado === 'retirado')

const verDeposito = ref(false)
const verPromesa = ref(false)

/** Última promesa enviada desde esta página (aprobada o pendiente; la rechazada se ve en el modal). */
const promesa = ref<PromesaSolicitada | null>(null)
const puedePedirPromesa = computed(() => identificado.value
    && !corte.value?.promesa_activa
    && corte.value?.estado !== 'activo'
    && promesa.value === null)

const { activo: servicioActivo, vigilando, agotado, vigilar } = useEstadoServicio()
/** Tiene sentido esperar la reactivación: servicio identificado, no retirado y no activo. */
const puedeVigilar = computed(() => identificado.value && !retirado.value && corte.value?.estado !== 'activo')
const reactivado = computed(() => servicioActivo.value && corte.value?.estado !== 'activo')

/** Toda acción del cliente que pueda reactivar el servicio termina llamando a esta función. */
function vigilarEstado() {
    if (puedeVigilar.value) {
        vigilar()
    }
}

function alCambiarVisibilidad() {
    if (document.visibilityState === 'visible') {
        vigilarEstado()
    }
}

// Con una promesa activa la reactivación ya va en camino: se vigila desde que carga.
watch(() => corte.value?.promesa_activa, (promesa) => {
    if (promesa) {
        vigilarEstado()
    }
}, { immediate: true })

onMounted(() => document.addEventListener('visibilitychange', alCambiarVisibilidad))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', alCambiarVisibilidad))

/** Aprobada: el servicio ya se reactivó en la API; el estado en vivo lo confirma ("Ya tienes servicio"). */
function promesaResuelta(resultado: PromesaSolicitada) {
    if (resultado.resultado === 'rechazada') {
        return
    }
    promesa.value = resultado
    if (resultado.resultado === 'aprobada') {
        vigilarEstado()
    }
}

/** Llamar es lo que funciona con el servicio suspendido; si no hay teléfono, la página de contacto. */
const contacto = computed(() => {
    const telefono = enlacesContacto(empresa.value).find(enlace => enlace.tipo === 'telefono')
    return telefono
        ? { label: `Llamar a soporte: ${telefono.valor}`, icon: telefono.icon, to: telefono.to }
        : { label: 'Contacta a soporte', icon: 'i-lucide-headset', to: '/contacto' }
})

/**
 * "Ver datos de depósito" se oculta solo cuando la configuración se leyó y no hay ni cuentas ni
 * instrucciones (nada que mostrar). Si aún carga o falló, el modal muestra el estado o el error.
 */
const hayDatosDeposito = computed(() => !empresa.value
    || empresa.value.cuentas_deposito.length > 0
    || Boolean(empresa.value.instrucciones_pago))
</script>

<template>
    <div class="flex flex-col gap-4">
        <template v-if="cargando">
            <USkeleton class="h-5 w-1/3" />
            <USkeleton class="h-8 w-2/3" />
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-12 w-full" />
        </template>

        <UAlert
            v-else-if="status === 'error' || !corte || !mensaje"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos consultar tu servicio"
            description="Revisa tu conexión e intenta de nuevo en unos segundos."
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => refresh() }]"
        />

        <CorteServicioReactivado
            v-else-if="reactivado"
            :url="seguirNavegandoUrl"
        />

        <template v-else>
            <div>
                <p
                    v-if="corte.nombre_parcial"
                    class="text-sm text-muted"
                >
                    Hola, {{ corte.nombre_parcial }}
                </p>
                <h1 class="mt-1 text-2xl font-semibold text-balance text-highlighted">
                    {{ mensaje.titulo }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    {{ mensaje.descripcion }}
                </p>
            </div>

            <CorteResumenDeuda
                v-if="identificado"
                :corte="corte"
            />

            <UAlert
                v-if="promesa?.resultado === 'aprobada'"
                color="success"
                variant="subtle"
                icon="i-lucide-circle-check"
                title="Promesa de pago aprobada"
                :description="`Pagarás ${formatearQuetzales(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}. Estamos reactivando tu servicio.`"
                data-testid="promesa-aprobada"
            />
            <UAlert
                v-else-if="promesa?.resultado === 'pendiente_aprobacion'"
                color="warning"
                variant="subtle"
                icon="i-lucide-hourglass"
                title="Tu promesa está pendiente de aprobación"
                :description="promesa.motivo"
                data-testid="promesa-pendiente-corte"
            />

            <div
                v-if="!retirado"
                class="flex flex-col gap-2"
            >
                <!-- Apagado hasta la semana 2: neutro, no el azul primario, y dice que llega pronto. -->
                <UButton
                    data-testid="pagar-en-linea"
                    label="Pagar en línea"
                    icon="i-lucide-credit-card"
                    color="neutral"
                    variant="soft"
                    size="xl"
                    block
                    disabled
                    aria-describedby="pagar-en-linea-pronto"
                >
                    <template #trailing>
                        <UBadge
                            label="Pronto"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="ms-auto"
                        />
                    </template>
                </UButton>
                <p
                    id="pagar-en-linea-pronto"
                    class="-mt-1 text-center text-xs text-muted"
                >
                    El pago en línea llega pronto. Mientras tanto, paga en nuestra oficina o por depósito.
                </p>
                <UButton
                    v-if="hayDatosDeposito"
                    label="Ver datos de depósito"
                    icon="i-lucide-landmark"
                    size="xl"
                    block
                    @click="verDeposito = true"
                />
                <UButton
                    label="Subir comprobante de depósito"
                    icon="i-lucide-upload"
                    color="neutral"
                    variant="outline"
                    size="xl"
                    block
                    disabled
                />
                <UButton
                    v-if="puedePedirPromesa"
                    data-testid="solicitar-promesa"
                    label="Solicitar promesa de pago"
                    icon="i-lucide-hand-coins"
                    color="neutral"
                    variant="outline"
                    size="xl"
                    block
                    @click="verPromesa = true"
                />
                <p class="text-center text-xs text-muted">
                    Subir el comprobante estará disponible pronto.
                </p>
            </div>

            <CorteEstadoEnVivo
                v-if="puedeVigilar"
                :vigilando="vigilando"
                :agotado="agotado"
                @revisar="vigilarEstado"
            />

            <UButton
                v-if="identificado"
                data-testid="ver-mi-cuenta"
                label="Ver mis facturas y pagos"
                icon="i-lucide-receipt"
                color="neutral"
                variant="outline"
                size="lg"
                to="/entrar?por_ip=1"
                block
            />

            <UButton
                data-testid="contacto-corte"
                :label="contacto.label"
                :icon="contacto.icon"
                :to="contacto.to"
                color="neutral"
                variant="ghost"
                size="lg"
                block
            />
            <UButton
                v-if="contacto.to !== '/contacto'"
                label="Más formas de contacto y horario"
                color="neutral"
                variant="link"
                size="sm"
                to="/contacto"
                class="-mt-3 self-center"
            />

            <p
                v-if="!identificado"
                class="text-center text-xs text-dimmed"
            >
                Conexión desde {{ corte.ip }}
            </p>
        </template>

        <CorteDatosDeposito v-model:open="verDeposito" />
        <PromesaSolicitar
            v-model:open="verPromesa"
            @resultado="promesaResuelta"
        />
    </div>
</template>
