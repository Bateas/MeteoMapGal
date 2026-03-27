import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useToastStore } from '../../store/toastStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';

type FeedbackType = 'sugerencia' | 'bug' | 'otro';

const TYPE_LABELS: Record<FeedbackType, string> = {
  sugerencia: 'Sugerencia',
  bug: 'Bug / Error',
  otro: 'Otro',
};

const MAX_CHARS = 300;
const MAX_SUBMISSIONS_PER_DAY = 3;
const STORAGE_KEY = 'meteomap-feedback-count';
const WEBHOOK_URL = '/api/webhook/meteomap-feedback';

// Only allow safe characters: letters, numbers, basic punctuation
const SAFE_CHARS = /[^a-zA-Z0-9\u00C0-\u024F\s.,!?¿¡:;()\-'/]/g;

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

/** Sanitize user input — strip HTML, control chars, dangerous patterns */
function sanitize(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')                    // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .replace(SAFE_CHARS, '')                     // only safe chars
    .trim()
    .substring(0, MAX_CHARS);
}

export function FeedbackModal() {
  const open = useUIStore((s) => s.feedbackOpen);
  const setOpen = useUIStore((s) => s.setFeedbackOpen);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const addToast = useToastStore((s) => s.addToast);

  const [type, setType] = useState<FeedbackType>('sugerencia');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState(''); // invisible anti-bot field
  const [isSubmitting, setIsSubmitting] = useState(false);

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open);

  const resetForm = useCallback(() => {
    setType('sugerencia');
    setMessage('');
    setHoneypot('');
  }, []);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const handleSubmit = useCallback(async () => {
    // Anti-bot: honeypot filled = bot
    if (honeypot) return;

    const clean = sanitize(message);
    if (clean.length < 10) {
      addToast('Escribe al menos 10 caracteres', 'warning');
      return;
    }

    if (getDailyCount() >= MAX_SUBMISSIONS_PER_DAY) {
      addToast('Limite diario alcanzado (3 envios/dia)', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          text: clean,
          sector: sectorId,
          website: honeypot, // honeypot field — bots fill this
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error('Webhook error');
      incrementDailyCount();
      addToast('Enviado. Gracias por tu feedback', 'success');
      resetForm();
      setOpen(false);
    } catch {
      addToast('Error al enviar. Intentalo mas tarde', 'error');
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
      aria-label="Enviar feedback"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h2 className="text-sm font-semibold text-white">Tu opinion</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg
              text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Cerrar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Type selector */}
          <div className="flex gap-1.5">
            {(Object.keys(TYPE_LABELS) as FeedbackType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${type === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Message */}
          <div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.substring(0, MAX_CHARS))}
              placeholder="Escribe tu idea, sugerencia o problema..."
              rows={3}
              maxLength={MAX_CHARS}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-700 bg-slate-800/60
                text-sm text-white placeholder-slate-500
                focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                resize-none transition-colors"
            />
            <div className={`text-right text-[10px] mt-0.5 ${remaining < 30 ? 'text-amber-400' : 'text-slate-600'}`}>
              {remaining} caracteres
            </div>
          </div>

          {/* Honeypot — invisible to users, bots fill it */}
          <input
            type="text"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }}
            aria-hidden="true"
          />

          <div className="text-[9px] text-slate-600">
            Anonimo. Sin datos personales. Max 3 envios/dia.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700/60">
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400
              hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={message.trim().length < 10 || isSubmitting}
            className="px-5 py-2 rounded-lg text-xs font-semibold transition-all
              bg-blue-600 text-white hover:bg-blue-500
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
