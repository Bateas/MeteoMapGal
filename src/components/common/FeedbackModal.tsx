import { useState, useEffect, useCallback, useRef } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useToastStore } from '../../store/toastStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { postFeedbackWebhook } from '../../api/webhookClient';
import { sanitize, VALID_TYPES, MAX_CHARS } from '../../services/feedbackSanitize';
import { APP_VERSION } from '../../config/version';
import type { FeedbackType } from '../../services/feedbackSanitize';
import { WeatherIcon } from '../icons/WeatherIcons';

const TYPE_LABELS: Record<FeedbackType, string> = {
  sugerencia: 'Sugerencia',
  bug: 'Bug / Error',
  otro: 'Otro',
};

const MAX_SUBMISSIONS_PER_DAY = 3;
const MIN_SUBMIT_INTERVAL_MS = 5_000;
const STORAGE_KEY = 'meteomap-feedback-count';

function getDailyCount(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const { date, count } = JSON.parse(raw);
    if (date !== new Date().toISOString().slice(0, 10)) return 0;
    return count;
  } catch {
    return 0;
  }
}

function incrementDailyCount(): void {
  const today = new Date().toISOString().slice(0, 10);
  const current = getDailyCount();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: current + 1 }));
}

export function FeedbackModal() {
  const open = useUIStore((s) => s.feedbackOpen);
  const setOpen = useUIStore((s) => s.setFeedbackOpen);
  const prefill = useUIStore((s) => s.feedbackPrefill);
  const setPrefill = useUIStore((s) => s.setFeedbackPrefill);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const addToast = useToastStore((s) => s.addToast);

  const [type, setType] = useState<FeedbackType>('sugerencia');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastSubmitRef = useRef(0);

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open);

  const resetForm = useCallback(() => {
    setType('sugerencia');
    setMessage('');
    setHoneypot('');
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Consume a pre-fill (e.g. "Sugerir este spot" with coords) once on open.
  useEffect(() => {
    if (open && prefill) {
      setType(prefill.type);
      setMessage(prefill.text.substring(0, MAX_CHARS));
      setPrefill(null);
    }
  }, [open, prefill, setPrefill]);

  const handleSubmit = useCallback(async () => {
    if (honeypot) return;

    const now = Date.now();
    if (now - lastSubmitRef.current < MIN_SUBMIT_INTERVAL_MS) {
      addToast('Espera unos segundos antes de enviar de nuevo', 'warning');
      return;
    }

    const clean = sanitize(message);
    if (clean.length < 10) {
      addToast('Escribe al menos 10 caracteres', 'warning');
      return;
    }

    const safeType = VALID_TYPES.includes(type) ? type : 'otro' as FeedbackType;

    if (getDailyCount() >= MAX_SUBMISSIONS_PER_DAY) {
      addToast('Límite diario alcanzado (3 envíos al día)', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await postFeedbackWebhook({
        type: safeType,
        text: clean,
        sector: sectorId,
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        website: honeypot,
      });
      lastSubmitRef.current = Date.now();
      incrementDailyCount();
      addToast('Enviado. Gracias por tu opinión', 'success');
      resetForm();
      setOpen(false);
    } catch {
      addToast('No se pudo enviar. Prueba en un rato.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [type, message, honeypot, sectorId, addToast, resetForm, setOpen]);

  if (!open) return null;

  const remaining = MAX_CHARS - message.length;

  return (
    <div
      ref={focusTrapRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gc-feedback-title"
    >
      <div className="gc-scrim" onClick={() => setOpen(false)} />

      <div className="g-theme gc-dialog">
        <div className="gc-dialog-head">
          <h2 id="gc-feedback-title">Tu opinión</h2>
          <button type="button" onClick={() => setOpen(false)} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar">
            <WeatherIcon id="x" size={16} />
          </button>
        </div>

        <div className="gc-dialog-body">
          <div className="gc-seg" role="group" aria-label="Tipo de mensaje" style={{ alignSelf: 'flex-start' }}>
            {VALID_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.substring(0, MAX_CHARS))}
              placeholder="Escribe tu idea, sugerencia o problema"
              aria-label="Tu mensaje"
              rows={4}
              maxLength={MAX_CHARS}
              className="gc-field"
            />
            <p className="gc-small" style={{ textAlign: 'right', fontWeight: remaining < 30 ? 700 : undefined }}>
              Quedan {remaining} caracteres
            </p>
          </div>

          <input
            type="text"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }}
            aria-hidden="true"
          />

          <p className="gc-small">Anónimo, sin datos personales. Máximo 3 envíos al día.</p>
        </div>

        <div className="gc-dialog-foot">
          <button type="button" onClick={() => setOpen(false)} className="gc-btn gc-btn--plain">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={message.trim().length < 10 || isSubmitting}
            className="gc-btn gc-btn--primary"
          >
            {isSubmitting ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
