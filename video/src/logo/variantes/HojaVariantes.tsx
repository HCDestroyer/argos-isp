import { AbsoluteFill } from 'remotion'
import { COLOR, FUENTE } from '../../estilo/tema'
import { LogoArgos, Wordmark } from '../LogoArgos'
import { LOGO_ELEGIDO, VARIANTES } from '../geometria'

/**
 * Hoja de comparación de variantes (composición "LogoVariantes"): cada una en
 * neón, plana a 32 px y a 16 px, para revisar legibilidad.
 */
export function HojaVariantes() {
    return (
        <AbsoluteFill style={{ background: COLOR.fondo, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
            {VARIANTES.map((def) => (
                <div key={def.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36 }}>
                    <LogoArgos definicion={def} tamano={300} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                        <LogoArgos definicion={def} tamano={32} neon={false} color={COLOR.texto} />
                        <LogoArgos definicion={def} tamano={16} neon={false} color={COLOR.texto} />
                        <div style={{ background: '#ffffff', padding: 8, borderRadius: 8, display: 'flex' }}>
                            <LogoArgos definicion={def} tamano={32} neon={false} color="#0b0d14" />
                        </div>
                    </div>
                    <Wordmark tamano={56} />
                    <span
                        style={{
                            fontFamily: FUENTE.mono,
                            fontSize: 22,
                            color: def.id === LOGO_ELEGIDO.id ? COLOR.cian : COLOR.textoSuave,
                        }}
                    >
                        {def.nombre}
                        {def.id === LOGO_ELEGIDO.id ? ' · elegida' : ''}
                    </span>
                </div>
            ))}
        </AbsoluteFill>
    )
}
