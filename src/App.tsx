import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import dataset from "./generated/shareholder-data.json";
import en from "./locales/en.json";
import fi from "./locales/fi.json";
import type { OwnerSeries, OwnerTimelinePoint, ShareholderDatasetCollection } from "./types";

const datasetCollection = dataset as ShareholderDatasetCollection;
const availableDatasets = datasetCollection.companies;
const fallbackDataset = availableDatasets[0];
const availableCompanies = availableDatasets.map((entry) => entry.company);
const linePalette = ["#1d4ed8", "#0f766e", "#c2410c", "#7c3aed", "#be123c", "#15803d"];
const translations = { fi, en };

if (!fallbackDataset) {
  throw new Error("No shareholder datasets available.");
}

type Language = keyof typeof translations;

type OwnerPresenceSegment = {
  owner: string;
  entryDate: string;
  exitDate: string | null;
  entryShares: number;
  exitShares: number;
  peakShares: number;
  peakPercentage: number;
  monthsInTop50: number;
  latestRankInRun: number;
  isActive: boolean;
};

type LeaderboardSortKey =
  | "owner"
  | "latestShares"
  | "latestPercentage"
  | "latestMonthlyChangeShares"
  | "firstSeen"
  | "monthsTracked";

type LeaderboardSort = {
  key: LeaderboardSortKey;
  direction: "asc" | "desc";
};

function interpolate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function classForChange(value: number) {
  if (value > 0) return "text-rise";
  if (value < 0) return "text-fall";
  return "text-slate-500";
}

function segmentFromRun(
  ownerName: string,
  run: Array<OwnerTimelinePoint & { index: number }>,
  latestSnapshotDate: string,
): OwnerPresenceSegment {
  const firstPoint = run[0];
  const lastPoint = run[run.length - 1];
  const peakPoint = run.reduce((best, point) => (point.shares > best.shares ? point : best), run[0]);
  const isActive = lastPoint.date === latestSnapshotDate;

  return {
    owner: ownerName,
    entryDate: firstPoint.date,
    exitDate: isActive ? null : lastPoint.date,
    entryShares: firstPoint.shares,
    exitShares: lastPoint.shares,
    peakShares: peakPoint.shares,
    peakPercentage: peakPoint.percentage,
    monthsInTop50: run.length,
    latestRankInRun: lastPoint.rank ?? 999,
    isActive,
  };
}

export default function App() {
  const [language, setLanguage] = useState<Language>("fi");
  const [selectedCompanyId, setSelectedCompanyId] = useState(availableCompanies[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSort>({
    key: "latestMonthlyChangeShares",
    direction: "desc",
  });
  const comparisonSectionRef = useRef<HTMLElement | null>(null);
  const currentDataset =
    availableDatasets.find((entry) => entry.company.id === selectedCompanyId) ?? fallbackDataset;
  const currentCompany = currentDataset.company;
  const latestSnapshot = currentDataset.snapshots[currentDataset.snapshots.length - 1];
  const earliestSnapshot = currentDataset.snapshots[0];
  const copy = translations[language];
  const localeCode = language === "fi" ? "fi-FI" : "en-GB";
  const numberFormat = useMemo(() => new Intl.NumberFormat(localeCode), [localeCode]);
  const percentageFormat = useMemo(
    () =>
      new Intl.NumberFormat(localeCode, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [localeCode],
  );
  const monthFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeCode, {
        month: "short",
        year: "numeric",
      }),
    [localeCode],
  );

  function formatShares(value: number) {
    return numberFormat.format(value);
  }

  function formatPercentage(value: number) {
    return `${percentageFormat.format(value)} %`;
  }

  function formatMonth(date: string) {
    return monthFormat.format(new Date(date));
  }

  function formatSigned(value: number) {
    const formatted = numberFormat.format(value);
    return value > 0 ? `+${formatted}` : formatted;
  }

  function tooltipShares(value: unknown) {
    return formatShares(Number(value ?? 0));
  }

  function tooltipSigned(value: unknown) {
    return formatSigned(Number(value ?? 0));
  }

  useEffect(() => {
    setSelectedOwners(latestSnapshot.owners.slice(0, 5).map((owner) => owner.owner));
    setQuery("");
    setHistoryQuery("");
  }, [selectedCompanyId, latestSnapshot]);

  const normalizedQuery = query.trim().toLowerCase();
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase();

  const filteredOwners = useMemo(() => {
    return currentDataset.owners.filter((owner) => owner.owner.toLowerCase().includes(normalizedQuery));
  }, [currentDataset, normalizedQuery]);

  const currentOwners = useMemo(() => {
    return filteredOwners.filter((owner) => owner.lastSeen === latestSnapshot.date);
  }, [filteredOwners]);

  const sortedCurrentOwners = useMemo(() => {
    const sorted = [...currentOwners];

    sorted.sort((left, right) => {
      const multiplier = leaderboardSort.direction === "asc" ? 1 : -1;

      switch (leaderboardSort.key) {
        case "owner":
          return left.owner.localeCompare(right.owner, "fi") * multiplier;
        case "latestShares":
          return (left.latestShares - right.latestShares) * multiplier;
        case "latestPercentage":
          return (left.latestPercentage - right.latestPercentage) * multiplier;
        case "latestMonthlyChangeShares":
          return (left.latestMonthlyChangeShares - right.latestMonthlyChangeShares) * multiplier;
        case "firstSeen":
          return left.firstSeen.localeCompare(right.firstSeen) * multiplier;
        case "monthsTracked":
          return (left.monthsTracked - right.monthsTracked) * multiplier;
      }
    });

    return sorted;
  }, [currentOwners, leaderboardSort]);

  const historicalSegments = useMemo(() => {
    return currentDataset.owners.flatMap((owner) => {
      const presentPoints = owner.points
        .map((point, index) => ({ ...point, index }))
        .filter((point) => point.rank !== null);

      if (presentPoints.length === 0) {
        return [];
      }

      const segments: OwnerPresenceSegment[] = [];
      let currentRun: Array<OwnerTimelinePoint & { index: number }> = [presentPoints[0]];

      for (let index = 1; index < presentPoints.length; index += 1) {
        const point = presentPoints[index];
        const previousPoint = presentPoints[index - 1];

        if (point.index === previousPoint.index + 1) {
          currentRun.push(point);
          continue;
        }

        segments.push(segmentFromRun(owner.owner, currentRun, latestSnapshot.date));
        currentRun = [point];
      }

      segments.push(segmentFromRun(owner.owner, currentRun, latestSnapshot.date));
      return segments;
    });
  }, [currentDataset, latestSnapshot.date]);

  const exitedSegments = useMemo(() => {
    return historicalSegments
      .filter((segment) => !segment.isActive)
      .filter((segment) => segment.owner.toLowerCase().includes(normalizedHistoryQuery))
      .sort((left, right) => {
        if (right.peakShares !== left.peakShares) {
          return right.peakShares - left.peakShares;
        }

        return left.owner.localeCompare(right.owner, "fi");
      });
  }, [historicalSegments, normalizedHistoryQuery]);

  const activeSegments = useMemo(() => {
    return historicalSegments
      .filter((segment) => segment.isActive)
      .sort((left, right) => left.latestRankInRun - right.latestRankInRun);
  }, [historicalSegments]);

  const comparisonRows = useMemo(() => {
    return currentDataset.snapshots.map((snapshot) => {
      const row: Record<string, string | number> = {
        date: snapshot.date,
        label: formatMonth(snapshot.date),
      };

      for (const ownerName of selectedOwners) {
        const match = snapshot.owners.find((owner) => owner.owner === ownerName);
        row[ownerName] = match?.shares ?? 0;
      }

      return row;
    });
  }, [currentDataset, selectedOwners]);

  const latestMovers = useMemo(() => {
    return [...latestSnapshot.owners]
      .sort((left, right) => Math.abs(right.monthlyChangeShares) - Math.abs(left.monthlyChangeShares))
      .slice(0, 12);
  }, [latestSnapshot]);

  const latestEntries = useMemo(() => {
    return activeSegments
      .filter((segment) => segment.entryDate !== earliestSnapshot.date)
      .sort((left, right) => right.entryDate.localeCompare(left.entryDate))
      .slice(0, 8);
  }, [activeSegments, earliestSnapshot.date]);

  const topCoverage = latestSnapshot.top50Percentage;
  const biggestIncrease = [...latestSnapshot.owners].sort(
    (left, right) => right.monthlyChangeShares - left.monthlyChangeShares,
  )[0];
  const biggestDecrease = [...latestSnapshot.owners].sort(
    (left, right) => left.monthlyChangeShares - right.monthlyChangeShares,
  )[0];
  const biggestExitedStake = useMemo(() => {
    return historicalSegments
      .filter((segment) => !segment.isActive)
      .sort((left, right) => right.peakShares - left.peakShares)[0];
  }, [historicalSegments]);

  function toggleOwner(ownerName: string) {
    setSelectedOwners((current) => {
      if (current.includes(ownerName)) {
        return current.filter((entry) => entry !== ownerName);
      }

      return [...current, ownerName];
    });
  }

  function focusOwnerInComparison(ownerName: string) {
    setSelectedOwners((current) => {
      if (current.includes(ownerName)) {
        return current;
      }

      return [...current, ownerName];
    });

    requestAnimationFrame(() => {
      comparisonSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function toggleLeaderboardSort(key: LeaderboardSortKey) {
    setLeaderboardSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        key,
        direction: key === "owner" || key === "firstSeen" ? "asc" : "desc",
      };
    });
  }

  function sortIndicator(key: LeaderboardSortKey) {
    if (leaderboardSort.key !== key) {
      return "";
    }

    return leaderboardSort.direction === "asc" ? " ↑" : " ↓";
  }

  function selectAllOwners() {
    setSelectedOwners(currentDataset.owners.map((owner) => owner.owner));
  }

  function selectCurrentOwners() {
    setSelectedOwners(currentOwners.map((owner) => owner.owner));
  }

  function clearSelectedOwners() {
    setSelectedOwners([]);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1880px] flex-col gap-5 px-3 py-4 sm:px-4 xl:px-8">
      <section className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-panel shadow-[0_12px_36px_rgba(15,23,42,0.07)]">
        <div className="grid gap-4 px-4 py-4 xl:grid-cols-[1.2fr_1.3fr] lg:px-6">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-ocean/15 bg-ocean/6 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-ocean">
              {copy.heroEyebrow}
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                {copy.heroTitle}
              </h1>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5 xl:items-start">
            <label className="rounded-[1rem] border border-slate-200 bg-white p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{copy.languageLabel}</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-ocean focus:ring-3 focus:ring-ocean/10"
              >
                <option value="fi">{translations.fi.languageName}</option>
                <option value="en">{translations.en.languageName}</option>
              </select>
            </label>
            <label className="rounded-[1rem] border border-slate-200 bg-white p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{copy.companyLabel}</span>
              <select
                value={selectedCompanyId}
                onChange={(event) => setSelectedCompanyId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-ocean focus:ring-3 focus:ring-ocean/10"
              >
                {availableCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <MetricCard label={copy.metrics.latestSnapshot} value={latestSnapshot.date} />
            <MetricCard label={copy.metrics.trackedOwners} value={numberFormat.format(currentDataset.owners.length)} detail={copy.metrics.trackedOwnersDetail} />
            <MetricCard label={copy.metrics.top50Coverage} value={formatPercentage(topCoverage)} detail={interpolate(copy.metrics.top50CoverageDetail, { shares: formatShares(latestSnapshot.top50Shares) })} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <HighlightCard title={copy.highlights.biggestIncrease} owner={biggestIncrease.owner} value={formatSigned(biggestIncrease.monthlyChangeShares)} tone="rise" />
        <HighlightCard title={copy.highlights.biggestDecrease} owner={biggestDecrease.owner} value={formatSigned(biggestDecrease.monthlyChangeShares)} tone="fall" />
        <HighlightCard title={copy.highlights.snapshotCount} owner={interpolate(copy.highlights.monthsRange, { count: currentDataset.snapshots.length })} value={interpolate(copy.highlights.dateRange, { from: earliestSnapshot.date, to: latestSnapshot.date })} tone="neutral" />
        <HighlightCard title={copy.highlights.largestExitedStake} owner={biggestExitedStake?.owner ?? "-"} value={biggestExitedStake ? interpolate(copy.highlights.largestExitedStakeValue, { shares: formatShares(biggestExitedStake.peakShares) }) : copy.highlights.noExitsFound} tone="neutral" />
        <HighlightCard title={copy.highlights.currentCompany} owner={currentCompany.name} value={interpolate(copy.highlights.ownersInComparison, { count: selectedOwners.length })} tone="neutral" />
      </section>

      <section ref={comparisonSectionRef} className="grid gap-5">
        <article className="rounded-[1.5rem] border border-slate-200 bg-panel p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-950">{copy.sections.ownerComparisonTitle}</h2>
              <p className="text-xs text-slate-500">{copy.sections.ownerComparisonDescription}</p>
            </div>
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonRows} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.22)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={formatShares} tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={tooltipShares} labelFormatter={(value) => String(value)} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                {selectedOwners.map((ownerName, index) => (
                  <Line
                    key={ownerName}
                    type="monotone"
                    dataKey={ownerName}
                    stroke={linePalette[index % linePalette.length]}
                    strokeWidth={2.1}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <article className="rounded-[1.5rem] border border-slate-200 bg-panel p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
          <div className="mb-3">
            <h2 className="font-display text-xl font-semibold text-slate-950">{copy.sections.ownerPickerTitle}</h2>
            <p className="text-xs text-slate-500">{copy.sections.ownerPickerDescription}</p>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectAllOwners}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-ocean/40 hover:text-ocean"
            >
              {copy.sections.selectAllOwners}
            </button>
            <button
              type="button"
              onClick={selectCurrentOwners}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-ocean/40 hover:text-ocean"
            >
              {copy.sections.selectCurrentOwners}
            </button>
            <button
              type="button"
              onClick={clearSelectedOwners}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-rose-300 hover:text-rose-700"
            >
              {copy.sections.clearOwnerSelection}
            </button>
          </div>
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {copy.sections.searchOwners}
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.sections.ownerSearchPlaceholder}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-ocean focus:ring-3 focus:ring-ocean/10"
            />
          </label>
          <div className="grid max-h-[380px] gap-1.5 overflow-y-auto pr-1">
            {filteredOwners.map((owner) => {
              const active = selectedOwners.includes(owner.owner);
              const isCurrentOwner = owner.lastSeen === latestSnapshot.date;
              return (
                <button
                  key={owner.owner}
                  type="button"
                  onClick={() => toggleOwner(owner.owner)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    active
                      ? "border-ocean bg-ocean text-white shadow-md shadow-ocean/15"
                      : isCurrentOwner
                        ? "border-slate-200 bg-white text-slate-700 hover:border-ocean/40"
                        : "border-amber-200 bg-amber-50/80 text-slate-700 hover:border-amber-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold">{owner.owner}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                        active
                          ? "bg-white/18 text-white"
                          : isCurrentOwner
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {isCurrentOwner ? copy.sections.ownerCurrentStatus : copy.sections.ownerPastStatus}
                    </span>
                  </div>
                  <div className={`text-[11px] ${active ? "text-white/80" : "text-slate-500"}`}>
                    {isCurrentOwner
                      ? interpolate(copy.sections.ownerPickerCurrentMeta, { shares: formatShares(owner.latestShares) })
                      : interpolate(copy.sections.ownerPickerPastMeta, { date: owner.lastSeen })}
                  </div>
                </button>
              );
            })}
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-slate-200 bg-panel p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
          <div className="mb-3">
            <h2 className="font-display text-xl font-semibold text-slate-950">{copy.sections.latestMonthlyMoversTitle}</h2>
            <p className="text-xs text-slate-500">{copy.sections.latestMonthlyMoversDescription}</p>
          </div>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latestMovers} layout="vertical" margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.22)" horizontal={false} />
                <XAxis type="number" tickFormatter={formatShares} tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="owner" width={240} tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={tooltipSigned} />
                <Bar dataKey="monthlyChangeShares" radius={[0, 10, 10, 0]}>
                  {latestMovers.map((entry) => (
                    <Cell
                      key={entry.owner}
                      fill={entry.monthlyChangeShares >= 0 ? "#15803d" : "#b91c1c"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid gap-5">
        <article className="rounded-[1.5rem] border border-slate-200 bg-panel p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
          <div className="mb-3">
            <h2 className="font-display text-xl font-semibold text-slate-950">{copy.sections.currentLeaderboardTitle}</h2>
            <p className="text-xs text-slate-500">{copy.sections.currentLeaderboardDescription}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <SortableHeader
                      active={leaderboardSort.key === "owner"}
                      label={`${copy.tables.owner}${sortIndicator("owner")}`}
                      onClick={() => toggleLeaderboardSort("owner")}
                      nextDirectionLabel={leaderboardSort.key === "owner" && leaderboardSort.direction === "asc" ? copy.tables.sortDescending : copy.tables.sortAscending}
                    />
                    <SortableHeader
                      active={leaderboardSort.key === "latestShares"}
                      label={`${copy.tables.shares}${sortIndicator("latestShares")}`}
                      onClick={() => toggleLeaderboardSort("latestShares")}
                      nextDirectionLabel={leaderboardSort.key === "latestShares" && leaderboardSort.direction === "asc" ? copy.tables.sortDescending : copy.tables.sortAscending}
                    />
                    <SortableHeader
                      active={leaderboardSort.key === "latestPercentage"}
                      label={`${copy.tables.share}${sortIndicator("latestPercentage")}`}
                      onClick={() => toggleLeaderboardSort("latestPercentage")}
                      nextDirectionLabel={leaderboardSort.key === "latestPercentage" && leaderboardSort.direction === "asc" ? copy.tables.sortDescending : copy.tables.sortAscending}
                    />
                    <SortableHeader
                      active={leaderboardSort.key === "latestMonthlyChangeShares"}
                      label={`${copy.tables.oneMonth}${sortIndicator("latestMonthlyChangeShares")}`}
                      onClick={() => toggleLeaderboardSort("latestMonthlyChangeShares")}
                      nextDirectionLabel={leaderboardSort.key === "latestMonthlyChangeShares" && leaderboardSort.direction === "asc" ? copy.tables.sortDescending : copy.tables.sortAscending}
                    />
                    <SortableHeader
                      active={leaderboardSort.key === "firstSeen"}
                      label={`${copy.tables.firstSeen}${sortIndicator("firstSeen")}`}
                      onClick={() => toggleLeaderboardSort("firstSeen")}
                      nextDirectionLabel={leaderboardSort.key === "firstSeen" && leaderboardSort.direction === "asc" ? copy.tables.sortDescending : copy.tables.sortAscending}
                    />
                    <SortableHeader
                      active={leaderboardSort.key === "monthsTracked"}
                      label={`${copy.tables.months}${sortIndicator("monthsTracked")}`}
                      onClick={() => toggleLeaderboardSort("monthsTracked")}
                      nextDirectionLabel={leaderboardSort.key === "monthsTracked" && leaderboardSort.direction === "asc" ? copy.tables.sortDescending : copy.tables.sortAscending}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedCurrentOwners.map((owner) => (
                    <CurrentOwnerRow key={owner.owner} owner={owner} formatPercentage={formatPercentage} formatShares={formatShares} formatSigned={formatSigned} rankLabel={copy.tables.rank} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[1.5rem] border border-slate-200 bg-panel p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
          <div className="mb-3">
            <h2 className="font-display text-xl font-semibold text-slate-950">{copy.sections.pastEntrantsTitle}</h2>
            <p className="text-xs text-slate-500">
              {copy.sections.pastEntrantsDescription}
            </p>
          </div>
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {copy.sections.searchHistory}
            </span>
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder={copy.sections.historySearchPlaceholder}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-ocean focus:ring-3 focus:ring-ocean/10"
            />
          </label>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[460px] overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">{copy.tables.owner}</th>
                    <th className="px-3 py-2">{copy.tables.entry}</th>
                    <th className="px-3 py-2">{copy.tables.exit}</th>
                    <th className="px-3 py-2">{copy.tables.entryShares}</th>
                    <th className="px-3 py-2">{copy.tables.exitShares}</th>
                    <th className="px-3 py-2">{copy.tables.peakShares}</th>
                    <th className="px-3 py-2">{copy.tables.peakPercentage}</th>
                    <th className="px-3 py-2">{copy.tables.months}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {exitedSegments.map((segment, index) => (
                    <HistoricalSegmentRow
                      key={`${segment.owner}-${segment.entryDate}-${index}`}
                      segment={segment}
                      formatPercentage={formatPercentage}
                      formatShares={formatShares}
                      onSelectOwner={focusOwnerInComparison}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-slate-200 bg-panel p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
          <div className="mb-3">
            <h2 className="font-display text-xl font-semibold text-slate-950">{copy.sections.recentEntriesTitle}</h2>
            <p className="text-xs text-slate-500">{copy.sections.recentEntriesDescription}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[460px] overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">{copy.tables.owner}</th>
                    <th className="px-3 py-2">{copy.tables.entry}</th>
                    <th className="px-3 py-2">{copy.tables.entryShares}</th>
                    <th className="px-3 py-2">{copy.tables.currentShares}</th>
                    <th className="px-3 py-2">{copy.tables.peakShares}</th>
                    <th className="px-3 py-2">{copy.tables.months}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {latestEntries.map((segment, index) => (
                    <ActiveEntryRow key={`${segment.owner}-${segment.entryDate}-${index}`} segment={segment} formatShares={formatShares} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
      {detail ? <div className="mt-0.5 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

function SortableHeader({
  active,
  label,
  nextDirectionLabel,
  onClick,
}: {
  active: boolean;
  label: string;
  nextDirectionLabel: string;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition ${
          active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
        }`}
        title={nextDirectionLabel}
      >
        <span>{label}</span>
      </button>
    </th>
  );
}

function HighlightCard({
  title,
  owner,
  value,
  tone,
}: {
  title: string;
  owner: string;
  value: string;
  tone: "rise" | "fall" | "neutral";
}) {
  const toneClass =
    tone === "rise"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "fall"
        ? "border-rose-200 bg-rose-50"
        : "border-slate-200 bg-white";

  return (
    <div className={`rounded-[1rem] border p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-1 font-display text-base font-semibold text-slate-950">{owner}</div>
      <div className="mt-0.5 text-xs text-slate-600">{value}</div>
    </div>
  );
}

function CurrentOwnerRow({
  owner,
  formatPercentage,
  formatShares,
  formatSigned,
  rankLabel,
}: {
  owner: OwnerSeries;
  formatPercentage: (value: number) => string;
  formatShares: (value: number) => string;
  formatSigned: (value: number) => string;
  rankLabel: string;
}) {
  return (
    <tr className="transition hover:bg-slate-50">
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-slate-800">{owner.owner}</div>
        <div className="text-[11px] text-slate-500">{rankLabel} {owner.latestRank ?? "-"}</div>
      </td>
      <td className="px-3 py-2 align-top">{formatShares(owner.latestShares)}</td>
      <td className="px-3 py-2 align-top">{formatPercentage(owner.latestPercentage)}</td>
      <td className={`px-3 py-2 align-top font-medium ${classForChange(owner.latestMonthlyChangeShares)}`}>
        {formatSigned(owner.latestMonthlyChangeShares)}
      </td>
      <td className="px-3 py-2 align-top text-slate-500">{owner.firstSeen}</td>
      <td className="px-3 py-2 align-top text-slate-500">{owner.monthsTracked}</td>
    </tr>
  );
}

function HistoricalSegmentRow({
  segment,
  formatPercentage,
  formatShares,
  onSelectOwner,
}: {
  segment: OwnerPresenceSegment;
  formatPercentage: (value: number) => string;
  formatShares: (value: number) => string;
  onSelectOwner: (ownerName: string) => void;
}) {
  return (
    <tr
      className="cursor-pointer transition hover:bg-sky-50"
      onClick={() => onSelectOwner(segment.owner)}
    >
      <td className="px-3 py-2 font-medium text-sky-800">{segment.owner}</td>
      <td className="px-3 py-2 text-slate-600">{segment.entryDate}</td>
      <td className="px-3 py-2 text-slate-600">{segment.exitDate ?? "-"}</td>
      <td className="px-3 py-2">{formatShares(segment.entryShares)}</td>
      <td className="px-3 py-2">{formatShares(segment.exitShares)}</td>
      <td className="px-3 py-2 font-medium text-slate-800">{formatShares(segment.peakShares)}</td>
      <td className="px-3 py-2">{formatPercentage(segment.peakPercentage)}</td>
      <td className="px-3 py-2 text-slate-600">{segment.monthsInTop50}</td>
    </tr>
  );
}

function ActiveEntryRow({
  segment,
  formatShares,
}: {
  segment: OwnerPresenceSegment;
  formatShares: (value: number) => string;
}) {
  return (
    <tr className="transition hover:bg-slate-50">
      <td className="px-3 py-2 font-medium text-slate-800">{segment.owner}</td>
      <td className="px-3 py-2 text-slate-600">{segment.entryDate}</td>
      <td className="px-3 py-2">{formatShares(segment.entryShares)}</td>
      <td className="px-3 py-2">{formatShares(segment.exitShares)}</td>
      <td className="px-3 py-2 font-medium text-slate-800">{formatShares(segment.peakShares)}</td>
      <td className="px-3 py-2 text-slate-600">{segment.monthsInTop50}</td>
    </tr>
  );
}
