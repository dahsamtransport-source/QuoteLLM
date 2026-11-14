import { useReducer, useEffect, useRef, useCallback } from 'react';
import { ChatMessage, Answers, QuoteResult, QuickEstimateData, QuickReplyOption, NeedsTunerData } from '../types';
import {
  CONSENT_TEXT, getNextQuestionId, getQuestion, getSectionOf,
  getIntentionContextMessage,
} from '../data/questionnaire';
import { calculateQuote, buildQuickEstimate, answersToTuner, calculateQuoteFromTuner } from '../data/pricing';

// ─── state ────────────────────────────────────────────────────────────────────

interface State {
  messages:         ChatMessage[];
  isTyping:         boolean;
  inputDisabled:    boolean;
  inputPlaceholder: string;
  validationError:  string | null;
  currentStep:      string;
}

type Action =
  | { type: 'ADD_MSG';   payload: ChatMessage }
  | { type: 'TYPING';    payload: boolean }
  | { type: 'SET_INPUT'; payload: { disabled: boolean; placeholder?: string } }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_STEP';  payload: string }
  | { type: 'CONSUME';   payload: string };

const INIT: State = {
  messages: [], isTyping: false, inputDisabled: true,
  inputPlaceholder: 'Poser une question…', validationError: null, currentStep: 'start',
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'ADD_MSG':   return { ...s, messages: [...s.messages, a.payload] };
    case 'TYPING':    return { ...s, isTyping: a.payload };
    case 'SET_INPUT': return { ...s, inputDisabled: a.payload.disabled, inputPlaceholder: a.payload.placeholder ?? s.inputPlaceholder };
    case 'SET_ERROR': return { ...s, validationError: a.payload };
    case 'SET_STEP':  return { ...s, currentStep: a.payload };
    case 'CONSUME':   return { ...s, messages: s.messages.map(m => m.id === a.payload ? { ...m, consumed: true } : m) };
    default:          return s;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

let _ctr = 0;
const uid = () => `m${++_ctr}-${Date.now()}`;

function makeMsg(
  role: ChatMessage['role'],
  content: string,
  widget?: ChatMessage['widget'],
  widgetData?: ChatMessage['widgetData'],
  questionId?: string,
): ChatMessage {
  return { id: uid(), role, content, timestamp: new Date(), widget, widgetData, questionId };
}

// Steps where free-text input is meaningless
const INACTIVE_STEPS = ['calculating', 'done'];

// Interactive widgets that can be bypassed by typing
const BYPASSABLE_WIDGETS: ChatMessage['widget'][] = ['consent-card', 'quick-reply', 'document-upload'];

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useConversation() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const answersRef             = useRef<Answers>({});
  const intentionMsgShownRef   = useRef(false);
  const docUploadShownRef      = useRef(false);
  const quickEstimateShownRef  = useRef(false);
  const prevSectionRef         = useRef<'context' | 'refinement' | 'besoins' | null>(null);
  const timers                 = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Tracks the id of the last interactive widget so submitText can consume it
  const pendingWidgetIdRef     = useRef<string | null>(null);

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  };

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function withTyping(ms: number, fn: () => void) {
    dispatch({ type: 'TYPING', payload: true });
    later(() => { dispatch({ type: 'TYPING', payload: false }); fn(); }, ms);
  }

  function bot(
    content: string,
    widget?: ChatMessage['widget'],
    widgetData?: ChatMessage['widgetData'],
    questionId?: string,
  ) {
    const msg = makeMsg('assistant', content, widget, widgetData, questionId);
    dispatch({ type: 'ADD_MSG', payload: msg });
    if (widget && (BYPASSABLE_WIDGETS as string[]).includes(widget)) {
      pendingWidgetIdRef.current = msg.id;
    }
  }

  function me(content: string) {
    dispatch({ type: 'ADD_MSG', payload: makeMsg('user', content) });
  }

  function enableInput(placeholder: string) {
    dispatch({ type: 'SET_INPUT', payload: { disabled: false, placeholder } });
  }

  function disableInput() {
    dispatch({ type: 'SET_INPUT', payload: { disabled: true } });
  }

  // ── flow engine ───────────────────────────────────────────────────────────

  const advance = useCallback((answers: Answers) => {
    const nextId = getNextQuestionId(answers);

    // ── INTERCEPT 1: message contextuel après intention ───────────────────
    if (answers.intention && !answers.currently_insured && !intentionMsgShownRef.current) {
      intentionMsgShownRef.current = true;
      withTyping(600, () => {
        bot(getIntentionContextMessage(answers.intention!));
        later(() => {
          withTyping(700, () => {
            const q = getQuestion('currently_insured');
            bot(q.prompt, 'quick-reply', q.options as QuickReplyOption[], 'currently_insured');
            enableInput('Ou tapez votre réponse…');
            dispatch({ type: 'SET_STEP', payload: 'currently_insured' });
          });
        }, 600);
      });
      return;
    }

    // ── INTERCEPT 1.5: option fast-track document (si assuré, avant price) ─
    if (
      answers.currently_insured === 'yes' &&
      !answers.current_price &&
      !answers.doc_upload_skipped &&
      !docUploadShownRef.current
    ) {
      docUploadShownRef.current = true;
      dispatch({ type: 'SET_STEP', payload: 'doc_upload' });
      withTyping(700, () => {
        bot(
          "L'analyse automatique des documents n'est pas disponible. Si vous sélectionnez une carte, elle restera sur votre appareil et aucune information ne sera pré-remplie. Vous pouvez continuer en saisissant directement le montant.",
          'document-upload',
        );
        enableInput('Ou saisissez le montant directement…');
      });
      return;
    }

    // ── INTERCEPT 2: premier aperçu + transition vers profil ──────────────
    const contextComplete = !!(
      answers.intention &&
      answers.currently_insured &&
      (answers.currently_insured !== 'yes' || answers.current_price || answers.doc_upload_skipped)
    );

    if (contextComplete && !quickEstimateShownRef.current) {
      quickEstimateShownRef.current = true;
      dispatch({ type: 'SET_STEP', payload: 'estimate' });

      withTyping(800, () => {
        const estimate = buildQuickEstimate(answers);
        const ctxMsg = answers.currently_insured !== 'yes'
          ? 'Voici un premier aperçu pour ton profil :'
          : 'Super. Voici un **premier aperçu** basé sur ce que tu m\'as dit :';
        bot(ctxMsg, 'quick-estimate', estimate as unknown as QuickEstimateData);

        later(() => {
          withTyping(700, () => {
            bot('Pour affiner et te faire une **comparaison précise**, j\'ai besoin de quelques infos rapides sur ton profil.');
            later(() => {
              bot('', 'section-divider', { label: 'Ton profil' });
              later(() => {
                withTyping(700, () => {
                  const q = getQuestion(nextId!); // date_of_birth
                  bot(q.prompt);
                  enableInput(q.placeholder ?? '');
                  dispatch({ type: 'SET_STEP', payload: nextId! });
                });
              }, 300);
            }, 200);
          });
        }, 1800);
      });
      return;
    }

    // ── Toutes les questions répondues → comparaison ──────────────────────
    if (!nextId) {
      dispatch({ type: 'SET_STEP', payload: 'calculating' });
      disableInput();
      withTyping(800, () => {
        bot('Parfait ! Je prépare ta **comparaison personnalisée**…', 'calculating');
        later(() => {
          const quote = calculateQuote(answersRef.current);
          dispatch({ type: 'SET_STEP', payload: 'result' });
          withTyping(1500, () => {
            const compMsg = answers.current_price
              ? 'Voici ta **comparaison** avec ta mutuelle actuelle :'
              : 'Voici les **3 formules** que nous te proposons :';
            bot(compMsg, 'formula-comparison', quote as unknown as QuoteResult);
            later(() => {
              // CTA en premier — chemin principal toujours visible
              withTyping(700, () => {
                bot(
                  '👉 **Direct Assurance** (groupe AXA) s\'occupe de tout — souscription sur un site sécurisé, avec une équipe humaine si tu as des questions.',
                  'cta-card',
                );
                dispatch({ type: 'SET_STEP', payload: 'contact' });
                enableInput('Une question sur les formules ?');
                // Tuner en option facultative, après le CTA
                later(() => {
                  const tunerData = answersToTuner(answersRef.current);
                  bot(
                    'Tu veux affiner les garanties avant de décider ? C\'est optionnel — ajuste les curseurs et je recalcule.',
                    'needs-tuner',
                    tunerData as unknown as QuoteResult,
                  );
                  dispatch({ type: 'SET_STEP', payload: 'refine' });
                }, 600);
              });
            }, 600);
          });
        }, 2200);
      });
      return;
    }

    const section = getSectionOf(nextId);
    dispatch({ type: 'SET_STEP', payload: nextId });

    // ── Transition refinement → besoins ───────────────────────────────────
    if (section === 'besoins' && prevSectionRef.current === 'refinement') {
      prevSectionRef.current = 'besoins';
      withTyping(600, () => {
        bot('Bien noté 👍\n\nDernière étape : tes **priorités de remboursement**.');
        later(() => {
          bot('', 'section-divider', { label: 'Tes besoins' });
          later(() => {
            withTyping(700, () => {
              const q = getQuestion(nextId);
              bot(q.prompt, 'quick-reply', q.options as QuickReplyOption[], nextId);
              enableInput('Ou tapez votre réponse…');
            });
          }, 300);
        }, 200);
      });
      return;
    }

    if (section === 'refinement' && prevSectionRef.current !== 'refinement' && prevSectionRef.current !== 'besoins') {
      prevSectionRef.current = 'refinement';
    }
    if (section === 'context' && prevSectionRef.current === null) {
      prevSectionRef.current = 'context';
    }

    // ── Question suivante standard ────────────────────────────────────────
    withTyping(700, () => {
      const q = getQuestion(nextId);
      if (q.type === 'choice') {
        bot(q.prompt, 'quick-reply', q.options as QuickReplyOption[], nextId);
        enableInput('Ou tapez votre réponse…');
      } else {
        bot(q.prompt);
        enableInput(q.placeholder ?? 'Votre réponse…');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch({ type: 'SET_STEP', payload: 'consent' });
    withTyping(1000, () => {
      bot(CONSENT_TEXT, 'consent-card');
      enableInput('Poser une question…');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── enregistrement des réponses ───────────────────────────────────────────

  function recordAnswer(id: string, value: string) {
    answersRef.current = { ...answersRef.current, [id]: value };
  }

  function consumePendingWidget() {
    if (pendingWidgetIdRef.current) {
      dispatch({ type: 'CONSUME', payload: pendingWidgetIdRef.current });
      pendingWidgetIdRef.current = null;
    }
  }

  // ── API publique ──────────────────────────────────────────────────────────

  const acceptConsent = useCallback((msgId: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me("C'est parti, on y va !");
    advance(answersRef.current);
  }, [advance]);

  const declineConsent = useCallback((msgId: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('Non merci.');
    withTyping(800, () => bot("Pas de problème. Reviens quand tu veux. Bonne journée ! 👋"));
    dispatch({ type: 'SET_STEP', payload: 'done' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitText = useCallback((value: string) => {
    const step = state.currentStep;
    const v = value.trim();
    if (!v) return;

    // Ignore during non-interactive steps
    if (INACTIVE_STEPS.includes(step)) return;

    // Validate only for text-type questions
    let err: string | null = null;
    try {
      const q = getQuestion(step);
      if (q.type === 'text') {
        err = q.validate?.(v) ?? null;
      }
      // choice questions: free-text accepted, no validation
    } catch {
      // Non-question step (consent, doc_upload, result, contact…) — accept free text
    }

    if (err) { dispatch({ type: 'SET_ERROR', payload: err }); return; }
    dispatch({ type: 'SET_ERROR', payload: null });
    disableInput();
    consumePendingWidget();
    me(v);

    // Handle special steps
    if (step === 'consent') {
      advance(answersRef.current);
      return;
    }
    if (step === 'doc_upload') {
      answersRef.current = { ...answersRef.current, doc_upload_skipped: true };
      advance({ ...answersRef.current });
      return;
    }
    if (['result', 'contact'].includes(step)) {
      withTyping(600, () => bot('Merci pour ton message. Tu peux utiliser les boutons ci-dessus pour continuer, ou être rappelé(e) par un conseiller. 😊'));
      enableInput('Une question ?');
      return;
    }

    recordAnswer(step, v);
    advance({ ...answersRef.current });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep, advance]);

  const selectOption = useCallback((msgId: string, questionId: string, value: string, label: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me(label);
    recordAnswer(questionId, value);
    advance({ ...answersRef.current });
  }, [advance]);

  // ── Handlers document upload ──────────────────────────────────────────────

  const handleDocUpload = useCallback((msgId: string, _file: File) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('📎 Document sélectionné (non transmis).');

    // There is no wired OCR integration in this UI; do not invent insurer or
    // policy details from the selected file or transmit it silently.
    withTyping(400, () => {
      bot(
        "Ce document n'a pas été analysé automatiquement. " +
        "Aucune information d'assureur ou de régime n'a été extraite, " +
        "et votre fichier n'a pas été envoyé à un service externe. " +
        "Pour continuer, saisissez vous-même les informations de votre contrat.",
      );
      later(() => {
        withTyping(500, () => {
          const q = getQuestion('current_price');
          bot(q.prompt);
          enableInput(q.placeholder ?? '');
          dispatch({ type: 'SET_STEP', payload: 'current_price' });
        });
      }, 300);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDocEnterManually = useCallback((msgId: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('Je préfère saisir le montant directement.');
    withTyping(500, () => {
      const q = getQuestion('current_price');
      bot(q.prompt);
      enableInput(q.placeholder ?? '');
      dispatch({ type: 'SET_STEP', payload: 'current_price' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDocSkip = useCallback((msgId: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('Je passe cette étape.');
    answersRef.current = { ...answersRef.current, doc_upload_skipped: true };
    advance({ ...answersRef.current });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance]);

  // ── Needs tuner ──────────────────────────────────────────────────────────

  const handleNeedsTuner = useCallback((msgId: string, needs: NeedsTunerData) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('J\'ai ajusté mes préférences de couverture.');
    withTyping(900, () => {
      const quote = calculateQuoteFromTuner(answersRef.current, needs);
      bot('Voici les formules recalculées selon tes nouveaux besoins :', 'formula-comparison', quote as unknown as QuoteResult);
      later(() => {
        withTyping(600, () => {
          bot(
            '👉 **Direct Assurance** (groupe AXA) s\'occupe de tout — souscription sur un site sécurisé, avec une équipe humaine si tu as des questions.',
            'cta-card',
          );
          dispatch({ type: 'SET_STEP', payload: 'contact' });
        });
      }, 400);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── CTA handlers ─────────────────────────────────────────────────────────

  const continueToBuy = useCallback((msgId: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('Je souhaite continuer sur Direct Assurance.');
    withTyping(800, () => {
      bot('Parfait ! 🎉 Dans un vrai parcours, tu serais redirigé(e) vers le site sécurisé **directassurances.fr** avec tes informations pré-remplies.\n\n*Ce devis est indicatif et non contractuel.*');
      dispatch({ type: 'SET_STEP', payload: 'done' });
      disableInput();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestCallback = useCallback((msgId: string) => {
    dispatch({ type: 'CONSUME', payload: msgId });
    pendingWidgetIdRef.current = null;
    me('Je préfère être rappelé(e) par un conseiller.');
    withTyping(800, () => {
      bot('Un conseiller Direct Assurance te contactera très prochainement. 📞\n\n*Ce devis est indicatif et non contractuel. La souscription finale se fait avec l\'équipe Direct Assurance.*');
      dispatch({ type: 'SET_STEP', payload: 'done' });
      disableInput();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    messages:         state.messages,
    currentStep:      state.currentStep,
    isTyping:         state.isTyping,
    inputDisabled:    state.inputDisabled,
    inputPlaceholder: state.inputPlaceholder,
    validationError:  state.validationError,
    acceptConsent, declineConsent, submitText, selectOption,
    handleDocUpload, handleDocEnterManually, handleDocSkip,
    handleNeedsTuner,
    continueToBuy, requestCallback,
  };
}
