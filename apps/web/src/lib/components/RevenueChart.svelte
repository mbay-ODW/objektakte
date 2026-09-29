<script lang="ts">
  import { formatCents } from "$lib/format";

  /** Gruppiertes Säulendiagramm Soll/Ist je Monat als SVG (Werte zusätzlich als Tabelle). */
  let {
    months,
  }: { months: { period: string; label: string; soll: number; ist: number }[] } = $props();

  const W = 720;
  const H = 240;
  const PAD = { top: 12, right: 8, bottom: 28, left: 64 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const max = $derived(Math.max(1, ...months.flatMap((m) => [m.soll, m.ist])));
  const min = $derived(Math.min(0, ...months.flatMap((m) => [m.soll, m.ist])));
  const scale = (v: number) => ((v - min) / (max - min)) * innerH;
  const zeroY = $derived(PAD.top + innerH - scale(0));
  const step = $derived(innerW / Math.max(1, months.length));
  const barW = $derived(Math.max(4, step / 2 - 6));
  const ticks = $derived([0, 0.5, 1].map((f) => min + (max - min) * f));
  function short(cents: number): string {
    const e = cents / 100;
    if (Math.abs(e) >= 1_000_000) return `${(e / 1_000_000).toFixed(1).replace(".", ",")} Mio. €`;
    if (Math.abs(e) >= 1_000) return `${Math.round(e / 1_000)} Tsd. €`;
    return `${Math.round(e)} €`;
  }
</script>

<figure>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Umsatz netto je Monat, Soll und Ist">
    {#each ticks as t (t)}
      {@const y = PAD.top + innerH - scale(t)}
      <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} class="grid" />
      <text x={PAD.left - 6} y={y + 4} text-anchor="end" class="axis">{short(t)}</text>
    {/each}
    {#each months as m, i (m.period)}
      {@const x = PAD.left + i * step + 3}
      {#each [["soll", m.soll], ["ist", m.ist]] as const as [kind, v], j (kind)}
        {@const h = Math.abs(scale(v) - scale(0))}
        <rect
          class={kind}
          x={x + j * (barW + 2)}
          y={v >= 0 ? zeroY - h : zeroY}
          width={barW}
          height={Math.max(h, v === 0 ? 0 : 1)}
        >
          <title>{m.period} {kind === "soll" ? "Soll" : "Ist"}: {formatCents(v)}</title>
        </rect>
      {/each}
      <text x={x + barW} y={H - 8} text-anchor="middle" class="axis">{m.label}</text>
    {/each}
  </svg>
  <figcaption class="small">
    <span class="key soll"></span> Soll (Rechnungsdatum)
    <span class="key ist"></span> Ist (Zahlungseingang)
  </figcaption>
</figure>

<style>
  figure {
    margin: 0;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .axis {
    fill: var(--muted);
    font-size: 11px;
  }
  rect.soll,
  .key.soll {
    fill: var(--primary);
    background: var(--primary);
  }
  rect.ist,
  .key.ist {
    fill: var(--warn);
    background: var(--warn);
  }
  .key {
    display: inline-block;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 2px;
    margin: 0 0.25rem 0 0.75rem;
    vertical-align: middle;
  }
</style>
