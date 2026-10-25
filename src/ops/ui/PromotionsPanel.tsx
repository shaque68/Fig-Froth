import { useState } from "react";
import { ExternalLink, Megaphone, Square, Tag } from "lucide-react";
import { getIngredient } from "../engine/data";
import type { PromoPost } from "../engine/brief";
import { formatQty } from "../engine/inventory";
import { formatCents } from "../engine/money";
import { formatDay } from "../engine/orders";
import { bestOption, bundleOptions, MARGIN_FLOOR, promotionCopy, promotionTitle, sellableDrinks, type PromoOption, type PromoSuggestion, type PublishInput } from "../engine/promotions";
import { livePromotions, type Promotion, type World } from "../engine/sim";

const pct = (value: number) => `${Math.round(value * 100)}%`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const daysText = (days: number) => (days < 1.5 ? "the rest of today" : `${Math.round(days)} days`);

type Actions = {
  onPublish: (input: PublishInput) => void;
  onEnd: (id: string) => void;
  onWrite: (promo: PromoPost) => void;
};

function StepChips({ options, selected, recommended, onSelect, label }: { options: PromoOption[]; selected: number; recommended?: number; onSelect: (percent: number) => void; label: string }) {
  return (
    <div className="ops-chips promo-chips" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.percentOff} role="radio" aria-checked={selected === option.percentOff} className={`${selected === option.percentOff ? "is-selected" : ""} ${option.allowed ? "" : "is-blocked"}`} onClick={() => onSelect(option.percentOff)} title={option.blockedReason}>
          {option.percentOff}% off{option.percentOff === recommended && <span>suggested</span>}
        </button>
      ))}
    </div>
  );
}

function Forecast({ option, ingredientId }: { option: PromoOption; ingredientId?: string }) {
  const over = ingredientId ? daysText(option.days) : "a week";
  return (
    <dl className="promo-forecast">
      <div><dt>Extra drinks</dt><dd>about {Math.round(option.extraPerDay * option.days)} over {over}</dd></div>
      {ingredientId && <div><dt>{getIngredient(ingredientId).name} saved</dt><dd>{formatQty(ingredientId, Math.round(option.savedQty))} ({formatCents(option.savedCents)})</dd></div>}
      <div><dt>Profit on extra sales</dt><dd>{formatCents(option.extraProfitCents)}</dd></div>
      <div><dt>Discount on sales we’d make anyway</dt><dd>−{formatCents(option.givenAwayCents)}</dd></div>
      <div className="promo-net"><dt>Net for the shop</dt><dd className={option.netCents < 0 ? "text-warn" : ""}>{option.netCents < 0 ? "−" : ""}{formatCents(Math.abs(option.netCents))}</dd></div>
    </dl>
  );
}

function PriceLine({ kind, option }: { kind: PromoSuggestion["kind"]; option: PromoOption }) {
  return (
    <p className="promo-price">
      <del>{formatCents(option.regularCents)}</del> <strong>{formatCents(option.priceCents)}</strong>{kind === "bundle" ? " for both" : ""}
      <span className={option.allowed ? "" : "text-warn"}> · {pct(option.marginAfter)} margin</span>
    </p>
  );
}

function BannerPreview({ kind, productIds, percentOff }: PromoPost) {
  const copy = promotionCopy(kind, productIds, percentOff);
  return (
    <div className="promo-banner-preview" aria-label="Storefront banner preview">
      <span className="ops-eyebrow">On the storefront</span>
      <strong>{copy.headline}</strong>
      <span>{copy.detail}</span>
    </div>
  );
}

function SuggestionCard({ suggestion, onPublish, onWrite }: { suggestion: PromoSuggestion } & Pick<Actions, "onPublish" | "onWrite">) {
  const [selected, setSelected] = useState(suggestion.recommended);
  const option = suggestion.options.find((candidate) => candidate.percentOff === selected) ?? suggestion.options[0];
  const atRisk = suggestion.atRisk!;
  const ingredient = getIngredient(atRisk.ingredientId).name.toLowerCase();
  const post = { kind: suggestion.kind, productIds: suggestion.productIds, percentOff: option.percentOff };
  return (
    <article className="po-card promo-card">
      <p className="ops-eyebrow"><Tag size={14} aria-hidden="true" /> {suggestion.kind === "discount" ? "Sale" : "Bundle"} · uses {ingredient} · use by {formatDay(atRisk.expiresDay)}</p>
      <h3>{promotionTitle(post)}</h3>
      <p className="promo-why">About {formatQty(atRisk.ingredientId, Math.round(atRisk.qty))} of {ingredient} ({formatCents(atRisk.cents)}) is likely to be thrown out at today’s pace{suggestion.kind === "bundle" ? `. The bundle talks customers who came for one of these drinks into adding the other, so most of the discount goes to second drinks we wouldn’t otherwise sell` : ""}.</p>
      <StepChips options={suggestion.options} selected={selected} recommended={suggestion.recommended} onSelect={setSelected} label={suggestion.kind === "discount" ? "Discount" : "Bundle discount"} />
      <PriceLine kind={suggestion.kind} option={option} />
      <Forecast option={option} ingredientId={atRisk.ingredientId} />
      <BannerPreview {...post} />
      {option.blockedReason && <p className="promo-blocked" role="status">{option.blockedReason}</p>}
      <div className="po-actions">
        <button className="ops-button ops-button-primary" disabled={!option.allowed} onClick={() => onPublish({ kind: suggestion.kind, productIds: suggestion.productIds, percentOff: option.percentOff, option, atRisk })}><Megaphone size={16} /> Publish to storefront</button>
        <button className="ops-button" onClick={() => onWrite(post)}>Draft social post</button>
      </div>
    </article>
  );
}

function LiveCard({ promo, world, onEnd, onWrite }: { promo: Promotion; world: World } & Pick<Actions, "onEnd" | "onWrite">) {
  const batch = promo.batchId ? Object.values(world.stock).flat().find((candidate) => candidate.id === promo.batchId) : undefined;
  const sold = promo.results.drinks + promo.results.bundles * 2;
  return (
    <article className="po-card promo-card is-live">
      <header className="po-head">
        <div>
          <h3>{promotionTitle(promo)}</h3>
          <p className="po-dates">Since {formatDay(promo.startDay)} · {promo.endDay !== undefined ? `through ${formatDay(promo.endDay)}` : "until you end it"}</p>
        </div>
        <span className="po-status po-status-live">Live</span>
      </header>
      <BannerPreview kind={promo.kind} productIds={promo.productIds} percentOff={promo.percentOff} />
      <p className="promo-results">
        <strong>{promo.kind === "bundle" ? `${promo.results.bundles} ${promo.results.bundles === 1 ? "bundle" : "bundles"}` : `${sold} ${sold === 1 ? "drink" : "drinks"}`} sold</strong>
        <span>{formatCents(promo.results.discountCents)} in discounts</span>
        {promo.ingredientId && <span>{batch ? `${formatQty(promo.ingredientId, Math.round(batch.qty))} of that ${getIngredient(promo.ingredientId).name.toLowerCase()} left` : `That ${getIngredient(promo.ingredientId).name.toLowerCase()} is used up`}</span>}
      </p>
      <div className="po-actions">
        <button className="ops-button ops-button-danger" onClick={() => onEnd(promo.id)}><Square size={15} /> End promotion</button>
        <button className="ops-button" onClick={() => onWrite({ kind: promo.kind, productIds: promo.productIds, percentOff: promo.percentOff })}>Draft social post</button>
        <a className="text-link" href="/" target="_blank" rel="noreferrer">View storefront <ExternalLink size={14} aria-hidden="true" /></a>
      </div>
    </article>
  );
}

function BundleBuilder({ world, onPublish, onWrite }: { world: World } & Pick<Actions, "onPublish" | "onWrite">) {
  const drinks = sellableDrinks();
  const [first, setFirst] = useState(drinks[0]?.id ?? "");
  const [second, setSecond] = useState(drinks[3]?.id ?? drinks[1]?.id ?? "");
  const [percent, setPercent] = useState(10);
  const same = first === second;
  const live = livePromotions(world).some((promo) => promo.kind === "bundle" && promo.productIds.includes(first) && promo.productIds.includes(second));
  const options = same ? [] : bundleOptions(world, [first, second]);
  const option = options.find((candidate) => candidate.percentOff === percent);
  const best = bestOption(options);
  return (
    <section className="promo-builder" aria-labelledby="builder-title">
      <h3 id="builder-title" className="po-group-title">Build a bundle</h3>
      <p className="ops-muted">Pair any two drinks for a discount on the pair. It stacks on any sale price.</p>
      <div className="whatif promo-builder-pick">
        <label>Pair <select value={first} onChange={(event) => setFirst(event.target.value)}>{drinks.map((drink) => <option key={drink.id} value={drink.id}>{drink.name}</option>)}</select></label>
        <label>with <select value={second} onChange={(event) => setSecond(event.target.value)}>{drinks.map((drink) => <option key={drink.id} value={drink.id}>{drink.name}</option>)}</select></label>
      </div>
      {same ? <p className="promo-blocked">Pick two different drinks.</p> : option && <>
        <StepChips options={options} selected={percent} recommended={best?.percentOff} onSelect={setPercent} label="Bundle discount" />
        <PriceLine kind="bundle" option={option} />
        <Forecast option={option} />
        {option.blockedReason && <p className="promo-blocked" role="status">{option.blockedReason}</p>}
        {live && <p className="promo-blocked" role="status">This bundle is already live.</p>}
        <div className="po-actions">
          <button className="ops-button ops-button-primary" disabled={!option.allowed || live} onClick={() => onPublish({ kind: "bundle", productIds: [first, second], percentOff: percent, option })}><Megaphone size={16} /> Publish bundle</button>
          <button className="ops-button" onClick={() => onWrite({ kind: "bundle", productIds: [first, second], percentOff: percent })}>Draft social post</button>
        </div>
      </>}
    </section>
  );
}

export function PromotionsPanel({ world, suggestions, onPublish, onEnd, onWrite }: { world: World; suggestions: PromoSuggestion[] } & Actions) {
  const live = livePromotions(world);
  const ended = [...world.promotions].reverse().filter((promo) => promo.status === "ended");
  const firstRisk = suggestions[0]?.atRisk;
  // Ideas for the same batch can't save more than the batch.
  const savedByIdeas = [...new Set(suggestions.map((suggestion) => suggestion.atRisk!.batchId))].reduce((sum, batchId) => {
    const forBatch = suggestions.filter((suggestion) => suggestion.atRisk!.batchId === batchId);
    const qty = forBatch.reduce((total, suggestion) => total + (suggestion.options.find((option) => option.percentOff === suggestion.recommended)?.savedQty ?? 0), 0);
    const atRisk = forBatch[0].atRisk!;
    return sum + Math.round((atRisk.cents * Math.min(qty, atRisk.qty)) / Math.max(1, atRisk.qty));
  }, 0);
  const takeaway = firstRisk
    ? `About ${formatQty(firstRisk.ingredientId, Math.round(firstRisk.qty))} of ${getIngredient(firstRisk.ingredientId).name.toLowerCase()} (${formatCents(firstRisk.cents)}) will be thrown out ${formatDay(firstRisk.expiresDay)} at today’s pace. ${suggestions.length === 1 ? "The suggested promotion" : `The ${suggestions.length} suggested promotions`} should save about ${formatCents(savedByIdeas)} of it.`
    : live.length > 0
      ? `${live.length === 1 ? "One promotion is" : `${live.length} promotions are`} live on the storefront: ${list(live.map(promotionTitle))}.`
      : "Nothing on the shelf is at risk of being thrown out, so there’s nothing to put on sale.";
  return (
    <div className="promotions">
      <p className="compare-takeaway">{takeaway}</p>
      <p className="ops-muted compare-sub">The agent suggests a sale or a bundle only when a perishable batch would otherwise be thrown out, and only when it should come out ahead: stock saved plus profit on extra sales, minus the discount on drinks people would have bought anyway. Nothing goes under a {pct(MARGIN_FLOOR)} margin, and nothing reaches the storefront until you publish it.</p>

      {live.length > 0 && (
        <section className="po-group">
          <h3 className="po-group-title">Live on the storefront <span>{live.length}</span></h3>
          <div className="po-grid">{live.map((promo) => <LiveCard key={promo.id} promo={promo} world={world} onEnd={onEnd} onWrite={onWrite} />)}</div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="po-group">
          <h3 className="po-group-title">Suggested <span>{suggestions.length}</span></h3>
          <div className="po-grid">{suggestions.map((suggestion) => <SuggestionCard key={`${suggestion.key}:${world.day}`} suggestion={suggestion} onPublish={onPublish} onWrite={onWrite} />)}</div>
        </section>
      )}

      <BundleBuilder world={world} onPublish={onPublish} onWrite={onWrite} />

      {ended.length > 0 && (
        <section className="po-group">
          <h3 className="po-group-title">Past promotions <span>{ended.length}</span></h3>
          <table className="ops-table">
            <thead><tr><th scope="col">Promotion</th><th scope="col">Ran</th><th scope="col" className="num">Sold</th><th scope="col" className="num">Discounts</th><th scope="col">Why it ended</th></tr></thead>
            <tbody>
              {ended.map((promo) => (
                <tr key={promo.id}>
                  <td><strong>{promotionTitle(promo)}</strong></td>
                  <td>{formatDay(promo.startDay)} – {formatDay(promo.endedDay ?? promo.startDay)}</td>
                  <td className="num">{promo.kind === "bundle" ? `${promo.results.bundles} bundles` : `${promo.results.drinks} drinks`}</td>
                  <td className="num">{formatCents(promo.results.discountCents)}</td>
                  <td className="ops-muted">{promo.endedReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="ops-fineprint">Forecasts assume each 1% off a drink sells about 2% more of it, and each 1% off a bundle talks about 1.5% of customers buying one of its drinks into adding the other.</p>
    </div>
  );
}

function ideasPhrase(suggestions: PromoSuggestion[]): string {
  if (suggestions.length === 1) return suggestions[0].kind === "discount" ? "A sale" : "A bundle";
  if (suggestions.length === 2 && suggestions[0].kind !== suggestions[1].kind) return "A sale and a bundle";
  return `${suggestions.length} promotions`;
}

/** Compact card for the Today tab. */
export function PromoSideCard({ world, suggestions, onOpen }: { world: World; suggestions: PromoSuggestion[]; onOpen: () => void }) {
  const live = livePromotions(world);
  if (live.length === 0 && suggestions.length === 0) return null;
  const best = suggestions[0];
  return (
    <div className={`special-card promo-side ${live.length > 0 && !best ? "is-running" : ""}`}>
      <Megaphone size={20} aria-hidden="true" />
      <div>
        {best?.atRisk && <><p className="ops-eyebrow">Promotion {suggestions.length === 1 ? "idea" : "ideas"}</p>
          <p>{ideasPhrase(suggestions)} could use up about {formatQty(best.atRisk.ingredientId, Math.round(best.atRisk.qty))} of {getIngredient(best.atRisk.ingredientId).name.toLowerCase()} before {formatDay(best.atRisk.expiresDay)}.</p></>}
        {live.length > 0 && <p><strong>Live on the storefront:</strong> {list(live.map(promotionTitle))}.</p>}
        <button className="text-link" onClick={onOpen}>Open promotions →</button>
      </div>
    </div>
  );
}
