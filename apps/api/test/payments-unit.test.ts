import { describe, expect, it } from "vitest";
import { encodeCp1252 } from "../src/lib/cp1252.js";
import { deriveCaseStatus } from "../src/modules/cases/status.js";
import {
  parseAmountToCents,
  parseBankCsv,
  parseCsv,
  parseDate,
} from "../src/modules/payments/csv.js";
import {
  autoAllocations,
  nameSimilarity,
  suggestAllocations,
} from "../src/modules/payments/matcher.js";
import { buildDatevCsv, datevAmount } from "../src/modules/reports/datev.js";
import { splitGross } from "../src/modules/reports/service.js";

const mapping = {
  delimiter: ";" as const,
  dateFormat: "dd.mm.yyyy" as const,
  decimal: "," as const,
  skipLines: 0,
  columns: {
    bookingDate: "Buchungstag",
    amount: "Betrag",
    counterpartyName: "Name",
    purpose: "Verwendungszweck",
  },
};

describe("CSV", () => {
  it("parst Anführungszeichen, eingebettete Trenner und Zeilenumbrüche", () => {
    expect(parseCsv('a;b\r\n"x;y";"mit ""Zitat""\nzweite Zeile"\n', ";")).toEqual([
      ["a", "b"],
      ["x;y", 'mit "Zitat"\nzweite Zeile'],
    ]);
  });

  it("liest deutsche Beträge und Daten", () => {
    expect(parseAmountToCents("1.234,56", ",")).toBe(123456);
    expect(parseAmountToCents("-50,00 €", ",")).toBe(-5000);
    expect(parseAmountToCents("1,234.56", ".")).toBe(123456);
    expect(() => parseAmountToCents("abc", ",")).toThrow();
    expect(parseDate("1.9.26", "dd.mm.yyyy")).toBe("2026-09-01");
    expect(parseDate("2026-09-01", "yyyy-mm-dd")).toBe("2026-09-01");
  });

  it("meldet fehlende Spalten und fehlerhafte Zeilen", () => {
    const bad = parseBankCsv("Datum;Betrag\n01.09.2026;1,00\n", mapping);
    expect(bad.errors[0]?.message).toContain("Buchungstag");
    const partly = parseBankCsv(
      "Buchungstag;Betrag;Name;Verwendungszweck\n01.09.2026;100,00;A;x\nkaputt;1,00;B;y\n",
      mapping,
    );
    expect(partly.transactions).toHaveLength(1);
    expect(partly.errors).toEqual([{ line: 3, message: 'Ungültiges Datum "kaputt"' }]);
  });

  it("berücksichtigt Soll/Haben-Spalte und Vorspann", () => {
    const r = parseBankCsv(
      "Konto: DE00\nBuchungstag;Betrag;S/H;Verwendungszweck\n02.09.2026;10,00;S;Gebühr\n",
      {
        ...mapping,
        skipLines: 1,
        columns: { ...mapping.columns, debitCredit: "S/H" },
      },
    );
    expect(r.transactions[0]?.amountCents).toBe(-1000);
  });
});

describe("Zahlungs-Matcher", () => {
  const items = [
    { billingDocumentId: "a", number: "RE-2026-239", openCents: 116956, contactName: "Max Muster" },
    {
      billingDocumentId: "b",
      number: "RE-2026-240",
      openCents: 50000,
      contactName: "Gemeinde Beispielhausen",
    },
    {
      billingDocumentId: "c",
      number: "RE-2026-241",
      openCents: 50000,
      contactName: "Erika Beispiel",
    },
  ];

  it("erkennt Belegnummern in beliebiger Schreibweise", () => {
    const s = suggestAllocations(
      { amountCents: 116956, purpose: "Rechnung RE 2026 239 vielen Dank", counterpartyName: null },
      items,
    );
    expect(s).toEqual([expect.objectContaining({ billingDocumentId: "a", score: 0.97 })]);
    expect(autoAllocations(s, 0.8)).toHaveLength(1);
  });

  it("verteilt Sammelzahlungen nur bei exakter Summe", () => {
    const s = suggestAllocations(
      { amountCents: 100000, purpose: "RE-2026-240 und RE-2026-241", counterpartyName: null },
      items,
    );
    expect(s.map((x) => x.billingDocumentId)).toEqual(["b", "c"]);
    expect(autoAllocations(s, 0.8)).toHaveLength(2);
  });

  it("nutzt ohne Nummer den Betrag und den Namen – nur eindeutig automatisch", () => {
    const s = suggestAllocations(
      {
        amountCents: 50000,
        purpose: "Überweisung",
        counterpartyName: "Gemeindekasse Beispielhausen",
      },
      items,
    );
    expect(s[0]?.billingDocumentId).toBe("b");
    expect(s[0]?.score).toBeGreaterThan(s[1]?.score ?? 0);
    expect(autoAllocations(s, 0.8)).toHaveLength(1);
    const ambiguous = suggestAllocations(
      { amountCents: 50000, purpose: "x", counterpartyName: "Unbekannt" },
      items,
    );
    expect(autoAllocations(ambiguous, 0.8)).toEqual([]);
  });

  it("ignoriert Ausgänge", () => {
    expect(
      suggestAllocations(
        { amountCents: -5000, purpose: "RE-2026-239", counterpartyName: null },
        items,
      ),
    ).toEqual([]);
  });

  it("vergleicht Namen tolerant", () => {
    expect(nameSimilarity("MUSTER, MAX", "Max Muster")).toBe(1);
    expect(nameSimilarity("Beispiel GmbH", "Muster GmbH")).toBe(0);
  });
});

describe("Vorgangsstatus", () => {
  const none = {
    offerSent: false,
    orderConfirmed: false,
    partialInvoiced: false,
    finalInvoiced: false,
    finalPaid: false,
  };
  it("leitet den Status aus Belegen ab", () => {
    expect(deriveCaseStatus(none)).toBeNull();
    expect(deriveCaseStatus({ ...none, offerSent: true })).toBe("angebot");
    expect(deriveCaseStatus({ ...none, offerSent: true, orderConfirmed: true })).toBe("beauftragt");
    expect(deriveCaseStatus({ ...none, partialInvoiced: true })).toBe("in_bearbeitung");
    expect(deriveCaseStatus({ ...none, finalInvoiced: true })).toBe("abrechnung");
    expect(deriveCaseStatus({ ...none, finalInvoiced: true, finalPaid: true })).toBe(
      "abgeschlossen",
    );
  });
});

describe("DATEV", () => {
  it("schreibt Kopf, Spalten und Buchungen", () => {
    const csv = buildDatevCsv(
      {
        consultantNumber: 1234567,
        clientNumber: 10001,
        fiscalYearStart: "20260101",
        accountLength: 4,
        from: "2026-09-01",
        to: "2026-09-30",
        label: "Test",
        createdAt: new Date("2026-10-01T08:00:00.123Z"),
      },
      [
        {
          amountCents: 120000,
          debitCredit: "S",
          account: 1200,
          contraAccount: 8400,
          date: "2026-09-05",
          document1: "RE-2026-238",
          text: 'Kunde "Müller"; GmbH',
        },
      ],
    );
    const [head, cols, row] = csv.split("\r\n");
    expect(
      head?.startsWith(
        '"EXTF";700;21;"Buchungsstapel";13;20261001080000123;;"RE";"";"";1234567;10001;20260101;4;20260901;20260930;"Test"',
      ),
    ).toBe(true);
    expect(head?.split(";")).toHaveLength(31);
    expect(cols?.split(";")[0]).toBe('"Umsatz (ohne Soll/Haben-Kz)"');
    expect(row).toBe(
      '1200,00;"S";"EUR";;;"";1200;8400;"";0509;"RE-2026-238";"";;"Kunde ""Müller"" GmbH"',
    );
    expect(datevAmount(-5)).toBe("0,05");
  });

  it("kodiert Windows-1252", () => {
    expect(Array.from(encodeCp1252("ä€ß✓"))).toEqual([0xe4, 0x80, 0xdf, 0x3f]);
  });

  it("teilt Zahlbeträge anteilig auf", () => {
    expect(splitGross(119000, 100000, 119000)).toEqual({ net: 100000, tax: 19000 });
    expect(splitGross(50000, 100000, 119000)).toEqual({ net: 42017, tax: 7983 });
  });
});
