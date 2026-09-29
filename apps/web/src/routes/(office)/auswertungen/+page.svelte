<script lang="ts">
  import RevenueChart from "$lib/components/RevenueChart.svelte";
  import { formatCents, todayIso } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const months = $derived(
    Array.from({ length: 12 }, (_, i) => {
      const period = `${data.year}-${String(i + 1).padStart(2, "0")}`;
      const s = data.soll.periods.find((p) => p.period === period);
      const t = data.ist.periods.find((p) => p.period === period);
      return {
        period,
        label: new Date(data.year, i, 1).toLocaleDateString("de-DE", { month: "short" }),
        soll: s?.netCents ?? 0,
        ist: t?.netCents ?? 0,
        sollGross: s?.grossCents ?? 0,
        istGross: t?.grossCents ?? 0,
        count: s?.count ?? 0,
      };
    }),
  );
  const today = todayIso();
  const lastMonth = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
</script>

<svelte:head><title>Auswertungen – objektakte</title></svelte:head>

<div class="spread">
  <h1>Auswertungen</h1>
  <nav class="row" aria-label="Jahr">
    <a class="button small" href="?jahr={data.year - 1}">← {data.year - 1}</a>
    <strong>{data.year}</strong>
    <a class="button small" href="?jahr={data.year + 1}">{data.year + 1} →</a>
  </nav>
</div>

<div class="grid kpis">
  <div class="card">
    <div class="small muted">Umsatz netto (Soll, nach Rechnungsdatum)</div>
    <div class="kpi">{formatCents(data.soll.total.netCents)}</div>
    <div class="small muted">brutto {formatCents(data.soll.total.grossCents)} · {data.soll.total.count} Belege</div>
  </div>
  <div class="card">
    <div class="small muted">Umsatz netto (Ist, nach Zahlungseingang)</div>
    <div class="kpi">{formatCents(data.ist.total.netCents)}</div>
    <div class="small muted">brutto {formatCents(data.ist.total.grossCents)}</div>
  </div>
</div>

<section class="card">
  <h2>Umsatz je Monat (netto)</h2>
  <RevenueChart {months} />
  <details>
    <summary>Tabelle</summary>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Monat</th><th class="num">Soll netto</th><th class="num">Soll brutto</th><th class="num">Ist netto</th><th class="num">Ist brutto</th></tr></thead>
        <tbody>
          {#each months as m (m.period)}
            <tr>
              <td>{m.period}</td>
              <td class="num">{formatCents(m.soll)}</td>
              <td class="num">{formatCents(m.sollGross)}</td>
              <td class="num">{formatCents(m.ist)}</td>
              <td class="num">{formatCents(m.istGross)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</section>

<section class="card">
  <h2>Export für die Steuerberatung</h2>
  <div class="grid">
    <form method="get" action="/auswertungen/datev" class="stack">
      <h3>DATEV-Buchungsstapel</h3>
      <label>Von <input type="date" name="von" value="{data.year}-01-01" required /></label>
      <label>Bis <input type="date" name="bis" value={today.startsWith(String(data.year)) ? today : `${data.year}-12-31`} required /></label>
      <button type="submit">DATEV-Datei herunterladen</button>
      <p class="small muted">Einstellungen unter <a href="/einstellungen/datev">DATEV</a>. Vor produktiver Nutzung einen Probeimport mit der Steuerberatung abstimmen.</p>
    </form>
    <form method="get" action="/auswertungen/monatspaket" class="stack">
      <h3>Monatspaket (ZIP)</h3>
      <label>Monat <input type="month" name="monat" value={lastMonth} required /></label>
      <button type="submit">Monatspaket herunterladen</button>
      <p class="small muted">DATEV-Stapel, Rechnungsausgangsliste, Zahlungseingänge, offene Posten und Rechnungs-PDFs.</p>
    </form>
  </div>
</section>

<style>
  .kpis {
    margin-bottom: 1rem;
  }
  .kpi {
    font-size: 1.5rem;
    font-weight: 700;
  }
  h3 {
    margin: 0;
  }
</style>
