let audioContext;
let audioWarningLogged = false;

function logAudioFailure(error) {
  if (audioWarningLogged) return;
  audioWarningLogged = true;
  console.warn('Feedback sonoro indisponível:', error);
}

function playButtonSound() {
  const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextType) {
    logAudioFailure(new Error('Web Audio API não disponível'));
    return;
  }

  try {
    audioContext ||= new AudioContextType();
    const context = audioContext;
    const play = () => {
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(620, start);
        gain.gain.setValueAtTime(0.035, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.06);
      } catch (error) {
        logAudioFailure(error);
      }
    };

    if (context.state === 'suspended') {
      context.resume().then(play).catch(logAudioFailure);
    } else {
      play();
    }
  } catch (error) {
    logAudioFailure(error);
  }
}

export function installButtonSoundFeedback(doc = document) {
  doc.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest('button, [role="button"]');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return;
    playButtonSound();
  }, true);
}
