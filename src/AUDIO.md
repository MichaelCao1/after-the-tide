# Procedural station audio

`GameAudio` uses native Web Audio only. It never accesses microphones or makes network requests. Gameplay records sound-event descriptors and re-emits them at the recorder position; this module synthesizes those events, not gameplay logic.

- Construction: `new GameAudio((text, pos, kind) => showCaption(text,pos,kind))`
- First click: `await audio.unlock()`; unsupported Web Audio returns false. Visual/caption feedback remains functional.
- Frame: `listener(camera.position, cameraForward)`; `update(dt,{pumpActive,pumpPos,motorActive,motorPos,threatActive,threatPos})`.
- Sound: `emit('metal', position, {strength:1, replay:false, occluded:false, caption:true})`.
- Pause: `setPaused(true)` suspends AudioContext, including tails and loops. Game must separately freeze game clock, threat and recorder timers.
- Resume: `setPaused(false)`. Volume accepts 0..1. `stop()` closes the context for teardown.

Sound events include concrete and metal footsteps, splashes, metallic knocks, pump and motor activity, valve detents, switches, recorder actions, the submerged presence, failure and the ending.

Spatialization uses HRTF panning, inverse-distance attenuation and a short, generated diffuse-room impulse response. The continuous pump loop is low-passed to 145 Hz when its vertical separation from the listener exceeds 2 m, and 880 Hz otherwise. Replayed events are speaker-bandlimited and include tape hiss and a capstan-click signature. Ambient and machinery loops provide station air, surf, pump, motor and moving-water layers; spatial sources use world coordinates. No tonal music masks directional clues. Labelled event caption callbacks run before the audio-context availability check, including when volume is zero; the `blocked` event intentionally has no sound caption.

## Validation

- The offline verification runner covers sound-event recording, relocated playback, threat response, and pause/recovery logic. Its browser/audio substitutes do not validate actual Web Audio output.
- Real Chrome checks cover the entry interface, language switching, station labels and on-screen feedback. They do not establish headphone spatial accuracy, audible pause/resume behaviour or calibrated sound levels.
- Real-device listening, directional hearing and audible pause/resume remain **unverified**. The `AudioContext` suspension calls and synthesis parameters describe the implementation, not a measured listening result.
- See [KNOWN-LIMITS.md](../KNOWN-LIMITS.md) and [LOCALIZATION-QA.md](../tests/LOCALIZATION-QA.md) for the current validation scope.
