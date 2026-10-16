import { AbsoluteFill, Composition, Still } from 'remotion'
import { Grilla } from './estilo/Grilla'
import { COLOR } from './estilo/tema'
import { ALTO, ANCHO, CAPTURAS, DURACION_TOTAL, FPS, type IdCaptura, LINEA_DE_TIEMPO } from './guion'
import { LogoArgos, Wordmark } from './logo/LogoArgos'
import { HojaVariantes } from './logo/variantes/HojaVariantes'
import { CapturaRelleno } from './relleno/CapturaRelleno'
import { COMPONENTES, Tour } from './Tour'

export function Root() {
    return (
        <>
            {/* El video completo */}
            <Composition id="Tour" component={Tour} durationInFrames={DURACION_TOTAL} fps={FPS} width={ANCHO} height={ALTO} defaultProps={{ conAudio: true }} />

            {/* Cada escena sola, para iterar en el Studio */}
            {LINEA_DE_TIEMPO.map((escena) => {
                const Componente = COMPONENTES[escena.id]
                const EscenaSola = () => (
                    <AbsoluteFill style={{ background: COLOR.fondo }}>
                        <Grilla intensidad={escena.grilla} avance={0} />
                        <Componente escena={escena} />
                    </AbsoluteFill>
                )
                return (
                    <Composition
                        key={escena.id}
                        id={`Escena-${escena.id}`}
                        component={EscenaSola}
                        durationInFrames={escena.frames}
                        fps={FPS}
                        width={ANCHO}
                        height={ALTO}
                    />
                )
            })}

            {/* Capturas de relleno: `pnpm capturas:relleno` las exporta a public/capturas */}
            {(Object.keys(CAPTURAS) as IdCaptura[]).map((id) => (
                <Still
                    key={id}
                    id={`Relleno-${id}`}
                    component={CapturaRelleno}
                    width={CAPTURAS[id].ancho}
                    height={CAPTURAS[id].alto}
                    defaultProps={{ id }}
                />
            ))}

            {/* Logo */}
            <Still id="LogoVariantes" component={HojaVariantes} width={ANCHO} height={ALTO} />
            <Still
                id="LogoMarca"
                component={() => (
                    <AbsoluteFill style={{ background: COLOR.fondo, alignItems: 'center', justifyContent: 'center', gap: 40, flexDirection: 'row' }}>
                        <LogoArgos tamano={220} />
                        <Wordmark tamano={150} />
                    </AbsoluteFill>
                )}
                width={ANCHO}
                height={ALTO / 2}
            />
            {/* Símbolo solo sobre fondo oscuro, 1024 px (logo.png) */}
            <Still
                id="LogoSolo"
                component={() => (
                    <AbsoluteFill style={{ background: COLOR.fondo, alignItems: 'center', justifyContent: 'center' }}>
                        <LogoArgos tamano={640} />
                    </AbsoluteFill>
                )}
                width={1024}
                height={1024}
            />
        </>
    )
}
