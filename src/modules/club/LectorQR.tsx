/**
 * LectorQR — cámara trasera + detección de QR.
 * Usa `BarcodeDetector` (Chrome/Android) y, si el navegador no lo tiene (Safari/iPhone,
 * Firefox), cae a `jsqr`, que se carga recién al abrir la cámara.
 * Siempre hay plan B en la pantalla que lo usa (código manual y búsqueda).
 */
import { useEffect, useRef, useState } from 'react'
import { Btn } from './ui'
import { C } from './estilos'

interface DetectorLike { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike
type JsQR = (data: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null

export default function LectorQR({ onDetectar, onCerrar }: { onDetectar: (texto: string) => void; onCerrar: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [motor, setMotor] = useState<string>('')
  const cbRef = useRef(onDetectar)
  useEffect(() => { cbRef.current = onDetectar }, [onDetectar])

  useEffect(() => {
    let cancelado = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    async function arrancar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no permite usar la cámara. Ingresá el código a mano.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        if (!cancelado) setError('No se pudo abrir la cámara. Revisá el permiso o ingresá el código a mano.')
        return
      }
      if (cancelado) { stream.getTracks().forEach(t => t.stop()); return }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play().catch(() => {})

      const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
      let detector: DetectorLike | null = null
      let jsqr: JsQR | null = null
      if (Ctor) {
        try { detector = new Ctor({ formats: ['qr_code'] }); setMotor('nativo') } catch { detector = null }
      }
      if (!detector) {
        const mod = await import('jsqr')
        jsqr = (mod.default ?? mod) as unknown as JsQR
        if (!cancelado) setMotor('jsqr')
      }

      const tick = async () => {
        if (cancelado || !video.videoWidth) { if (!cancelado) timer = setTimeout(tick, 200); return }
        try {
          let texto: string | null = null
          if (detector) {
            const r = await detector.detect(video)
            texto = r[0]?.rawValue ?? null
          } else if (jsqr && ctx) {
            const w = Math.min(video.videoWidth, 720)
            const h = Math.round(video.videoHeight * (w / video.videoWidth))
            canvas.width = w; canvas.height = h
            ctx.drawImage(video, 0, 0, w, h)
            const img = ctx.getImageData(0, 0, w, h)
            texto = jsqr(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
          }
          if (texto && !cancelado) {
            cancelado = true
            if (navigator.vibrate) navigator.vibrate(60)
            cbRef.current(texto)
            return
          }
        } catch { /* cuadro malo: seguimos */ }
        if (!cancelado) timer = setTimeout(tick, 200)
      }
      tick()
    }
    arrancar()

    return () => {
      cancelado = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {error ? (
        <div style={{ color: C.red, fontWeight: 600, padding: '1rem', border: `1px solid ${C.red}`, borderRadius: 8 }}>{error}</div>
      ) : (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '1 / 1' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(200,169,110,0.9)', borderRadius: 12, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: '0.8rem', textShadow: '0 1px 3px #000' }}>
            Apuntá al QR del cupón o del pase{motor ? '' : ' · abriendo cámara…'}
          </div>
        </div>
      )}
      <Btn variant="secondary" onClick={onCerrar}>Cerrar cámara</Btn>
    </div>
  )
}
