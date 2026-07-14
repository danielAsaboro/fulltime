"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { address } from "@solana/kit";
import { calculateMarket, formatAmount, parseAmount, type CompiledRulebook, type MarketReferenceV1, type MarketSnapshot, type TicketSnapshot } from "@slip/sdk";
import type { Fixture, Poll, RoomMarketReference } from "@fulltime/shared";
import { Check, Coins, Info, LoaderCircle, WalletCards, X } from "lucide-react";

import { createFullTimeSlipClient, isNormalFinancialBrowser, slipBrowserConfiguration } from "@/lib/slip/config";
import { createMarketFromRulebook, prepareRulebookForSigning } from "@/lib/slip/create-market";
import { useSlipWallet } from "@/lib/slip/privy-provider";
import { resolvePollRulebook, type PollResolution } from "@/lib/slip/rulebook-cache";
import { sendSlipInstructions, type ConnectedSlipWallet } from "@/lib/slip/wallet";

type AttachInput = RoomMarketReference & { pollId: string };

function randomU64(): bigint {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]!) << BigInt(32)) | BigInt(words[1]!);
}

export function PollMarket({ poll, fixture, isAuthor, onAttach }: { poll: Poll; fixture: Fixture; isAuthor: boolean; onAttach(input: AttachInput): Promise<void> }) {
  const config = useMemo(() => slipBrowserConfiguration(), []);
  const walletRuntime = useSlipWallet();
  const financial = isNormalFinancialBrowser() || walletRuntime.configured;
  const [resolution, setResolution] = useState<PollResolution | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkRevision, setCheckRevision] = useState(0);
  const [creationError, setCreationError] = useState<string | null>(null);
  const creationStarted = useRef(false);

  useEffect(() => {
    if (!config || !financial || poll.marketReference) return;
    let alive = true;
    resolvePollRulebook({
      client: createFullTimeSlipClient(),
      configuration: config,
      request: { fixtureId: String(fixture.id), question: poll.question, outcomeLabels: poll.options.map((option) => option.label) },
    }).then((value) => { if (alive) setResolution(value); }).catch((cause) => {
      if (alive) setCheckError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { alive = false; };
  }, [checkRevision, config, financial, fixture.id, poll.marketReference, poll.options, poll.question]);

  useEffect(() => {
    if (!isAuthor || !config || !financial || poll.marketReference || resolution?.status !== "resolvable" || creationStarted.current) return;
    creationStarted.current = true;
    let alive = true;
    const pendingKey = `fulltime:slip-reference:${poll.id}`;
    void (async () => {
      try {
        const stored = localStorage.getItem(pendingKey);
        let reference = stored ? JSON.parse(stored) as MarketReferenceV1 : null;
        if (!reference) {
          const wallet = walletRuntime.wallet ?? await walletRuntime.connect(config.network);
          if (!wallet) throw new Error("The play wallet is unavailable");
          const rulebook = await prepareRulebookForSigning(resolution.rulebook);
          reference = await createMarketFromRulebook({ wallet, rulebook });
          localStorage.setItem(pendingKey, JSON.stringify(reference));
        }
        const { version: _version, ...durableReference } = reference;
        await onAttach({ pollId: String(poll.id), ...durableReference } as AttachInput);
        localStorage.removeItem(pendingKey);
      } catch (cause) {
        if (alive) setCreationError(cause instanceof Error ? cause.message : String(cause));
        creationStarted.current = false;
      }
    })();
    return () => { alive = false; };
  }, [config, financial, isAuthor, onAttach, poll.id, poll.marketReference, resolution, walletRuntime]);

  if (poll.marketReference && config) return <VerifiedMarket reference={poll.marketReference} question={poll.question} />;
  if (!isAuthor || !config) return null;
  if (!financial || resolution?.status === "unresolvable") return null;
  const error = creationError ?? checkError;
  if (!error) return null;
  return <button type="button" aria-label={`Retry automatic market creation: ${error}`} title={error} onClick={() => { setCheckError(null); setCreationError(null); creationStarted.current = false; setCheckRevision((revision) => revision + 1); }} className="mt-3 grid size-9 place-items-center rounded-full border border-crimson/25 text-crimson focus-visible:ring-2 focus-visible:ring-lake-blue"><Info className="size-4" aria-hidden /></button>;
}

export function MarketComposer({ poll, fixture, initialRulebook, onClose, onAttach }: { poll: Poll; fixture: Fixture; initialRulebook?: CompiledRulebook; onClose(): void; onAttach(input: AttachInput): Promise<void> }) {
  const config = useMemo(() => slipBrowserConfiguration()!, []);
  const client = useMemo(() => createFullTimeSlipClient(), []);
  const outcomeLabels = useMemo(() => poll.options.map((option) => option.label), [poll.options]);
  const walletRuntime = useSlipWallet();
  const walletRequested = useRef(false);
  const [rulebook, setRulebook] = useState<CompiledRulebook | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedSlipWallet | null>(null);
  const wallet = walletRuntime.wallet ?? connectedWallet;
  const [openingStep, setOpeningStep] = useState<"outcome" | "stake">("outcome");
  const [openingOutcome, setOpeningOutcome] = useState<number | null>(null);
  const [openingStake, setOpeningStake] = useState("5");
  const [openingCustomStake, setOpeningCustomStake] = useState("");
  const [openingUsesCustomStake, setOpeningUsesCustomStake] = useState(false);
  const [busy, setBusy] = useState<"compile" | "connect" | "create" | "attach" | null>("compile");
  const [error, setError] = useState<string | null>(null);
  const pendingKey = `fulltime:slip-reference:${poll.id}`;
  const [pending, setPending] = useState<MarketReferenceV1 | null>(() => {
    try { return JSON.parse(localStorage.getItem(pendingKey) || "null") as MarketReferenceV1 | null; } catch { return null; }
  });

  useEffect(() => {
    let alive = true;
    const source = initialRulebook ? Promise.resolve<PollResolution>({ status: "resolvable", rulebook: initialRulebook, cached: true }) : resolvePollRulebook({
      client,
      configuration: config,
      request: {
        fixtureId: String(fixture.id),
        question: poll.question,
        outcomeLabels,
      },
    });
    source.then((resolution) => {
      if (resolution.status === "unresolvable") throw new Error(resolution.message);
      return prepareRulebookForSigning(resolution.rulebook);
    }).then((prepared) => {
      if (alive) setRulebook(prepared);
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (alive) setBusy(null);
    });
    return () => { alive = false; };
  }, [client, config, fixture.id, initialRulebook, outcomeLabels, poll.question]);

  useEffect(() => {
    if (!rulebook || wallet || walletRequested.current) return;
    walletRequested.current = true;
    setBusy("connect");
    walletRuntime.connect(config.network).then((connected) => {
      if (connected) setConnectedWallet(connected);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      walletRequested.current = false;
    }).finally(() => setBusy(null));
  }, [config.network, rulebook, wallet, walletRuntime]);

  const run = async <T,>(phase: NonNullable<typeof busy>, action: () => Promise<T>): Promise<T | null> => {
    setBusy(phase); setError(null);
    try { return await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return null; } finally { setBusy(null); }
  };

  const connect = () => run("connect", async () => {
    const connected = await walletRuntime.connect(config.network);
    if (connected) setConnectedWallet(connected);
  });
  const attach = (reference: MarketReferenceV1) => run("attach", async () => {
    const { version: _version, ...durableReference } = reference;
    await onAttach({ pollId: String(poll.id), ...durableReference } as AttachInput);
    localStorage.removeItem(pendingKey); setPending(null); onClose();
  });
  const openingAmountText = openingUsesCustomStake ? openingCustomStake : openingStake;
  let openingAmount: bigint | null = null;
  try {
    const parsed = parseAmount(openingAmountText);
    openingAmount = parsed >= BigInt(1_000_000) ? parsed : null;
  } catch { openingAmount = null; }
  const create = () => run("create", async () => {
    if (!wallet || !rulebook || openingOutcome === null) throw new Error("Choose your stand before signing");
    if (openingAmount === null) throw new Error("Enter a stake of at least 1 USDT");
    const reference = await createMarketFromRulebook({ wallet, rulebook });
    localStorage.setItem(pendingKey, JSON.stringify(reference)); setPending(reference);
    const ticket = await client.buyTicket({ market: address(reference.market), buyer: wallet.address, outcomeIndex: openingOutcome, amount: openingAmount, nonce: randomU64() });
    await sendSlipInstructions({ wallet, rpcUrl: config.rpcUrl, instructions: ticket.instructions });
    await attach(reference);
  });

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-off-black/45 p-4" role="dialog" aria-modal="true" aria-label="Review Slip market terms">
      <section className="max-h-[90dvh] w-full max-w-lg overflow-y-auto border border-ash bg-parchment p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-caption uppercase tracking-[0.1em] text-lake-blue">{openingStep === "outcome" ? "Choose your stand" : "Set your stake"}</p><h2 className="mt-1 text-heading-sm leading-tight">{poll.question}</h2></div><div className="flex shrink-0 items-center gap-1"><div className="group relative"><button type="button" aria-label="How this bet settles" aria-describedby="market-settlement-tip" className="grid size-10 place-items-center rounded-full text-smoke hover:bg-white/60 hover:text-off-black focus-visible:ring-2 focus-visible:ring-lake-blue"><Info className="size-4" aria-hidden /></button>{rulebook ? <div id="market-settlement-tip" role="tooltip" className="pointer-events-none invisible absolute right-0 top-11 z-20 w-64 border border-ash bg-off-black p-3 font-mono text-[10px] leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">TxLINE’s anchored match proof settles this signed market after entries lock.</div> : null}</div><button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-lake-blue"><X className="size-5" /></button></div></div>
        {!rulebook ? busy === "compile" ? <p className="mt-5 inline-flex items-center gap-2 font-mono text-caption text-smoke"><LoaderCircle className="size-4 animate-spin" aria-hidden />Checking this poll against TxLINE settlement…</p> : null : (
          openingStep === "outcome" ? <div className="mt-5"><fieldset><legend className="sr-only">Choose your stand</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{rulebook.outcomeLabels.map((label, index) => { const selected = openingOutcome === index; return <button key={label} type="button" aria-pressed={selected} onClick={() => setOpeningOutcome(index)} className={`min-h-14 border px-3 font-mono text-body transition-colors focus-visible:ring-2 focus-visible:ring-lake-blue ${selected ? "border-off-black bg-off-black text-white" : "border-ash bg-white/55 text-off-black hover:border-off-black"}`}>{selected ? <Check className="mr-2 inline size-4" /> : null}{label}</button>; })}</div></fieldset><button type="button" disabled={openingOutcome === null} onClick={() => setOpeningStep("stake")} className="mt-4 min-h-12 w-full rounded-full bg-off-black px-5 font-mono text-caption uppercase tracking-[0.06em] text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-lake-blue focus-visible:ring-offset-2">{openingOutcome === null ? "Choose your stand" : "Continue"}</button></div> : <div className="mt-5 space-y-4"><div className="flex min-h-11 items-center justify-between border border-off-black bg-periwinkle-mist/45 px-3"><span className="font-mono text-body-sm">{openingOutcome === null ? "—" : rulebook.outcomeLabels[openingOutcome]}</span><button type="button" onClick={() => setOpeningStep("outcome")} className="min-h-10 px-2 font-mono text-caption underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-lake-blue">Change</button></div><fieldset><legend className="sr-only">Your stake</legend><div className="grid grid-cols-3 gap-2">{["5", "10", "25"].map((amount) => <button key={amount} type="button" aria-pressed={!openingUsesCustomStake && openingStake === amount} onClick={() => { setOpeningStake(amount); setOpeningUsesCustomStake(false); }} className={`min-h-11 border px-2 font-mono text-caption tabular-nums focus-visible:ring-2 focus-visible:ring-lake-blue ${!openingUsesCustomStake && openingStake === amount ? "border-lake-blue bg-lake-blue text-white" : "border-ash bg-white/55"}`}>{amount} USDT</button>)}</div><label htmlFor="opening-custom-stake" className="mt-2 block font-mono text-[10px] text-smoke">Custom amount</label><div className="mt-1 flex items-center border border-ash bg-white/55 px-3 focus-within:border-lake-blue focus-within:ring-2 focus-within:ring-lake-blue"><input id="opening-custom-stake" type="text" inputMode="decimal" autoComplete="off" value={openingCustomStake} onFocus={() => setOpeningUsesCustomStake(true)} onChange={(event) => { setOpeningCustomStake(event.target.value); setOpeningUsesCustomStake(true); }} placeholder="12.50" aria-describedby="opening-custom-stake-help" className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-body tabular-nums focus:outline-none" /><span className="font-mono text-caption text-smoke">USDT</span></div><p id="opening-custom-stake-help" className="mt-1 font-mono text-[9px] text-smoke">Minimum 1 USDT</p></fieldset>{!wallet ? <button type="button" disabled={Boolean(busy) || !walletRuntime.ready} onClick={() => void connect()} className="rounded-full border border-off-black px-5 py-2.5 font-mono text-caption uppercase">{busy === "connect" ? "Preparing funded play wallet…" : "Prepare play wallet"}</button> : <p className="flex items-center gap-2 font-mono text-caption text-smoke"><Check className="size-3.5 text-lake-blue" />{wallet.name} ready · {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}</p>}<button type="button" disabled={Boolean(busy) || !wallet || openingOutcome === null || openingAmount === null} onClick={() => void create()} aria-busy={busy === "create"} className="min-h-12 w-full rounded-full bg-off-black px-5 py-3 font-mono text-caption uppercase tracking-[0.06em] text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-lake-blue focus-visible:ring-offset-2">{busy === "create" ? "Opening pool and placing ticket…" : openingAmount === null ? "Enter your stake" : `Sign · ${openingAmountText} USDT`}</button></div>
        )}
        {pending ? <button type="button" disabled={Boolean(busy)} onClick={() => void attach(pending)} className="mt-4 w-full border border-gold bg-gold/15 px-4 py-3 font-mono text-caption">Creation confirmed. Retry attaching it to this room.</button> : null}
        {error ? <p className="mt-4 font-mono text-caption text-crimson" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function VerifiedMarket({ reference, question }: { reference: RoomMarketReference; question: string }) {
  const client = useMemo(() => createFullTimeSlipClient(), []);
  const config = slipBrowserConfiguration()!;
  const walletRuntime = useSlipWallet();
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedSlipWallet | null>(null);
  const wallet = walletRuntime.wallet ?? connectedWallet;
  const [tickets, setTickets] = useState<TicketSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wagerOpen, setWagerOpen] = useState(false);
  const [wagerStep, setWagerStep] = useState<"outcome" | "stake">("outcome");
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [presetAmount, setPresetAmount] = useState("5");
  const [customAmount, setCustomAmount] = useState("");
  const [useCustomAmount, setUseCustomAmount] = useState(false);
  const wagerTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true; let stop: (() => void) | null = null;
    client.verifyReference(reference).then(({ market: verified }) => {
      if (!alive) return; setMarket(verified);
      try { stop = client.watchMarket(verified.address, (next) => { if (alive) setMarket(next); }, (cause) => { if (alive) setError(cause.message); }); } catch { /* RPC reads still show verified state when WS is unavailable. */ }
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; stop?.(); };
  }, [client, reference]);

  useEffect(() => {
    if (!wagerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWagerOpen(false);
        globalThis.setTimeout(() => wagerTrigger.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [wagerOpen]);

  const refreshTickets = async (connected = wallet) => { if (connected) setTickets(await client.listWalletTickets(connected.address)); };
  useEffect(() => {
    const connected = walletRuntime.wallet;
    if (!connected) return;
    let alive = true;
    client.listWalletTickets(connected.address).then((next) => { if (alive) setTickets(next); }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [client, walletRuntime.wallet]);
  const connect = async () => { try { const next = await walletRuntime.connect(config.network); if (next) { setConnectedWallet(next); await refreshTickets(next); } } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const transact = async (instructions: readonly import("@solana/kit").Instruction[]) => { if (!wallet) throw new Error("Connect a wallet first"); setBusy(true); setError(null); try { await sendSlipInstructions({ wallet, rpcUrl: config.rpcUrl, instructions }); setMarket(await client.getMarket(address(reference.market))); await refreshTickets(); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; } finally { setBusy(false); } };
  const openWager = () => { setSelectedOutcome(null); setWagerStep("outcome"); setWagerOpen(true); };
  const closeWager = () => { setWagerOpen(false); setWagerStep("outcome"); globalThis.setTimeout(() => wagerTrigger.current?.focus(), 0); };

  if (error && !market) return <p className="mt-4 border-t border-crimson/20 pt-3 font-mono text-caption text-crimson">Market hidden: {error}</p>;
  if (!market) return <p className="mt-4 inline-flex items-center gap-2 border-t border-ash pt-3 font-mono text-caption text-smoke"><LoaderCircle className="size-3.5 animate-spin" />Verifying market on Solana…</p>;
  const calculated = calculateMarket(market.pools, market.feeBps, market.tipBps);
  const financial = isNormalFinancialBrowser() || walletRuntime.configured;
  const amountText = useCustomAmount ? customAmount : presetAmount;
  let amount: bigint | null = null;
  try {
    const parsed = parseAmount(amountText);
    amount = parsed >= BigInt(1_000_000) ? parsed : null;
  } catch { amount = null; }
  const selectedProjection = selectedOutcome === null || amount === null ? null : calculated.outcomes[selectedOutcome]!.projectedPayout(amount);
  const placeWager = async () => {
    if (!wallet || selectedOutcome === null || amount === null) return;
    const built = await client.buyTicket({ market: market.address, buyer: wallet.address, outcomeIndex: selectedOutcome, amount, nonce: randomU64() });
    if (await transact(built.instructions)) closeWager();
  };
  return (
    <div className="mt-4">
      {financial && market.status === "open" ? <button ref={wagerTrigger} type="button" onClick={openWager} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-off-black px-4 py-2 font-mono text-caption uppercase tracking-[0.06em] text-white focus-visible:ring-2 focus-visible:ring-lake-blue focus-visible:ring-offset-2"><Coins className="size-4" aria-hidden />Back my stand</button> : null}
      {!financial && market.status === "open" ? <p className="font-mono text-caption text-smoke">Press ⌘⇧O to wager in your browser.</p> : null}
      {market.status !== "open" ? <button ref={wagerTrigger} type="button" onClick={() => setWagerOpen(true)} className="inline-flex min-h-10 items-center rounded-full border border-off-black px-4 py-2 font-mono text-caption uppercase tracking-[0.06em] focus-visible:ring-2 focus-visible:ring-lake-blue focus-visible:ring-offset-2">View result</button> : null}
      {wagerOpen ? <div className="fixed inset-0 z-[90] grid place-items-center bg-off-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="wager-title" onMouseDown={(event) => { if (event.currentTarget === event.target) closeWager(); }}>
        {market.status === "open" ? <form onSubmit={(event) => { event.preventDefault(); if (wagerStep === "outcome") { if (selectedOutcome !== null) setWagerStep("stake"); } else if (wallet) void placeWager(); else void connect(); }} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-ash bg-parchment p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.11em] text-lake-blue">Room poll</p><h2 id="wager-title" className="mt-1 text-heading-sm leading-tight">{question}</h2><p className="mt-2 font-mono text-caption uppercase tracking-[0.07em] text-smoke">{wagerStep === "outcome" ? "Choose your stand" : "Set your stake"}</p></div><button type="button" onClick={closeWager} aria-label="Close wager" className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-lake-blue"><X className="size-5" aria-hidden /></button></div>
          {wagerStep === "outcome" ? (
            <>
              <fieldset className="mt-4"><legend className="sr-only">Choose your stand</legend><div className="space-y-2">{market.outcomeLabels.map((label, index) => { const selected = selectedOutcome === index; return <button key={label} type="button" aria-pressed={selected} onClick={() => setSelectedOutcome(index)} className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-lake-blue ${selected ? "border-off-black bg-periwinkle-mist/65" : "border-ash bg-white/40 hover:border-off-black"}`}><span className="font-mono text-body-sm">{label}</span><span className="flex items-center gap-2 font-mono text-caption tabular-nums text-smoke">{(calculated.outcomes[index]!.probabilityBps / 100).toFixed(2)}%{selected ? <Check className="size-4 text-off-black" aria-hidden /> : null}</span></button>; })}</div></fieldset>
              <button type="submit" disabled={selectedOutcome === null} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-off-black px-5 font-mono text-caption uppercase tracking-[0.06em] text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-lake-blue focus-visible:ring-offset-2">{selectedOutcome === null ? "Choose your stand" : "Continue"}</button>
            </>
          ) : (
            <>
              <div className="mt-5 flex min-h-12 items-center justify-between gap-3 border border-off-black bg-periwinkle-mist/45 px-4 py-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.08em] text-smoke">Your take</p><p className="mt-0.5 font-mono text-body-sm">{selectedOutcome === null ? "—" : market.outcomeLabels[selectedOutcome]}</p></div><button type="button" onClick={() => setWagerStep("outcome")} className="min-h-10 px-2 font-mono text-caption underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-lake-blue">Change</button></div>
              <fieldset className="mt-5"><legend className="font-mono text-caption uppercase tracking-[0.07em] text-smoke">How much conviction?</legend><div className="mt-2 grid grid-cols-3 gap-2">{["5", "10", "25"].map((value) => <button key={value} type="button" aria-pressed={!useCustomAmount && presetAmount === value} onClick={() => { setPresetAmount(value); setUseCustomAmount(false); }} className={`min-h-11 border px-2 font-mono text-caption tabular-nums focus-visible:ring-2 focus-visible:ring-lake-blue ${!useCustomAmount && presetAmount === value ? "border-off-black bg-off-black text-white" : "border-ash bg-white/40"}`}>{value} USDT</button>)}</div><label htmlFor="custom-wager" className="mt-3 block font-mono text-caption text-smoke">Or enter your own amount</label><div className="mt-1 flex items-center border border-ash bg-white/55 px-3 focus-within:ring-2 focus-within:ring-lake-blue"><input id="custom-wager" type="text" inputMode="decimal" autoComplete="off" value={customAmount} onFocus={() => setUseCustomAmount(true)} onChange={(event) => { setCustomAmount(event.target.value); setUseCustomAmount(true); }} placeholder="12.50" aria-describedby="custom-wager-help" className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-body tabular-nums focus:outline-none" /><span className="font-mono text-caption text-smoke">USDT</span></div><p id="custom-wager-help" className="mt-1.5 font-mono text-[10px] text-smoke">Minimum 1 USDT</p></fieldset>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-ash py-4 font-mono text-caption"><div><dt className="text-smoke">Your stake</dt><dd className="mt-1 text-body tabular-nums">{amount === null ? "—" : `${formatAmount(amount)} USDT`}</dd></div><div><dt className="text-smoke">Projected return</dt><dd className="mt-1 text-body tabular-nums">{selectedProjection === null ? "—" : `${formatAmount(selectedProjection)} USDT`}</dd></div><div><dt className="text-smoke">Protocol fee</dt><dd className="mt-1 tabular-nums">{(market.feeBps / 100).toFixed(2)}%</dd></div><div><dt className="text-smoke">Network</dt><dd className="mt-1 uppercase">{config.network}</dd></div></dl>
              {wallet ? <p className="mt-4 font-mono text-caption text-smoke">{wallet.name} · {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}</p> : <p className="mt-4 font-mono text-caption text-smoke">Prepare the funded FullTime play wallet before signing.</p>}
              {error ? <p className="mt-3 font-mono text-caption text-crimson" role="alert">{error}</p> : null}
              <button type="submit" disabled={busy || !walletRuntime.ready || (Boolean(wallet) && amount === null)} aria-busy={busy} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-lake-blue px-5 font-mono text-caption uppercase tracking-[0.06em] text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-off-black focus-visible:ring-offset-2">{busy ? <><LoaderCircle className="size-4 animate-spin" aria-hidden />Confirming…</> : wallet ? `Back ${amountText || "—"} USDT` : <><WalletCards className="size-4" aria-hidden />Prepare play wallet</>}</button>
              <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-smoke">Your wallet will show the Slip program transaction before anything moves.</p>
            </>
          )}
        </form> : <section className="w-full max-w-md border border-ash bg-parchment p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-caption uppercase tracking-[0.1em] text-lake-blue">Settled</p><h2 id="wager-title" className="mt-1 text-heading-sm">{market.status === "voided" ? "Market refunded" : market.winningOutcome === null ? "Result unavailable" : market.outcomeLabels[market.winningOutcome]}</h2></div><button type="button" onClick={closeWager} aria-label="Close result" className="grid size-10 place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-lake-blue"><X className="size-5" aria-hidden /></button></div><div className="mt-5 space-y-2">{tickets.filter((ticket) => ticket.market === market.address).map((ticket) => <div key={ticket.address} className="flex min-h-12 items-center justify-between gap-3 border border-ash bg-white/45 px-3 font-mono text-caption"><span>{market.outcomeLabels[ticket.outcomeIndex]} · {formatAmount(ticket.stake)} USDT</span>{!ticket.claimed ? <button type="button" disabled={busy || !wallet} onClick={() => void client.claimTicket({ market: market.address, ticket: ticket.address, caller: wallet!.address }).then(transact)} className="min-h-10 px-2 underline underline-offset-4 disabled:opacity-35">{market.status === "voided" ? "Refund" : "Claim"}</button> : <span className="text-smoke">Claimed</span>}</div>)}</div>{tickets.length === 0 ? <p className="mt-5 font-mono text-caption text-smoke">No connected-wallet ticket for this market.</p> : null}{error ? <p className="mt-3 font-mono text-caption text-crimson" role="alert">{error}</p> : null}</section>}
      </div> : null}
    </div>
  );
}
