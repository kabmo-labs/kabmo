/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The microphone constraints dictation asks for — one module, because
 * `echoCancellation: false` is a REQUIREMENT on macOS, not a preference, and a
 * second copy of this object is how that requirement gets lost.
 *
 * ## Why echo cancellation is off
 *
 * In WebKit, `echoCancellation: true` (which is also the default when the field
 * is omitted) makes the capture unit a VoiceProcessingIO unit rather than a
 * HALOutput one. On macOS WebKit then binds the microphone to that unit with
 * `kAudioOutputUnitProperty_CurrentDevice`, and on a real machine the bind can
 * fail: measured on macOS 27 / arm64 with the default input `JeteMic M1`
 * (CoreAudio device 53),
 *
 * ```
 * com.apple.WebKit.GPU: CoreAudioCaptureUnit::setupAudioUnit(...) unable to set
 * capture unit capture device ID 53, error -10851
 * com.apple.WebKit.GPU: BaseAudioCaptureUnit::captureFailed
 * ```
 *
 * -10851 is `kAudioUnitErr_InvalidPropertyValue`. `captureFailed` ends the
 * track (`RealtimeMediaSource::captureFailed` → `end()`), so the page's stream
 * delivers nothing but zeros — and the composer reported that as "No speech was
 * detected in that recording.", which describes a microphone fault as a user
 * fault. `echoCancellation: false` takes the HALOutput path, which binds the
 * same device without error.
 *
 * Nothing in dictation plays audio back, and the capture graph is muted before
 * `AudioContext.destination` (`speech-to-text.ts`), so there is no echo path to
 * cancel. `noiseSuppression` and `autoGainControl` do not select the unit — only
 * `echoCancellation` does — and both stay on for a laptop microphone in a room.
 */

/** Constraints for one dictation capture; `deviceId` is the stored preference. */
export function dictationAudioConstraints(deviceId = ''): MediaTrackConstraints {
  const id = deviceId.trim();
  return {
    ...(id ? { deviceId: { exact: id } } : {}),
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
  };
}
