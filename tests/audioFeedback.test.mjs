import assert from 'node:assert/strict';
import test from 'node:test';

import { installButtonSoundFeedback } from '../lib/audioFeedback.js';

class FakeElement {
  constructor({ disabled = false, ariaDisabled = null, selector = 'button' } = {}) {
    this.disabled = disabled;
    this.ariaDisabled = ariaDisabled;
    this.selector = selector;
  }

  closest(selector) { return selector.includes(this.selector) ? this : null; }
  matches(selector) { return selector === this.selector; }

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

test('plays sound for actionable controls and ignores disabled controls', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalElement = globalThis.Element;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.Element = FakeElement;

  try {
    const listeners = new Map();
    installButtonSoundFeedback({
      addEventListener(type, listener, capture) {
        assert.equal(capture, true);
        listeners.set(type, listener);
      },
    });

    const click = listeners.get('click');
    click({ target: new FakeElement({ disabled: true }) });
    assert.equal(FakeAudioContext.instances.length, 0);

    for (const selector of [
      'button',
      'summary',
      'a[href]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      '.category-header',
      '.result-card',
    ]) {
      click({ target: new FakeElement({ selector }) });
    }
    click({ target: new FakeElement({ selector: 'details' }) });
    click({ target: new FakeElement({ selector: 'input[type="search"]' }) });
    listeners.get('change')({
      target: new FakeElement({ selector: 'select' }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const [context] = FakeAudioContext.instances;
    assert.equal(context.oscillators.length, 8);
    assert.ok(context.oscillators.every((oscillator) => oscillator.started && oscillator.stopped));

    click({ target: new FakeElement({ ariaDisabled: 'true' }) });
    listeners.get('change')({
      target: new FakeElement({ disabled: true, selector: 'select' }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.oscillators.length, 8);
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});
