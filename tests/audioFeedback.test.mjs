import assert from 'node:assert/strict';
import test from 'node:test';

import { installButtonSoundFeedback } from '../lib/audioFeedback.js';

class FakeElement {
  constructor({ disabled = false, ariaDisabled = null } = {}) {
    this.disabled = disabled;
    this.ariaDisabled = ariaDisabled;
  }

  closest() { return this; }

  getAttribute(name) {
    return name === 'aria-disabled' ? this.ariaDisabled : null;
  }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.state = 'suspended';
    this.currentTime = 1;
    this.destination = {};
    this.oscillators = [];
    FakeAudioContext.instances.push(this);
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  createOscillator() {
    const oscillator = {
      frequency: { setValueAtTime() {} },
      connect() {},
      start() { this.started = true; },
      stop() { this.stopped = true; },
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
}

test('plays sound on enabled buttons and ignores disabled controls', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalElement = globalThis.Element;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.Element = FakeElement;

  try {
    let clickListener;
    installButtonSoundFeedback({
      addEventListener(type, listener, capture) {
        assert.equal(type, 'click');
        assert.equal(capture, true);
        clickListener = listener;
      },
    });

    clickListener({ target: new FakeElement({ disabled: true }) });
    assert.equal(FakeAudioContext.instances.length, 0);

    clickListener({ target: new FakeElement() });
    await new Promise((resolve) => setImmediate(resolve));
    const [context] = FakeAudioContext.instances;
    assert.equal(context.oscillators.length, 1);
    assert.equal(context.oscillators[0].started, true);
    assert.equal(context.oscillators[0].stopped, true);
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});
