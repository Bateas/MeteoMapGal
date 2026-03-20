import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useToastStore } from '../../store/toastStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { postFeedbackWebhook } from '../../api/webhookClient';

type FeedbackCategory = 'bug' | 'sugerencia' | 'spot' | 'otra';

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug / Error',
  sugerencia: 'Sugerencia',
  spot: 'Nuevo spot',
  otra: 'Otra cosa',
};

const MAX_SUBMISSIONS_PER_DAY = 3;
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
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const addToast = useToastStore((s) => s.addToast);

  const [category, setCategory] = useState<FeedbackCategory>('sugerencia');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open);

  const resetForm = useCallback(() => {
    setCategory('sugerencia');
    setMessage('');
    setEmail('');
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
    if (!message.trim()) return;

    if (getDailyCount() >= MAX_SUBMISSIONS_PER_DAY) {
      addToast('Limite diario alcanzado (3 envios/dia)', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await postFeedbackWebhook({
        category,
        message: message.trim(),
        email: email.trim() || undefined,
        sector: sectorId,
        timestamp: new Date().toISOString(),
      });
      incrementDailyCount();
      addToast('Feedback enviado correctamente', 'success');
      resetForm();
      setOpen(false);
    } catch {
      addToast('Error al enviar feedback', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [category, message, email, sectorId, addToast, resetForm, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={focusTrapRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enviar feedback"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <svg className="w-4.5 h-4.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h2 className="text-sm font-semibold text-white">Enviar feedback</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg
              text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Cerrar"
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Category selector */}
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
              Tipo
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(CATEGORY_LABELS) as FeedbackCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${category === cat
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <label htmlFor="feedback-msg" className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
              Mensaje <span className="text-red-400">*</span>
            </label>
            <textarea
              id="feedback-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe tu idea, bug o sugerencia..."
              rows={4}
              maxLength={1000}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-700 bg-slate-800/60
                text-sm text-white placeholder-slate-500
                focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                resize-none transition-colors"
            />
            <div className="text-right text-[10px] text-slate-600 mt-0.5">
              {message.length}/1000
            </div>
          </div>

          {/* Email (optional) */}
          <div>
            <label htmlFor="feedback-email" className="block text-[11px] font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
              Email <span className="text-slate-600">(opcional, para respuesta)</span>
            </label>
            <input
              id="feedback-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-700 bg-slate-800/60
                text-sm text-white placeholder-slate-500
                focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                transition-colors"
            />
          </div>

          {/* Sector auto-filled info */}
          <div className="text-[10px] text-slate-600">
            Sector activo: <span className="text-slate-400">{sectorId === 'embalse' ? 'Embalse de Castrelo' : 'Rias Baixas'}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700/60 bg-slate-900/80">
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400
              hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!message.trim() || isSubmitting}
            className="px-5 py-2 rounded-lg text-xs font-semibold transition-all
              bg-blue-600 text-white hover:bg-blue-500
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            {isSubmitting ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
