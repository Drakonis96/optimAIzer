import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  /** When true the modal uses a two-step flow: first yes/no, then a 4-digit code. */
  requireCode?: boolean;
  /** Labels – the caller can localise them. */
  yesText?: string;
  noText?: string;
  codePromptText?: string;
  codeErrorText?: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDestructive = false,
  requireCode = false,
  yesText = "Sí",
  noText = "No",
  codePromptText = "Introduce el código para confirmar:",
  codeErrorText = "Código incorrecto, inténtalo de nuevo.",
}) => {
  // step: 'ask' = yes/no question, 'code' = enter the 4-digit code
  const [step, setStep] = useState<'ask' | 'code'>('ask');
  const [code, setCode] = useState('');
  const [randomCode, setRandomCode] = useState('');
  const [codeError, setCodeError] = useState(false);

  // Generate a fresh 4-digit code every time the modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('ask');
      setCode('');
      setCodeError(false);
      setRandomCode(
        Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('')
      );
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setStep('ask');
    setCode('');
    setCodeError(false);
    onClose();
  }, [onClose]);

  const handleYes = useCallback(() => {
    if (requireCode) {
      setStep('code');
      setCode('');
      setCodeError(false);
    } else {
      onConfirm();
      handleClose();
    }
  }, [requireCode, onConfirm, handleClose]);

  const handleCodeSubmit = useCallback(() => {
    if (code === randomCode) {
      onConfirm();
      handleClose();
    } else {
      setCodeError(true);
      setCode('');
    }
  }, [code, randomCode, onConfirm, handleClose]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border w-full max-w-sm rounded-xl shadow-2xl p-6 transition-all scale-100">
        {/* ── Step 1: Yes / No ── */}
        {step === 'ask' && (
          <>
            <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">{message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                {requireCode ? noText : cancelText}
              </button>
              <button
                onClick={handleYes}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors shadow-lg ${
                  isDestructive
                    ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20'
                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-900/20'
                }`}
              >
                {requireCode ? yesText : confirmText}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Enter 4-digit code ── */}
        {step === 'code' && (
          <>
            <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
            <p className="text-zinc-400 text-sm mb-3">{codePromptText}</p>
            <div className="flex justify-center mb-4">
              <span className="tracking-[0.5em] text-3xl font-mono font-bold text-primary select-none">
                {randomCode}
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={code}
              onChange={(e) => {
                setCodeError(false);
                setCode(e.target.value.replace(/\D/g, '').slice(0, 4));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 4) handleCodeSubmit();
              }}
              className="w-full text-center tracking-[0.5em] text-2xl font-mono bg-zinc-800 border border-border rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary mb-2"
              placeholder="····"
            />
            {codeError && (
              <p className="text-red-500 text-xs text-center mb-2">{codeErrorText}</p>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                {cancelText}
              </button>
              <button
                disabled={code.length !== 4}
                onClick={handleCodeSubmit}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                  isDestructive
                    ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20'
                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-900/20'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};