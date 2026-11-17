<script setup lang="ts">
/**
 * Términos del servicio públicos (sin sesión), renderizados en el servidor: es la «URL de las
 * condiciones del servicio» de la app de Meta. Cubren el uso del portal y de los canales de
 * mensajería, pagos y comprobantes, promesas, corte y reactivación (en términos generales: las
 * cifras dependen de la plantilla de facturación de cada servicio).
 */
const { empresa, problema, recargar } = usePoliticasEmpresa()

const nombre = computed(() => empresa.value?.nombre ?? EMPRESA_GENERICA)
const responsable = computed(() => nombreCompleto(empresa.value))

useSeoMeta({
    title: computed(() => `Términos del servicio · ${empresa.value?.nombre ?? 'Portal del cliente'}`),
    description: computed(() => `Condiciones de uso del portal del cliente y de los canales de mensajería de ${nombreLegal(empresa.value)}: pagos, comprobantes, promesas de pago, corte y reactivación del servicio.`),
})
</script>

<template>
    <PoliticaPagina
        titulo="Términos del servicio"
        actual="/terminos"
        :problema="problema"
        @reintentar="recargar()"
    >
        <p class="text-sm leading-relaxed text-default">
            Estos términos regulan el uso del portal del cliente, de la página de estado del servicio y de los canales de
            mensajería (WhatsApp, Telegram y correo) de <strong data-testid="politica-empresa">{{ responsable }}</strong>.
            Al usarlos aceptas estos términos. El plan, el precio y las demás condiciones particulares de tu servicio de
            Internet son las que acordaste al contratarlo.
        </p>

        <PoliticaSeccion titulo="1. Quién presta el servicio">
            <p>
                El servicio de Internet, el portal y los canales de mensajería los presta <strong>{{ responsable }}</strong>:
            </p>
            <PoliticaResponsable :empresa="empresa" />
        </PoliticaSeccion>

        <PoliticaSeccion titulo="2. Uso del portal">
            <ul>
                <li>
                    Desde la red de tu servicio, la página de estado te reconoce por tu conexión y muestra solo información
                    limitada: tu nombre parcial, el estado del servicio y el monto pendiente.
                </li>
                <li>
                    Para ver tus facturas, pagos y datos completos te pedimos un código que enviamos a tu correo o Telegram
                    registrados. El código es personal: no lo compartas. Quien lo use podrá ver tu cuenta mientras dure la sesión.
                </li>
                <li>Te comprometes a dar datos verdaderos y a mantener actualizados tu correo y tus teléfonos.</li>
                <li>
                    No está permitido intentar entrar a cuentas ajenas, saturar el portal con consultas automáticas ni subir
                    archivos que no sean comprobantes de pago. El portal limita las consultas para protegerse de abusos.
                </li>
                <li>
                    Procuramos que el portal esté disponible siempre, pero puede interrumpirse por mantenimiento o fallas. Si no
                    puedes usarlo, comunícate con nosotros por los medios de contacto.
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="3. Canales de mensajería">
            <ul>
                <li>
                    Por WhatsApp, Telegram y correo te enviamos avisos sobre tu cuenta: facturas, vencimientos, pagos,
                    comprobantes, promesas de pago y cambios en el estado del servicio, además de los códigos de acceso al portal.
                </li>
                <li>
                    Los avisos por WhatsApp se envían solo si aceptaste recibirlos. Puedes darte de baja en el portal, en el
                    mismo chat o pidiéndolo a la empresa. Telegram se usa solo si vinculas tu cuenta con nuestro bot, y puedes
                    desvincularla cuando quieras.
                </li>
                <li>
                    Cuando escribes a nuestros canales te atiende el personal de {{ nombre }} en su horario de atención. Estos
                    canales no sirven para emergencias.
                </li>
                <li>
                    Nunca te pediremos por chat ni por correo tu contraseña, el código de acceso al portal ni los datos de tu
                    tarjeta. No los compartas aunque te los pidan a nombre de la empresa.
                </li>
                <li>Te pedimos un trato respetuoso. Podemos dejar de atender por un canal a quien lo use para insultar, acosar o enviar contenido ilegal.</li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="4. Pagos y comprobantes">
            <ul>
                <li>
                    Puedes pagar en nuestras cajas, por depósito o transferencia a las cuentas de la empresa que aparecen en el
                    portal y, si está disponible, en línea.
                </li>
                <li>
                    Si pagas por depósito o transferencia, sube la foto o el PDF del comprobante con el monto, el banco y la
                    referencia. El comprobante queda pendiente de verificación: el pago se aplica a tus facturas cuando la
                    empresa lo verifica. Si se rechaza, te avisamos el motivo.
                </li>
                <li>
                    El pago en línea lo procesa un proveedor de pagos y se aplica cuando ese proveedor nos confirma el cobro.
                </li>
                <li>
                    Un comprobante falso o alterado se rechaza, el pago no se aplica y la empresa puede tomar las medidas
                    legales que correspondan.
                </li>
                <li>
                    Tus facturas se emiten como factura electrónica (FEL) cuando corresponde. Un error en una factura se corrige
                    con una nota de crédito o una anulación, nunca borrándola.
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="5. Promesas de pago">
            <ul>
                <li>
                    Si no puedes pagar a tiempo, puedes pedir una promesa de pago desde el portal: eliges la fecha y el monto
                    dentro de los límites de tu plan de facturación.
                </li>
                <li>
                    La promesa puede aprobarse al instante, rechazarse con su motivo o quedar pendiente de aprobación por la
                    empresa. Con la promesa aprobada, el servicio se reactiva hasta la fecha prometida.
                </li>
                <li>
                    Si no pagas en la fecha, la promesa se da por incumplida, el servicio vuelve al estado que le corresponde
                    según tus facturas y las siguientes promesas pueden tener más límites.
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="6. Corte y reactivación">
            <ul>
                <li>
                    Cada servicio tiene un plan de facturación que fija la fecha de facturación, los días de gracia, cuántas
                    facturas vencidas limitan o suspenden el servicio y, si aplica, el cargo por mora.
                </li>
                <li>
                    Con facturas vencidas según esas reglas, el servicio puede limitarse (menor velocidad) y después
                    suspenderse. Te avisamos antes por los canales que tengas registrados.
                </li>
                <li>
                    Con el servicio suspendido, al navegar llegas a la página de estado, donde ves el monto pendiente, los datos
                    para pagar y la opción de subir un comprobante o pedir una promesa.
                </li>
                <li>
                    Al registrarse tu pago o aprobarse tu promesa, el servicio se reactiva automáticamente, sin que tengas que
                    pedirlo, normalmente en pocos minutos.
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="7. Responsabilidades">
            <p>
                Tú eres responsable del uso de tu conexión y de tu cuenta del portal, de cuidar tus códigos y el equipo
                instalado, y de pagar a tiempo. Por su parte, {{ nombre }} es responsable de prestar el servicio según lo acordado, de
                aplicar correctamente tus pagos y de proteger tus datos según la
                <ULink
                    to="/privacidad"
                    class="text-primary underline underline-offset-2"
                >política de privacidad</ULink>.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="8. Cambios a estos términos">
            <p>
                Si cambiamos estos términos, publicamos la nueva versión en esta misma dirección con su fecha de vigencia. Si
                sigues usando el portal o los canales después de esa fecha, aceptas la nueva versión.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="9. Ley aplicable y contacto">
            <p>
                Estos términos se rigen por las leyes de la República de Guatemala. Para cualquier duda o reclamo, comunícate
                con nosotros por los medios de la sección 1 o de la
                <ULink
                    to="/contacto"
                    class="text-primary underline underline-offset-2"
                >página de contacto</ULink>.
            </p>
        </PoliticaSeccion>
    </PoliticaPagina>
</template>
