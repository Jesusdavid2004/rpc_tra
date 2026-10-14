"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ConnectError } from "@connectrpc/connect";
import "@/lib/client/i18n";
import { Role, type AuctionEvent } from "@/gen/remateya/v1/auction_pb";
import {
  auctionClient,
  loadSession,
  saveSession,
  type Session,
} from "@/lib/client/rpc";
import { useAuction } from "@/lib/client/use-auction";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
const buttonClass =
  "rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-emerald-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-md";

function describe(error: unknown): string {
  return ConnectError.from(error).rawMessage;
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [auctionId, setAuctionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // localStorage only exists after hydration, so state is set post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(loadSession());
    const stored = new URLSearchParams(window.location.search).get("auction");
    if (stored) setAuctionId(stored);
  }, []);

  function join(id: string) {
    setAuctionId(id);
    window.history.replaceState(null, "", `?auction=${id}`);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 text-slate-900">
      <header className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-emerald-800 to-emerald-600 p-5 text-white shadow-lg">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            🐂 {t("title")}
          </h1>
          <p className="text-sm text-emerald-100">{t("subtitle")}</p>
        </div>
        <select
          aria-label={t("language")}
          className={inputClass + " !w-auto"}
          value={i18n.language}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </header>

      {error && (
        <p className="rounded bg-red-100 p-2 text-red-800">
          {t("errors.generic", { message: error })}
        </p>
      )}

      {session ? (
        <SessionBar
          session={session}
          onLogout={() => {
            saveSession(null);
            setSession(null);
          }}
        />
      ) : (
        <LoginForm onDone={setSession} onError={setError} />
      )}

      {session && !auctionId && (
        <AuctionPicker session={session} onJoin={join} onError={setError} />
      )}
      {session && auctionId && (
        <AuctionRoom
          auctionId={auctionId}
          session={session}
          onError={setError}
        />
      )}
    </main>
  );
}

function SessionBar(props: { session: Session; onLogout: () => void }) {
  const { t } = useTranslation();
  const role =
    props.session.role === "AUCTIONEER"
      ? t("login.auctioneer")
      : t("login.bidder");
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/80 px-4 py-2 text-sm shadow-sm">
      <span>
        {t("login.signedInAs", { name: props.session.displayName, role })}
      </span>
      <button className="underline" onClick={props.onLogout}>
        {t("login.logout")}
      </button>
    </div>
  );
}

function LoginForm(props: {
  onDone: (session: Session) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Role>(Role.BIDDER);

  async function submit(event: FormEvent) {
    event.preventDefault();
    props.onError(null);
    try {
      const response = await auctionClient.login({
        role,
        displayName: name,
        pin,
      });
      const session: Session = {
        token: response.token,
        role: response.role === Role.AUCTIONEER ? "AUCTIONEER" : "BIDDER",
        displayName: response.displayName,
      };
      saveSession(session);
      props.onDone(session);
    } catch (error) {
      props.onError(describe(error));
    }
  }

  return (
    <form onSubmit={submit} className={cardClass + " space-y-3"}>
      <h2 className="text-lg font-bold">{t("login.title")}</h2>
      <input
        className={inputClass}
        placeholder={t("login.name")}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className={inputClass}
        aria-label={t("login.role")}
        value={role}
        onChange={(event) =>
          setRole(
            Number(event.target.value) === Role.AUCTIONEER
              ? Role.AUCTIONEER
              : Role.BIDDER,
          )
        }
      >
        <option value={Role.BIDDER}>{t("login.bidder")}</option>
        <option value={Role.AUCTIONEER}>{t("login.auctioneer")}</option>
      </select>
      {role === Role.AUCTIONEER && (
        <input
          type="password"
          className={inputClass}
          placeholder={t("login.pin")}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />
      )}
      <button className={buttonClass}>{t("login.submit")}</button>
    </form>
  );
}

function AuctionPicker(props: {
  session: Session;
  onJoin: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [name, setName] = useState("");

  async function create() {
    props.onError(null);
    try {
      const response = await auctionClient.createAuction({ name });
      props.onJoin(response.auctionId);
    } catch (error) {
      props.onError(describe(error));
    }
  }

  return (
    <section className={cardClass + " space-y-3"}>
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder={t("auction.idLabel")}
          value={id}
          onChange={(event) => setId(event.target.value.trim())}
        />
        <button
          className={buttonClass}
          disabled={!id}
          onClick={() => props.onJoin(id)}
        >
          {t("auction.join")}
        </button>
      </div>
      {props.session.role === "AUCTIONEER" && (
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder={t("auction.name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className={buttonClass} onClick={() => void create()}>
            {t("auction.create")}
          </button>
        </div>
      )}
    </section>
  );
}

function AuctionRoom(props: {
  auctionId: string;
  session: Session;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const view = useAuction(props.auctionId);
  const [now, setNow] = useState(() => Date.now());
  const lot = view.activeLot;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const remainingSeconds = lot
    ? Math.max(
        0,
        Math.ceil((Number(lot.closesAtMs) - (now + view.serverOffsetMs)) / 1000),
      )
    : 0;
  const minimum = lot
    ? lot.highestBid > 0
      ? lot.highestBid + lot.minIncrement
      : lot.basePrice
    : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span>{t("auction.current", { name: view.name })}</span>
        <span
          className={
            view.connection === "live" ? "text-emerald-700" : "text-amber-700"
          }
        >
          ● {t(`connection.${view.connection}`)}
        </span>
      </div>
      <p className="break-all text-xs text-neutral-500">{props.auctionId}</p>
      {view.error && <p className="text-red-700">{view.error}</p>}

      <div className={cardClass}>
        {lot ? (
          <div className="space-y-3">
            <h2 className="text-xl font-bold">
              {lot.animalType} · {lot.breed} · {lot.weightKg} kg ·{" "}
              {lot.ageMonths} m
            </h2>
            <p>
              {t("lot.highest")}:{" "}
              <strong>
                {lot.highestBid > 0
                  ? `${lot.highestBid} (${lot.highestBidder})`
                  : t("lot.noBids")}
              </strong>
            </p>
            <p>
              {t("lot.timeLeft")}:{" "}
              <strong
                className={
                  "text-4xl tabular-nums " +
                  (remainingSeconds <= 10 ? "text-red-600" : "text-emerald-700")
                }
              >
                {remainingSeconds}s
              </strong>
            </p>
            {props.session.role === "BIDDER" && (
              <BidForm
                auctionId={props.auctionId}
                lotId={lot.id}
                minimum={minimum}
                onError={props.onError}
              />
            )}
            {props.session.role === "AUCTIONEER" && (
              <button
                className={buttonClass}
                onClick={() =>
                  void auctionClient
                    .closeLot({ auctionId: props.auctionId, lotId: lot.id })
                    .catch((error: unknown) => props.onError(describe(error)))
                }
              >
                {t("lot.close")}
              </button>
            )}
          </div>
        ) : (
          <p>{t("lot.none")}</p>
        )}
      </div>

      {props.session.role === "AUCTIONEER" && !lot && (
        <OpenLotForm auctionId={props.auctionId} onError={props.onError} />
      )}

      <History events={view.history} />

      {view.closedLots.length > 0 && (
        <div className={cardClass}>
          <h3 className="font-bold">{t("lot.closed")}</h3>
          <ul className="text-sm">
            {view.closedLots.map((closed) => (
              <li key={closed.id}>
                {closed.animalType} {closed.breed}:{" "}
                {closed.winner
                  ? t("lot.winner", {
                      winner: closed.winner,
                      price: closed.finalPrice,
                    })
                  : t("lot.noWinner")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BidForm(props: {
  auctionId: string;
  lotId: string;
  minimum: number;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    props.onError(null);
    try {
      await auctionClient.placeBid({
        auctionId: props.auctionId,
        lotId: props.lotId,
        amount: Number(amount),
        idempotencyKey: crypto.randomUUID(),
      });
      setAmount("");
    } catch (error) {
      props.onError(describe(error));
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="number"
        className={inputClass + " !w-40"}
        placeholder={t("bid.amount")}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <button className={buttonClass} disabled={!amount}>
        {t("bid.submit")}
      </button>
      <span className="text-sm text-neutral-600">
        {t("bid.minimum", { amount: props.minimum })}
      </span>
    </form>
  );
}

function OpenLotForm(props: {
  auctionId: string;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    animalType: "Cattle",
    breed: "Brahman",
    weightKg: "450",
    ageMonths: "30",
    basePrice: "1000000",
    minIncrement: "50000",
    durationSeconds: "60",
  });

  const fields = useMemo(
    () =>
      [
        ["animalType", "lot.animalType", "text"],
        ["breed", "lot.breed", "text"],
        ["weightKg", "lot.weight", "number"],
        ["ageMonths", "lot.age", "number"],
        ["basePrice", "lot.basePrice", "number"],
        ["minIncrement", "lot.increment", "number"],
        ["durationSeconds", "lot.duration", "number"],
      ] as const,
    [],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    props.onError(null);
    try {
      await auctionClient.openLot({
        auctionId: props.auctionId,
        animalType: form.animalType,
        breed: form.breed,
        weightKg: Number(form.weightKg),
        ageMonths: Number(form.ageMonths),
        basePrice: Number(form.basePrice),
        minIncrement: Number(form.minIncrement),
        durationSeconds: Number(form.durationSeconds),
      });
    } catch (error) {
      props.onError(describe(error));
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cardClass + " grid grid-cols-2 gap-3"}
    >
      {fields.map(([key, label, type]) => (
        <label key={key} className="text-sm">
          {t(label)}
          <input
            type={type}
            className={inputClass}
            value={form[key]}
            onChange={(event) =>
              setForm({ ...form, [key]: event.target.value })
            }
          />
        </label>
      ))}
      <button className={buttonClass + " col-span-2"}>{t("lot.open")}</button>
    </form>
  );
}

function History(props: { events: AuctionEvent[] }) {
  const { t } = useTranslation();
  return (
    <div className={cardClass}>
      <h3 className="font-semibold">{t("history.title")}</h3>
      <ul className="max-h-64 overflow-auto text-sm">
        {props.events.map((event) => {
          const body = event.event;
          let text: string | null = null;
          switch (body.case) {
            case "lotOpened":
              text = t("history.lotOpened", {
                animal: body.value.lot?.animalType,
                breed: body.value.lot?.breed,
              });
              break;
            case "bidAccepted":
              text = t("history.accepted", {
                bidder: body.value.bidder,
                amount: body.value.amount,
              });
              break;
            case "bidRejected":
              text = t("history.rejected", {
                bidder: body.value.bidder,
                amount: body.value.amount,
                reason: body.value.reason,
              });
              break;
            case "timeExtended":
              text = t("history.extended");
              break;
            case "lotClosed":
              text = t("history.closed");
              break;
          }
          return text ? (
            <li key={event.sequence.toString()}>
              #{event.sequence.toString()} {text}
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}
