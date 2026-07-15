import { useRef, useState, useCallback } from 'react'

export type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'review'

export interface UseAudioRecorderReturn {
    phase: RecorderPhase
    timerSeconds: number
    barHeights: number[]
    previewUrl: string | null
    recordedBlob: Blob | null
    startRecording: () => Promise<void>
    stopRecording: () => void
    resetRecording: () => void
    cancelRecording: () => void
    cancelAll: () => void
    error: string | null
}

export function useAudioRecorder(): UseAudioRecorderReturn {
    // UI State
    const [phase, setPhase] = useState<RecorderPhase>('idle')
    const [timerSeconds, setTimerSeconds] = useState(0)
    const [barHeights, setBarHeights] = useState<number[]>(Array(7).fill(3))

    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animFrameRef = useRef<number | null>(null)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const chunksRef = useRef<Blob[]>([])
    // This collects audio chunks as they come in from MediaRecorder


    const startWaveform = useCallback(async (stream: MediaStream) => {
        const audioCtx = new AudioContext()

        // Safari starts AudioContext supsended, force resume
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume()
        }

        const source = audioCtx.createMediaStreamSource(stream)

        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        // fftSize controls frequency resolution, 256 should be lightweigh. Reduce if needed.

        source.connect(analyser)

        audioContextRef.current = audioCtx
        analyserRef.current = analyser

        const dataArray = new Uint8Array(analyser.frequencyBinCount)

        const loop = () => {
            analyser.getByteFrequencyData(dataArray)
            // frequency data (not time domain) - lets each bar show a different band

            const binCount = dataArray.length
            const barsToShow = 7
            // sample 7 evenly-spaced frequency bins across the low-mid range
            // (voice energy lives roughly in the lower half of the spectrum)
            const usefulBins = Math.floor(binCount * 0.6)

            const heights = Array.from({ length: barsToShow }, (_, i) => {
                const binIndex = Math.floor((i / barsToShow) * usefulBins)
                const value = dataArray[binIndex] / 255
                // normalise 0–255 to 0–1

                return Math.max(3, Math.min(40, value * 80))
                // 80 is the sensitivity - raise for quieter mics, lower if it pins at 40
            })

            setBarHeights(heights)
            animFrameRef.current = requestAnimationFrame(loop)
        }

        animFrameRef.current = requestAnimationFrame(loop)
        // kick off the first frame
    }, [])
    // empty dependency array - this function never needs to be recreated

    const stopWaveform = useCallback(() => {
        if (animFrameRef.current !== null) {
            cancelAnimationFrame(animFrameRef.current)
            // stops the loop - without this it keeps running forever
            animFrameRef.current = null
        }
        audioContextRef.current?.close()
        // close() releases the audio hardware - important to not leak resources
        audioContextRef.current = null
        setBarHeights(Array(7).fill(3))
        // reset bars to flat when not recording
    }, [])


    const startTimer = useCallback(() => {
        setTimerSeconds(0)
        timerRef.current = setInterval(() => {
            setTimerSeconds(s => s + 1)
        }, 1000)
    }, [])

    const stopTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
    }, [])


    const startRecording = useCallback(async () => {
        setError(null)
        setPhase('requesting')
        // show requesting phase while permission dialog is open

        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch {
            setError('Microphone permission denied')
            setPhase('idle')
            return
            // bail out entirely if permission denied
        }

        streamRef.current = stream
        chunksRef.current = []
        // reset chunks array for fresh recording

        const recorder = new MediaRecorder(stream)
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data)
            // only push non-empty chunks - sometimes the last chunk is empty
        }

        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
            // combine all chunks into one blob
            // mimeType will be 'audio/webm;codecs=opus' on Chrome, 'audio/mp4' on Safari

            const url = URL.createObjectURL(blob)
            // creates a local browser URL like blob:http://localhost:5173/abc123
            // used as the src for the preview <audio> element

            setRecordedBlob(blob)
            setPreviewUrl(url)
            setPhase('review')

            stream.getTracks().forEach(t => t.stop())
            // IMPORTANT: stops mic tracks so browser turns off mic indicator
            streamRef.current = null
        }

        recorder.start(100)
        // 100ms interval for ondataavailable
        // smaller = more responsive stop, larger = fewer events
        // 100ms is a good balance

        await startWaveform(stream)
        startTimer()
        setPhase('recording')
    }, [startWaveform, startTimer])


    const stopRecording = useCallback(() => {
        stopWaveform()
        stopTimer()
        mediaRecorderRef.current?.stop()
        // .stop() triggers onstop which sets phase to 'review'
        mediaRecorderRef.current = null
    }, [stopWaveform, stopTimer])

    const resetRecording = useCallback(async () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
            // IMPORTANT: revoke the old blob URL to free memory
            // blob URLs stay in memory until you explicitly revoke them
        }
        setPreviewUrl(null)
        setRecordedBlob(null)
        chunksRef.current = []
        await startRecording()
        // go straight back into recording
    }, [previewUrl, startRecording])

    const cancelAll = useCallback(() => {
        stopWaveform()
        stopTimer()

        // Null out the callbacks BEFORE calling .stop()
        // so onstop doesn't fire and set phase to 'review'
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.ondataavailable = null
            mediaRecorderRef.current.onstop = null
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current = null
        }

        // Kill the mic stream so browser mic indicator turns off
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop())
            streamRef.current = null
        }

        if (previewUrl) URL.revokeObjectURL(previewUrl)

        setPreviewUrl(null)
        setRecordedBlob(null)
        setPhase('idle')
        chunksRef.current = []
    }, [stopWaveform, stopTimer, previewUrl])

    const cancelRecording = useCallback(() => {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
        setRecordedBlob(null)
        setPhase('idle')
        chunksRef.current = []
    }, [previewUrl])


    return {
        phase,
        timerSeconds,
        barHeights,
        previewUrl,
        recordedBlob,
        startRecording,
        stopRecording,
        resetRecording,
        cancelRecording,
        cancelAll,
        error,
    }

}