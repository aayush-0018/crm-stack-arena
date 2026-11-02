import { ArrowLeft, Check, Coffee, Gamepad2, Timer, Trophy, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { tableGuestApi } from '../../api/endpoints';
import { read, SESSION_KEY, usePolling } from '../../components/tables/dinein';
import Spinner from '../../components/ui/Spinner';
import { formatINR } from '../../lib/money';
import type { GameInk, GameQuestion, GameState } from '../../types';

const INK: Record<GameInk, string> = { red: '#d93a2b', blue: '#2563eb', green: '#1f8a3b', orange: '#e67e0f', purple: '#7c3aed' };
const card = 'rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]';
const primary = 'flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f1b16] text-[16px] font-semibold text-white disabled:opacity-60';
const secondary = 'flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#1f1b16] text-[15px] font-medium disabled:opacity-60';

/** "1:05" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function useTick(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Prompt({ q }: { q: GameQuestion }) {
  if (q.kind === 'ink') {
    return (
      <div className="text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8a8276]">Tap the colour of the ink</p>
        <p className="mt-3 text-[44px] font-extrabold leading-none" style={{ color: INK[q.ink ?? 'red'] }}>
          {q.prompt}
        </p>
      </div>
    );
  }
  if (q.kind === 'count') {
    return (
      <div className="text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8a8276]">{q.prompt}</p>
        <div className="mx-auto mt-3 grid max-w-[240px] grid-cols-4 justify-items-center gap-2.5" aria-label={`${q.count} cups`}>
          {Array.from({ length: q.count ?? 0 }, (_, i) => (
            <Coffee key={i} size={34} className="text-[#7a4c09]" />
          ))}
        </div>
      </div>
    );
  }
  if (q.kind === 'max') return <p className="text-center text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8a8276]">{q.prompt}</p>;
  return <p className="text-center text-[46px] font-bold leading-none tabular-nums">{q.prompt}</p>;
}

/**
 * Quick-fire play until time's up (or the questions run out). With `feedback`, right and wrong show
 * as you go (practice); in a challenge the answers aren't known here, so it just moves on.
 */
function Play({
  questions,
  endsAt,
  seconds,
  feedback,
  onDone,
}: {
  questions: GameQuestion[];
  endsAt: number;
  seconds: number;
  feedback: boolean;
  onDone: (answers: number[]) => void;
}) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [flash, setFlash] = useState<'right' | 'wrong' | null>(null);
  const done = useRef(false);
  const now = useTick();
  const left = endsAt - Date.now();
  const total = questions.length;

  const finish = useCallback(
    (a: number[]) => {
      if (done.current) return;
      done.current = true;
      onDone(a);
    },
    [onDone],
  );
  useEffect(() => {
    if (left <= 0) finish(answers);
  }, [now, left, answers, finish]);

  const i = answers.length;
  const q = questions[i];
  const right = feedback ? answers.filter((a, k) => a === questions[k].answer).length : 0;
  const tap = (choice: number) => {
    if (done.current || !q) return;
    const next = [...answers, choice];
    setAnswers(next);
    if (feedback) {
      setFlash(choice === q.answer ? 'right' : 'wrong');
      setTimeout(() => setFlash(null), 250);
    }
    if (next.length >= total) finish(next);
  };

  return (
    <div className={card}>
      <div className="flex items-center justify-between text-[14px]">
        <span className="flex items-center gap-1.5 font-semibold tabular-nums">
          <Timer size={16} /> {clock(left)}
        </span>
        <span className="text-[#8a8276]">{feedback ? `${right} right` : `${i} answered`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f3efe7]">
        <div className="h-full rounded-full bg-[#1f1b16] transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, (left / (seconds * 1000)) * 100))}%` }} />
      </div>

      <div
        className={`mt-5 flex min-h-[150px] items-center justify-center rounded-2xl px-3 py-6 transition-colors ${
          flash === 'right' ? 'bg-[#e8f4ea]' : flash === 'wrong' ? 'bg-[#fdecea]' : 'bg-[#faf8f4]'
        }`}
        aria-live="polite"
      >
        {q ? <Prompt q={q} /> : <Spinner className="h-6 w-6" />}
      </div>

      {q && (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {q.options.map((opt, k) => (
            <button
              key={`${i}-${k}`}
              type="button"
              onClick={() => tap(k)}
              className="h-16 rounded-2xl border border-[#e6dfd2] bg-white text-[22px] font-semibold tabular-nums active:scale-95 active:bg-[#f3efe7]"
              style={q.kind === 'ink' ? { fontSize: 17, textTransform: 'capitalize' } : undefined}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[12.5px] text-[#a39a8c]">A wrong answer takes a point off, so don't just guess.</p>
    </div>
  );
}

function Players({ players, showScores }: { players: NonNullable<GameState['round']>['players']; showScores: boolean }) {
  return (
    <ol className="mt-3 divide-y divide-[#f0ebe1] rounded-xl border border-[#ece6da]">
      {players.map((p, i) => (
        <li key={i} className={`flex items-center gap-3 px-3.5 py-2.5 text-[14.5px] ${p.me ? 'bg-[#fbf7ef]' : ''}`}>
          {showScores && <span className="w-5 text-[13px] tabular-nums text-[#8a8276]">{i + 1}</span>}
          <span className="min-w-0 flex-1 truncate">
            {p.name}
            {p.me && <span className="text-[#8a8276]"> (you)</span>}
            <span className="text-[#8a8276]"> · Table {p.tableLabel}</span>
          </span>
          {p.winner && <Trophy size={16} className="shrink-0 text-[#e0a21b]" />}
          {showScores && <span className="w-8 text-right font-semibold tabular-nums">{p.score ?? '–'}</span>}
        </li>
      ))}
    </ol>
  );
}

/** The table game, opened from the order page once the guest has ordered. */
export default function GuestGamePage() {
  const { token = '' } = useParams();
  const [session] = useState<string | null>(() => read(localStorage, SESSION_KEY, null));
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [practice, setPractice] = useState<{ questions: GameQuestion[]; endsAt: number } | null>(null);
  const [practiceScore, setPracticeScore] = useState<{ right: number; wrong: number } | null>(null);
  // Challenge answers on their way to the server.
  const [sent, setSent] = useState<{ roundId: number; answers: number[] } | null>(null);
  // Local times for the round's start and end, from the server's "seconds to go" (phone clocks drift).
  const [times, setTimes] = useState<{ startsAt: number; endsAt: number } | null>(null);
  const now = useTick(500);

  const take = useCallback((s: GameState) => {
    setState(s);
    setLoadError(null);
    setTimes(s.round ? { startsAt: Date.now() + s.round.startsInSeconds * 1000, endsAt: Date.now() + s.round.endsInSeconds * 1000 } : null);
  }, []);

  const live = state?.round && ['lobby', 'playing', 'counting'].includes(state.round.status);
  const load = useCallback(() => {
    if (!session) return;
    tableGuestApi.game(token, session).then(take, (e) =>
      setLoadError(e instanceof ApiError && e.status === 401 ? 'session' : e instanceof ApiError && e.status < 500 ? e.message : 'network'),
    );
  }, [token, session, take]);
  // Quicker while a round is on, so the start and the results show up straight away.
  usePolling(load, live ? 2000 : 8000);

  useEffect(() => {
    document.title = 'Table game';
  }, []);

  const run = async (fn: () => Promise<GameState>) => {
    setBusy(true);
    setError(null);
    try {
      take(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the café. Check your connection.");
      load();
    } finally {
      setBusy(false);
    }
  };

  const startPractice = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const p = await tableGuestApi.practice(token, session);
      setPracticeScore(null);
      setPractice({ questions: p.questions, endsAt: Date.now() + p.seconds * 1000 });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the game. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="theme-light min-h-screen bg-[#faf8f4] px-4 pb-10 pt-5 text-[#1f1b16]">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <Link to={`/t/${token}`} className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e6dfd2] bg-white" aria-label="Back to the menu">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-[19px] font-semibold leading-tight">
              <Gamepad2 size={20} /> Table game
            </h1>
            {state && <p className="text-[13px] text-[#8a8276]">Table {state.tableLabel}</p>}
          </div>
        </div>
        {error && <p className="mt-4 rounded-xl bg-[#fdecea] px-3.5 py-2.5 text-[14px] text-[#a8321f]">{error}</p>}
        {body}
      </div>
    </div>
  );

  if (!session || loadError === 'session') {
    return shell(
      <div className={`${card} mt-6 text-center`}>
        <p className="text-[15px]">Confirm your email on the menu first, then come back to play.</p>
        <Link to={`/t/${token}`} className={`${primary} mt-4`}>
          Open the menu
        </Link>
      </div>,
    );
  }
  if (loadError && !state) {
    return shell(
      <div className="mt-10 text-center text-[15px] text-[#5e574c]">
        <p>{loadError === 'network' ? "Couldn't load the game." : loadError}</p>
        <button type="button" onClick={load} className="mt-3 rounded-full border border-[#1f1b16] px-4 py-2 text-[14px] text-[#1f1b16]">
          Try again
        </button>
      </div>,
    );
  }
  if (!state) {
    return shell(
      <div className="mt-16 flex justify-center">
        <Spinner className="h-6 w-6" />
      </div>,
    );
  }

  if (state.locked) {
    return shell(
      <div className={`${card} mt-6 text-center`}>
        <p className="text-[16px] font-medium">The game opens after you order</p>
        <p className="mt-1 text-[14px] text-[#8a8276]">Place an order from the menu, then come back to play.</p>
        <Link to={`/t/${token}`} className={`${primary} mt-4`}>
          Open the menu
        </Link>
      </div>,
    );
  }

  // Practising alone.
  if (practice) {
    return shell(
      <div className="mt-5">
        <Play
          questions={practice.questions}
          endsAt={practice.endsAt}
          seconds={state.playSeconds}
          feedback
          onDone={(a) => {
            const right = a.filter((x, k) => x === practice.questions[k].answer).length;
            setPractice(null);
            setPracticeScore({ right, wrong: a.length - right });
          }}
        />
      </div>,
    );
  }

  const r = state.round;
  const startsIn = times ? times.startsAt - now : 0;
  const endsIn = times ? times.endsAt - now : 0;

  const send = (a: number[]) => {
    if (!r) return;
    setSent({ roundId: r.id, answers: a });
    run(() => tableGuestApi.answer(token, session, r.id, a));
  };

  // In a challenge: answering now, or sending the answers (again, if it failed).
  if (r && r.joined && !r.submitted && (r.status === 'playing' || r.status === 'counting')) {
    const mine = sent?.roundId === r.id ? sent.answers : null;
    if (mine) {
      return shell(
        <div className={`${card} mt-5 text-center`}>
          <p className="text-[16px] font-medium">{busy ? 'Sending your answers…' : "Your answers didn't arrive"}</p>
          {!busy && (
            <button type="button" onClick={() => send(mine)} className={`${primary} mt-4`}>
              Send them again
            </button>
          )}
        </div>,
      );
    }
    if (r.status === 'playing' && r.questions && times) {
      return shell(
        <div className="mt-5">
          <p className="mb-3 text-center text-[14px] text-[#5e574c]">
            Table challenge · {r.players.length} players at {r.tables} tables
          </p>
          <Play key={r.id} questions={r.questions} endsAt={times.endsAt} seconds={state.playSeconds} feedback={false} onDone={send} />
        </div>,
      );
    }
  }

  const me = r?.players.find((p) => p.me);
  const startButton = (
    <button type="button" disabled={busy} onClick={() => run(() => tableGuestApi.startRound(token, session))} className={`${primary} mt-4`}>
      {busy && <Spinner className="h-4 w-4" />}
      <Users size={17} /> Start a table challenge
    </button>
  );

  return shell(
    <>
      {state.pendingPrizePct > 0 && (
        <div className="mt-5 flex items-center gap-2.5 rounded-xl bg-[#fdf3e3] px-3.5 py-2.5 text-[14px] text-[#7a4c09]">
          <Trophy size={16} className="shrink-0" />
          <span>
            You won! <strong>{state.pendingPrizePct}% off</strong> comes off your next order.
          </span>
        </div>
      )}

      <section className={`${card} mt-5`}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8c2f1b]">Table challenge</p>

        {!r && (
          <>
            <p className="mt-2 text-[16px] font-medium">Take on the other tables</p>
            <p className="mt-1 text-[14px] text-[#5e574c]">
              Start a round and everyone in the café has {state.lobbySeconds} seconds to join.
              Then it's {state.playSeconds} seconds of quick questions. The top score wins <strong>{state.prizePct}% off</strong> their bill.
            </p>
            {startButton}
          </>
        )}

        {r?.status === 'lobby' && (
          <>
            <p className="mt-2 text-[16px] font-medium">
              Starts in <span className="tabular-nums">{clock(startsIn)}</span>
            </p>
            <p className="mt-1 text-[14px] text-[#5e574c]">
              {r.joined ? "You're in. Stay on this page; it starts by itself." : 'A round is about to start. Join in!'} It needs players from at least two tables.
            </p>
            <Players players={r.players} showScores={false} />
            {!r.joined && (
              <button type="button" disabled={busy} onClick={() => run(() => tableGuestApi.joinRound(token, session, r.id))} className={`${primary} mt-4`}>
                {busy && <Spinner className="h-4 w-4" />} Join the round
              </button>
            )}
          </>
        )}

        {r && (r.status === 'playing' || r.status === 'counting') && (
          <>
            {r.submitted ? (
              <>
                <p className="mt-2 flex items-center gap-2 text-[16px] font-medium">
                  <Check size={18} className="text-[#2e7031]" /> Your answers are in
                </p>
                <p className="mt-1 text-[14px] text-[#5e574c]">
                  {me?.correct ?? 0} right, {me?.wrong ?? 0} wrong. Waiting for the other players…
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-[16px] font-medium">A round is being played</p>
                <p className="mt-1 text-[14px] text-[#5e574c]">
                  {r.status === 'playing' ? `It ends in ${clock(endsIn)}. ` : 'Counting the scores. '}You can start the next one when it's over.
                </p>
              </>
            )}
            <Players players={r.players} showScores={false} />
          </>
        )}

        {r?.status === 'called_off' && (
          <>
            <p className="mt-2 text-[16px] font-medium">Not enough tables joined</p>
            <p className="mt-1 text-[14px] text-[#5e574c]">A round needs players from at least two tables. Ask the next table over and try again!</p>
            {startButton}
          </>
        )}

        {r?.status === 'finished' && (
          <>
            {r.myPrize ? (
              <div className="mt-3 rounded-xl bg-[#1f1b16] px-4 py-4 text-center text-white">
                <Trophy size={28} className="mx-auto text-[#f6d48a]" />
                <p className="mt-2 text-[20px] font-bold">You won {r.myPrize.pct}% off!</p>
                <p className="mt-1 text-[14px] opacity-80">
                  {r.myPrize.appliedPaise > 0 ? `${formatINR(r.myPrize.appliedPaise)} has been taken off your bill.` : "It comes off your next order (your orders so far are already paid)."}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[16px] font-medium">
                {r.players.some((p) => p.winner) ? `${r.players.find((p) => p.winner)!.name} at Table ${r.players.find((p) => p.winner)!.tableLabel} won!` : 'Nobody scored this time.'}
              </p>
            )}
            {me && (
              <p className="mt-2 text-[14px] text-[#5e574c]">
                You: {me.score ?? 0} points ({me.correct ?? 0} right, {me.wrong ?? 0} wrong)
              </p>
            )}
            <Players players={r.players} showScores />
            <button type="button" disabled={busy} onClick={() => run(() => tableGuestApi.startRound(token, session))} className={`${secondary} mt-4`}>
              {busy && <Spinner className="h-4 w-4" />} Start another round
            </button>
          </>
        )}
      </section>

      <section className={`${card} mt-4`}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#8c2f1b]">Practice</p>
        {practiceScore ? (
          <p className="mt-2 text-[16px] font-medium">
            {practiceScore.right} right, {practiceScore.wrong} wrong: {Math.max(0, practiceScore.right - practiceScore.wrong)} points
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-[#5e574c]">Warm up on your own: {state.playSeconds} seconds of sums, colours and cup counting. Nothing to win.</p>
        )}
        <button type="button" disabled={busy} onClick={startPractice} className={`${secondary} mt-4`}>
          {practiceScore ? 'Play again' : 'Practise'}
        </button>
      </section>

      <p className="mt-4 text-[12.5px] text-[#a39a8c]">
        Right answers score a point and wrong ones take one off. Ties go to fewer wrong answers. One prize per round, taken off the winner's unpaid table order.
      </p>
    </>,
  );
}
