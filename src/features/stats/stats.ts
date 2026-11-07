// src/features/stats/stats.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Stats (#statsm): an overview of your list, and one page per breakdown
//  (Type, Generation, Sprite source…) with a share ring, favourites by average
//  tier, a tier × value table and one ring per tier. The numbers come from
//  breakdowns.ts; this file draws them.
// ─────────────────────────────────────────────────────────────────────────────
import { entryById, rankableEntries } from '../../core/items';
import { isPokemonList, state } from '../../core/state';
import type { ItemId, Tier } from '../../core/types';
import { byId } from '../../lib/dom';
import { html, type SafeHtml, setHtml } from '../../lib/html';
import { closePopovers } from '../../lib/ui';
import { labelTextColor } from '../appearance/theme';
import { spriteSrc } from '../sprites/sprites';
import { rankedIds } from '../tier-board/board';
import {
    type Breakdown,
    type BreakdownResult,
    breakdowns,
    computeBreakdown,
    statsOptions,
    tierAtScore,
    withSpriteInfoCache,
} from './breakdowns';
import { baseStatTotal } from './pokedex-extras';

type TableMode = 'count' | 'row' | 'tier';

/** The page shown ('' = overview) and how the table counts; remembered while the app is open. */
const statsView = { page: '', tableMode: 'count' as TableMode };

// ═════════════════════════════════════════════════════════════════════════════
//  SMALL PIECES
// ═════════════════════════════════════════════════════════════════════════════

const percent = (part: number, whole: number): string => (whole ? Math.round((part / whole) * 100) + '%' : '–');
const swatch = (color: string | undefined): SafeHtml => html`<i class="ssw" style="background:${color || '#6b7280'}"></i>`;
const tierChip = (tier: Tier): SafeHtml =>
    html`<span class="stt" style="background:${tier.color};color:${labelTextColor(tier)}">${tier.label}</span>`;
const bestThumbs = (ids: readonly ItemId[], count = 3): SafeHtml[] =>
    ids.slice(0, count).map((id) => html`<img alt="" title="${entryById.get(id)?.name || ''}" src="${spriteSrc(id)}" data-px>`);

interface RingSegment {
    label: string;
    count: number;
    color: string;
}

/** A ring chart (SVG): one arc per segment, the total (or `middle`) in the hole. */
function donutChart(segments: readonly RingSegment[], size: number, thickness: number, middle?: string, below?: string): SafeHtml {
    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;
    const centre = size / 2;
    const total = segments.reduce((sum, segment) => sum + segment.count, 0);
    const shown = segments.filter((segment) => segment.count);
    let offset = 0;
    const arcs = shown.map((segment) => {
        const length = (segment.count / total) * circumference;
        const gap = shown.length > 1 ? Math.min(1.5, length * 0.3) : 0;
        const arc = html`<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="${thickness}" stroke-dasharray="${(length - gap).toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${centre} ${centre})"><title>${segment.label}: ${segment.count} (${Math.round((segment.count / total) * 100)}%)</title></circle>`;
        offset += length;
        return arc;
    });
    return html`<svg class="dn" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"><circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="var(--s3)" stroke-width="${thickness}"/>${arcs}${
        middle != null &&
        html`<text x="${centre}" y="${centre + (below ? -1 : size * 0.06)}" text-anchor="middle" class="dnmid" style="font-size:${Math.round(size * 0.2)}px">${middle}</text>`
    }${below && html`<text x="${centre}" y="${centre + size * 0.15}" text-anchor="middle" class="dnsub" style="font-size:${Math.max(9, Math.round(size * 0.085))}px">${below}</text>`}</svg>`;
}

/** The biggest `limit` values as segments, the rest as one grey "Other". */
function topSegments(
    values: readonly { value: string; count: number }[],
    colors: Map<string, string>,
    limit: number,
    otherLabel: (rest: number) => string,
): RingSegment[] {
    const segments = values.slice(0, limit).map((stats) => ({ label: stats.value, count: stats.count, color: colors.get(stats.value)! }));
    const rest = values.slice(limit);
    if (rest.length)
        segments.push({ label: otherLabel(rest.length), count: rest.reduce((sum, stats) => sum + stats.count, 0), color: '#6b7280' });
    return segments;
}

// ═════════════════════════════════════════════════════════════════════════════
//  OVERVIEW
// ═════════════════════════════════════════════════════════════════════════════

function overviewView(all: readonly Breakdown[]): SafeHtml {
    const ranked = rankedIds();
    const total = rankableEntries().length;
    const pokemon = isPokemonList();
    const inTier = state.tiers.map((tier) => tier.items.filter((id) => entryById.has(id)));
    const biggest = Math.max(1, ...inTier.map((ids) => ids.length));
    const averageStatTotal = (ids: ItemId[]) => {
        const totals = ids.map((id) => baseStatTotal(entryById.get(id))).filter((value): value is number => value != null);
        return totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : null;
    };
    const facts = html`<div class="sfacts"><div><b>${ranked.size}</b><span>ranked of ${total} (${percent(ranked.size, total)})</span></div><div><b>${Math.max(0, total - ranked.size)}</b><span>still in the pool</span></div><div><b>${state.tiers.length}</b><span>tiers</span></div>${
        inTier[0] && html`<div><b>${inTier[0].length}</b><span>in ${state.tiers[0]!.label}</span></div>`
    }</div>`;
    if (!ranked.size)
        return html`${facts}<p class="note">Rank a few ${pokemon ? 'Pokémon' : 'items'} and your stats will show up here.</p>`;

    // what you like: one card per breakdown
    const cards = all
        .filter((breakdown) => breakdown.key !== 'tags' && breakdown.key !== 'sgame')
        .map((breakdown) => {
            const result = computeBreakdown(breakdown);
            const top = result.favourites.filter((stats) => stats.count >= result.minimumCount);
            if (!top.length || result.values.length < 2) return null;
            const favourite = top[0]!;
            const least = top.length > 1 ? top[top.length - 1]! : null;
            const mostInTop = [...result.byCount].sort((a, b) => b.perTier[0]! - a.perTier[0]!)[0];
            return html`<button class="scard taste" data-go="${breakdown.key}" title="Open the ${breakdown.label} breakdown"><h4>${breakdown.label}</h4><div class="tbig">${swatch(result.colors.get(favourite.value))}${favourite.value}</div>
                <div class="note">averages ${tierChip(tierAtScore(favourite.average))}, ${favourite.count} ranked</div>${least && least !== favourite && html`<div class="note">least: ${least.value} ${tierChip(tierAtScore(least.average))}</div>`}${
                    mostInTop?.perTier[0] &&
                    html`<div class="note">most in ${state.tiers[0]!.label}: ${mostInTop.value} (${mostInTop.perTier[0]})</div>`
                }</button>`;
        })
        .filter((card): card is SafeHtml => card !== null);

    const tierRows = state.tiers.map(
        (tier, i) =>
            html`<tr><td>${tierChip(tier)}</td><td class="num">${inTier[i]!.length}</td><td class="wide"><div class="favbar"><b style="width:${(inTier[i]!.length / biggest) * 100}%;background:${tier.color}"></b></div><span class="note">${percent(inTier[i]!.length, ranked.size)}</span></td>${
                pokemon && html`<td class="num">${averageStatTotal(inTier[i]!) ?? '–'}</td>`
            }<td class="favth">${bestThumbs(inTier[i]!)}</td></tr>`,
    );
    return html`${facts}${
        cards.length > 0 &&
        html`<h3 class="sh">Your favourites <span class="note">(highest average tier, with at least a couple ranked). Click one for the full breakdown.</span></h3><div class="sgrid tastes">${cards}</div>`
    }<h3 class="sh">Tiers</h3><div class="scard"><table class="tiert"><tr><th></th><th>Items</th><th class="wide">Share of ranked</th>${pokemon && html`<th title="Average base stat total">Avg BST</th>`}<th>Best</th></tr>${tierRows}</table></div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ONE BREAKDOWN
// ═════════════════════════════════════════════════════════════════════════════

function notesFor(breakdown: Breakdown, result: BreakdownResult, noun: string): SafeHtml {
    const typeToggle =
        breakdown.key === 'type' &&
        html`<span class="seg" title="Count dual-type Pokémon for both types, or only for their first type"><button data-first="0" class="${statsOptions.firstTypeOnly ? '' : 'on'}">Both types</button><button data-first="1" class="${statsOptions.firstTypeOnly ? 'on' : ''}">First type only</button></span>`;
    const several =
        breakdown.key === 'type'
            ? 'Dual types count once for each type, so the shares add up to more than 100%.'
            : 'Items with several values count once for each.';
    const one = result.without === 1;
    const without =
        result.without > 0 &&
        `${result.without} ranked ${one ? (isPokemonList() ? 'Pokémon' : 'item') : noun} ${one ? 'has' : 'have'} no ${breakdown.label.toLowerCase()} and ${one ? 'is' : 'are'} left out.`;
    return html`<div class="snote">${typeToggle}${breakdown.note && html`<span class="note">${breakdown.note}</span>`}${result.multiple && html`<span class="note">${several}</span>`}${without && html`<span class="note">${without}</span>`}</div>`;
}

function shareCard(breakdown: Breakdown, result: BreakdownResult, noun: string): SafeHtml {
    const segments = topSegments(result.byCount, result.colors, 11, (rest) => `Other (${rest})`);
    const counted = result.ranked - result.without;
    const legend = segments.map(
        (segment) =>
            html`<div title="${breakdown.tipOf?.(segment.label) ?? ''}">${swatch(segment.color)}<em>${segment.label}</em><span>${segment.count} (${percent(segment.count, counted)})</span></div>`,
    );
    return html`<div class="scard"><h4>Share of your ranked ${noun}</h4><div class="dnwrap">${donutChart(segments, 170, 30, String(counted), 'ranked')}<div class="dnleg">${legend}</div></div></div>`;
}

function favouritesCard(breakdown: Breakdown, result: BreakdownResult): SafeHtml {
    const rows = result.favourites.map((stats, index) => {
        const tooFew = stats.count < result.minimumCount;
        const tip =
            (breakdown.tipOf ? breakdown.tipOf(stats.value) + '\n' : '') +
            `${stats.value}: ${stats.count} ranked, average score ${Math.round(stats.average)} / 100${tooFew ? ' (too few to count)' : ''}`;
        const color = result.colors.get(stats.value);
        return html`<div class="favrow${tooFew ? ' few' : ''}" title="${tip}"><div class="fn"><span class="rk">${tooFew ? '' : index + 1}</span>${swatch(color)}<em>${stats.value}</em></div><div class="favbar"><b style="width:${Math.max(3, stats.average)}%;background:${color}"></b></div><div class="fr">${tierChip(tierAtScore(stats.average))}<span class="note">${stats.count}</span><span class="favth">${bestThumbs(stats.ids)}</span></div></div>`;
    });
    return html`<div class="scard"><h4>Favourites <span class="note">by average tier</span></h4><div class="favs">${rows}</div>
        <div class="note spaced">The top tier scores 100 and the bottom tier 0; each bar is the average. Faded rows have fewer than ${result.minimumCount} ranked.</div></div>`;
}

/** Where each value ended up: counts (or shares of the row / tier), shaded like a heat map. */
function tableCard(breakdown: Breakdown, result: BreakdownResult): SafeHtml {
    const rows = result.byOrder.slice(0, 60);
    const mode = statsView.tableMode;
    const highest = Math.max(1, ...rows.flatMap((stats) => stats.perTier));
    const cell = (count: number, stats: (typeof rows)[number], tierIndex: number) => {
        const tierSize = result.tierSizes[tierIndex]!;
        const share =
            mode === 'row'
                ? stats.count
                    ? count / stats.count
                    : 0
                : mode === 'tier'
                  ? tierSize
                      ? count / tierSize
                      : 0
                  : count / highest;
        const tierLabel = state.tiers[tierIndex]!.label;
        const title = `${stats.value} in ${tierLabel}: ${count} (${percent(count, stats.count)} of ${stats.value}, ${percent(count, tierSize)} of the tier)`;
        const style = `background:color-mix(in srgb,var(--accent) ${Math.round(share * 85)}%,transparent)${share > 0.5 ? ';color:var(--on-accent)' : ''}`;
        return html`<td style="${style}" title="${title}">${count ? (mode === 'count' ? count : Math.round(share * 100) + '%') : '·'}</td>`;
    };
    const modeButton = (value: TableMode, label: string) =>
        html`<button data-hm="${value}" class="${mode === value ? 'on' : ''}">${label}</button>`;
    const header = html`<tr><th></th>${state.tiers.map((tier) => html`<th>${tierChip(tier)}</th>`)}<th class="num">Ranked</th>${!breakdown.rankedOnly && html`<th class="num" title="How many of them you have ranked so far">Done</th>`}</tr>`;
    const body = rows.map(
        (stats) =>
            html`<tr><th class="rl" title="${breakdown.tipOf?.(stats.value) ?? ''}">${swatch(result.colors.get(stats.value))} ${stats.value}</th>${stats.perTier.map((count, i) => cell(count, stats, i))}<td class="num"><b>${stats.count}</b></td>${
                !breakdown.rankedOnly && html`<td class="num note">${percent(stats.count, stats.count + stats.inPool)}</td>`
            }</tr>`,
    );
    return html`<div class="scard"><h4>Where each one ended up <span class="seg hmseg">${modeButton('count', 'Count')}${modeButton('row', '% of row')}${modeButton('tier', '% of tier')}</span></h4>
        <div class="hmscroll"><table class="hm">${header}${body}</table></div>${result.byOrder.length > rows.length && html`<div class="note">Showing the first ${rows.length} of ${result.byOrder.length}.</div>`}</div>`;
}

/** One small ring per tier: what each tier is made of. */
function eachTierCards(result: BreakdownResult): SafeHtml[] {
    return state.tiers.map((tier, i) => {
        const inTier = result.byCount.filter((stats) => stats.perTier[i]).sort((a, b) => b.perTier[i]! - a.perTier[i]!);
        if (!inTier.length) return html``;
        const size = result.tierSizes[i]!;
        const segments = topSegments(
            inTier.map((stats) => ({ value: stats.value, count: stats.perTier[i]! })),
            result.colors,
            8,
            () => 'Other',
        );
        const top = inTier
            .slice(0, 4)
            .map(
                (stats) =>
                    html`<div>${swatch(result.colors.get(stats.value))}<em>${stats.value}</em><span>${percent(stats.perTier[i]!, size)}</span></div>`,
            );
        return html`<div class="tc">${donutChart(segments, 84, 16, String(size))}<div class="tcr">${tierChip(tier)}${top}${inTier.length > 4 && html`<div class="note">+${inTier.length - 4} more</div>`}</div></div>`;
    });
}

function breakdownView(breakdown: Breakdown): SafeHtml {
    const result = computeBreakdown(breakdown);
    const noun = isPokemonList() ? 'Pokémon' : 'items';
    if (!result.ranked) return html`<p class="note">Nothing is ranked yet.</p>`;
    const notes = notesFor(breakdown, result, noun);
    if (!result.values.length) return html`${notes}<p class="note">None of the ranked ${noun} have a ${breakdown.label.toLowerCase()}.</p>`;
    return html`${notes}<div class="sgrid two">${shareCard(breakdown, result, noun)}${favouritesCard(breakdown, result)}</div>${tableCard(breakdown, result)}<h3 class="sh">Each tier</h3><div class="tierd">${eachTierCards(result)}</div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE WINDOW
// ═════════════════════════════════════════════════════════════════════════════

export function openStats(): void {
    const all = breakdowns();
    const menu = byId<HTMLSelectElement>('statfacet');
    setHtml(
        menu,
        html`<option value="">Overview</option>${all.map((breakdown) => html`<option value="${breakdown.key}">${breakdown.label}</option>`)}`,
    );
    menu.value = all.some((breakdown) => breakdown.key === statsView.page) ? statsView.page : '';
    renderStats();
    closePopovers();
    byId('statsm').classList.add('show');
    byId('statsbox').scrollTop = 0;
}

function renderStats(): void {
    const page = byId<HTMLSelectElement>('statfacet').value;
    statsView.page = page;
    try {
        localStorage.setItem('pt_statk', page);
    } catch {}
    const all = breakdowns();
    const breakdown = all.find((b) => b.key === page);
    setHtml(
        byId('statsbody'),
        withSpriteInfoCache(() => (breakdown ? breakdownView(breakdown) : overviewView(all))),
    );
}

/** Redraws without jumping back to the top. */
function redrawInPlace(): void {
    const scroll = byId('statsbox').scrollTop;
    renderStats();
    byId('statsbox').scrollTop = scroll;
}

// ── wiring (runs once at start-up, from main.ts) ──
export function setupStats(): void {
    try {
        statsView.page = localStorage.getItem('pt_statk') || '';
    } catch {}
    byId('statfacet').onchange = () => {
        renderStats();
        byId('statsbox').scrollTop = 0;
    };
    byId('statsbtn').onclick = openStats;
    byId('statsx').onclick = () => byId('statsm').classList.remove('show');
    byId('statsbody').addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('[data-go],[data-first],[data-hm]');
        if (!button) return;
        if (button.dataset.go != null) {
            byId<HTMLSelectElement>('statfacet').value = button.dataset.go;
            renderStats();
            byId('statsbox').scrollTop = 0;
            return;
        }
        if (button.dataset.first != null) statsOptions.firstTypeOnly = button.dataset.first === '1';
        if (button.dataset.hm) statsView.tableMode = button.dataset.hm as TableMode;
        redrawInPlace();
    });
}
