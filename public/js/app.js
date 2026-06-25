document.addEventListener('DOMContentLoaded', () => {
  // Auto-dismiss alerts after 5s
  document.querySelectorAll('.alert').forEach(el => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(el);
      if (bsAlert) bsAlert.close();
    }, 5000);
  });

  // Confirm destructive actions
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', e => {
      if (!confirm(el.dataset.confirm || 'Are you sure?')) {
        e.preventDefault();
      }
    });
  });

  // Client-side photo size check
  document.querySelectorAll('input[data-max-kb]').forEach(input => {
    input.addEventListener('change', () => {
      const maxKb = parseInt(input.dataset.maxKb, 10);
      const warn = document.getElementById(input.dataset.warnId);
      if (input.files[0]) {
        const sizeKb = input.files[0].size / 1024;
        if (warn) {
          if (sizeKb > maxKb) {
            warn.textContent = `File too large (${sizeKb.toFixed(0)} KB). Maximum is ${maxKb} KB.`;
            warn.style.display = 'block';
            input.value = '';
          } else {
            warn.style.display = 'none';
          }
        }
      }
    });
  });

  // Show file size next to photo inputs
  document.querySelectorAll('input[type="file"][data-show-size]').forEach(input => {
    input.addEventListener('change', () => {
      const sizeEl = document.getElementById(input.dataset.showSize);
      if (sizeEl && input.files[0]) {
        const kb = (input.files[0].size / 1024).toFixed(1);
        sizeEl.textContent = `Selected: ${kb} KB`;
      }
    });
  });

  // Show/hide password toggles — any button with [data-toggle-password]
  // flips the type of the input named in its data-target attribute.
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.querySelector('i')?.classList.toggle('bi-eye', showing);
      btn.querySelector('i')?.classList.toggle('bi-eye-slash', !showing);
      btn.setAttribute('aria-label', showing ? btn.dataset.showLabel || 'Show password' : btn.dataset.hideLabel || 'Hide password');
    });
  });

  // Search-as-you-type: any input[data-autosearch] resubmits its (GET)
  // form after a short pause in typing, instead of requiring a "Search"
  // button click + full page reload per keystroke. Other filter controls
  // in the same form (selects etc.) already auto-submit on change.
  document.querySelectorAll('input[data-autosearch]').forEach(input => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (input.form.requestSubmit) input.form.requestSubmit();
        else input.form.submit();
      }, 450);
    });
  });

  // One-click copy buttons (e.g. generated passwords) — copies the text of
  // the element named in data-copy-target and shows a brief confirmation.
  document.querySelectorAll('[data-copy-target]').forEach(btn => {
    const target = document.getElementById(btn.dataset.copyTarget);
    if (!target) return;
    btn.addEventListener('click', async () => {
      const text = target.value !== undefined ? target.value : target.textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        // Fallback for browsers/contexts without Clipboard API access
        target.select?.();
        document.execCommand('copy');
      }
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check-lg"></i> Copied';
      btn.disabled = true;
      setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1800);
    });
  });

  initVoiceInput();
});

// ─── Speak-to-fill (Web Speech API) ────────────────────────────────────────
function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Maps the app's language chips to BCP-47 locales for recognition.
  const LANG_MAP = {
    EN: 'en-IN', 'English': 'en-IN',
    'हिंदी': 'hi-IN',
    'ગુજરાતી': 'gu-IN',
    'मराठी': 'mr-IN',
    'తెలుగు': 'te-IN',
  };

  function currentLang() {
    const active = document.querySelector('.lang-btn.active, .auth-lang-chip.active, .em-lang-chip.active');
    const stored = localStorage.getItem('voiceLang');
    if (active) return LANG_MAP[active.textContent.trim()] || stored || 'en-IN';
    return stored || 'en-IN';
  }

  const micButtons = document.querySelectorAll('.mic-btn, .em-mic');

  if (!SpeechRecognition) {
    // No browser support — hide mic buttons rather than offer a dead control.
    micButtons.forEach(btn => { btn.style.display = 'none'; });
    return;
  }

  micButtons.forEach(btn => {
    if (btn.dataset.voiceBound) return;
    btn.dataset.voiceBound = '1';

    const wrap = btn.closest('.input-voice-wrap, .em-input-wrap');
    const field = wrap?.querySelector('.form-control, .form-select, .em-input');
    if (!field) return;

    let recognition = null;
    let listening = false;

    btn.addEventListener('click', () => {
      if (listening) {
        recognition && recognition.stop();
        return;
      }

      recognition = new SpeechRecognition();
      recognition.lang = currentLang();
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.addEventListener('start', () => {
        listening = true;
        btn.classList.add('listening');
        btn.setAttribute('title', 'Listening… tap to stop');
      });

      recognition.addEventListener('result', (e) => {
        const transcript = e.results[0][0].transcript.trim();
        if (!transcript) return;
        if (field.tagName === 'SELECT') {
          const match = Array.from(field.options).find(
            o => o.text.toLowerCase().includes(transcript.toLowerCase())
          );
          if (match) field.value = match.value;
        } else {
          field.value = field.value ? `${field.value} ${transcript}` : transcript;
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });

      recognition.addEventListener('error', (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          alert('Microphone access was blocked. Please allow microphone permission to use speak-to-fill.');
        }
      });

      recognition.addEventListener('end', () => {
        listening = false;
        btn.classList.remove('listening');
        btn.setAttribute('title', 'Speak to fill');
      });

      try {
        recognition.start();
      } catch (err) {
        listening = false;
        btn.classList.remove('listening');
      }
    });
  });

  // Remember the chosen language for recognition across pages.
  document.querySelectorAll('.lang-btn, .auth-lang-chip, .em-lang-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const code = LANG_MAP[chip.textContent.trim()];
      if (code) localStorage.setItem('voiceLang', code);
    });
  });
}
