// Audio, Vibration & Voice Wake-Up Engine for BusAwake
class AlarmEngine {
  constructor() {
    this.audioCtx = null;
    this.isVibrating = false;
    this.isPlayingSound = false;
    this.vibrationInterval = null;
    this.soundInterval = null;
    this.currentSoundType = 'bus_bell';
    this.isUnlocked = false;
  }

  // Pre-warms Web Audio and SpeechSynthesis during user interaction (Start Trip / Test click)
  unlockAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && !this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      if ('speechSynthesis' in window) {
        // Prime speech synthesis with a silent utterance
        const silentUtterance = new SpeechSynthesisUtterance(' ');
        silentUtterance.volume = 0.01;
        window.speechSynthesis.speak(silentUtterance);
      }
      this.isUnlocked = true;
    } catch (e) {
      console.warn('[AlarmEngine] Unlock audio warning:', e);
    }
  }

  // Multi-pulse rhythmic vibration designed to wake user through pocket or bag
  startVibration() {
    if (this.isVibrating) return;
    this.isVibrating = true;

    const pattern = [1200, 300, 1200, 300, 1600, 400];

    const pulse = () => {
      if (navigator.vibrate && this.isVibrating) {
        navigator.vibrate(pattern);
      }
    };

    pulse();
    if (this.vibrationInterval) clearInterval(this.vibrationInterval);
    this.vibrationInterval = setInterval(pulse, 3800);
  }

  stopVibration() {
    this.isVibrating = false;
    if (this.vibrationInterval) {
      clearInterval(this.vibrationInterval);
      this.vibrationInterval = null;
    }
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }
  }

  // Get or init audio context
  getAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioCtx) {
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // 1. Bus Double-Bell (Ding... Ding!) - authentic bus conductor bell
  playBusBell() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const strikes = [0, 0.28];
      strikes.forEach((startTimeOffset) => {
        const t = now + startTimeOffset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Bell fundamental frequency (1800Hz with high overtone)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1760, t);
        osc.frequency.exponentialRampToValueAtTime(1720, t + 0.3);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.35, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.46);
      });
    } catch (e) {
      console.warn('[AlarmEngine] Bus bell error:', e);
    }
  }

  // 2. Urgent High-Visibility Siren (two alternating piercing tones)
  playSiren() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      // Siren warble between 880Hz and 660Hz
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.linearRampToValueAtTime(660, now + 0.2);
      osc.frequency.linearRampToValueAtTime(880, now + 0.4);
      osc.frequency.linearRampToValueAtTime(660, now + 0.6);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.76);
    } catch (e) {
      console.warn('[AlarmEngine] Siren error:', e);
    }
  }

  // 3. Melodic Harmonic Chime
  playMelodicChime() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const frequencies = [659.25, 830.61, 987.77, 1318.51];

      frequencies.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const noteGain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + index * 0.12);

        const startTime = now + index * 0.12;
        noteGain.gain.setValueAtTime(0.0001, startTime);
        noteGain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.04);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.75);

        osc.connect(noteGain);
        noteGain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.8);
      });
    } catch (e) {
      console.warn('[AlarmEngine] Melodic chime error:', e);
    }
  }

  playCurrentTone(soundType = this.currentSoundType) {
    if (soundType === 'siren') {
      this.playSiren();
    } else if (soundType === 'melodic') {
      this.playMelodicChime();
    } else {
      this.playBusBell();
    }
  }

  startSound(soundType = 'bus_bell') {
    if (this.isPlayingSound) return;
    this.isPlayingSound = true;
    this.currentSoundType = soundType;

    this.playCurrentTone(soundType);

    if (this.soundInterval) clearInterval(this.soundInterval);
    const intervalMs = soundType === 'siren' ? 1200 : 2200;
    this.soundInterval = setInterval(() => {
      if (this.isPlayingSound) {
        this.playCurrentTone(this.currentSoundType);
      }
    }, intervalMs);
  }

  stopSound() {
    this.isPlayingSound = false;
    if (this.soundInterval) {
      clearInterval(this.soundInterval);
      this.soundInterval = null;
    }
  }

  // Text-To-Speech (TTS) Voice Announcement
  speak(text, lang = 'en-IN') {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // clear previous speech queue
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.volume = 1.0;
      utterance.rate = 1.0;
      utterance.pitch = 1.05;

      // Select natural sounding voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v => (v.lang === lang || v.lang.startsWith('en')) && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('India')));
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[AlarmEngine] TTS speech notice:', e);
    }
  }

  // Unified start
  start(soundEnabled = false, soundType = 'bus_bell') {
    this.startVibration();
    if (soundEnabled) {
      this.startSound(soundType);
    }
  }

  // Unified stop
  stop() {
    this.stopVibration();
    this.stopSound();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

window.alarmEngine = new AlarmEngine();
