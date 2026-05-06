import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";

const stocksDir = "stocks";
const outputDir = "src/generated";
const outputFile = join(outputDir, "shareholder-data.json");
const supportedExtensions = [".xls", ".xlsx"];

const companySchema = z.object({
  id: z.string(),
  name: z.string(),
});

const snapshotOwnerSchema = z.object({
  owner: z.string(),
  rank: z.number().int().positive(),
  shares: z.number().nonnegative(),
  percentage: z.number().nonnegative(),
  monthlyChangeShares: z.number(),
  monthlyChangePercentage: z.number(),
});

const snapshotSchema = z.object({
  date: z.string(),
  fileName: z.string(),
  owners: z.array(snapshotOwnerSchema),
  top50Shares: z.number().nonnegative(),
  top50Percentage: z.number().nonnegative(),
});

const datasetSchema = z.object({
  company: companySchema,
  generatedAt: z.string(),
  snapshots: z.array(snapshotSchema),
  owners: z.array(
    z.object({
      owner: z.string(),
      firstSeen: z.string(),
      lastSeen: z.string(),
      monthsTracked: z.number().int().positive(),
      latestRank: z.number().int().positive().nullable(),
      latestShares: z.number().nonnegative(),
      latestPercentage: z.number().nonnegative(),
      latestMonthlyChangeShares: z.number(),
      latestMonthlyChangePercentage: z.number(),
      points: z.array(
        z.object({
          date: z.string(),
          rank: z.number().int().positive().nullable(),
          shares: z.number().nonnegative(),
          percentage: z.number().nonnegative(),
          monthlyChangeShares: z.number(),
          monthlyChangePercentage: z.number(),
        }),
      ),
    }),
  ),
});

const datasetCollectionSchema = z.object({
  generatedAt: z.string(),
  companies: z.array(datasetSchema).min(1),
});

type ParsedSnapshot = z.infer<typeof snapshotSchema>;

function parseNumber(value: unknown) {
  const normalized = String(value ?? "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOwner(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCompanyName(companyId: string) {
  return companyId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSnapshot(filePath: string, fileName: string): ParsedSnapshot {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const optomedHeaderRowIndex = rows.findIndex((row) => row[2] === "Osakkeenomistajat");

  if (optomedHeaderRowIndex !== -1) {
    const dateCell = String(rows[1]?.[1] ?? "").trim();

    if (!dateCell) {
      throw new Error(`Could not parse snapshot date from ${fileName}`);
    }

    const owners = rows
      .slice(optomedHeaderRowIndex + 1)
      .map((row) => {
        const rank = parseNumber(row[1]);
        const owner = normalizeOwner(row[2]);

        if (!rank || !owner) return null;

        return {
          owner,
          rank,
          shares: parseNumber(row[3]),
          percentage: parseNumber(row[4]),
          monthlyChangeShares: parseNumber(row[5]),
          monthlyChangePercentage: parseNumber(row[6]),
        };
      })
      .filter((row): row is z.infer<typeof snapshotOwnerSchema> => row !== null)
      .sort((left, right) => left.rank - right.rank);

    return snapshotSchema.parse({
      date: dateCell,
      fileName,
      owners,
      top50Shares: owners.reduce((sum, owner) => sum + owner.shares, 0),
      top50Percentage: owners.reduce((sum, owner) => sum + owner.percentage, 0),
    });
  }

  const ownerListHeader = rows[0] ?? [];
  const isOwnerListFormat = ownerListHeader[0] === "Sijoitus" && ownerListHeader[1] === "Nimi";

  if (isOwnerListFormat) {
    const owners = rows
      .slice(1)
      .map((row) => {
        const rank = parseNumber(row[0]);
        const owner = normalizeOwner(row[1]);

        if (!rank || !owner) return null;

        return {
          owner,
          rank,
          shares: parseNumber(row[3]),
          percentage: parseNumber(row[5]) * 100,
          monthlyChangeShares: parseNumber(row[4]),
          monthlyChangePercentage: 0,
        };
      })
      .filter((row): row is z.infer<typeof snapshotOwnerSchema> => row !== null)
      .sort((left, right) => left.rank - right.rank);

    const dateCell = String(rows[1]?.[7] ?? "").trim();

    if (!dateCell) {
      throw new Error(`Could not parse snapshot date from ${fileName}`);
    }

    return snapshotSchema.parse({
      date: dateCell,
      fileName,
      owners,
      top50Shares: owners.reduce((sum, owner) => sum + owner.shares, 0),
      top50Percentage: owners.reduce((sum, owner) => sum + owner.percentage, 0),
    });
  }

  throw new Error(`Could not recognize shareholder workbook format: ${fileName}`);
}

async function discoverCompanies() {
  const entries = await readdir(stocksDir, { withFileTypes: true });
  const companyIds: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    try {
      const files = await readdir(join(stocksDir, entry.name));
      if (files.some((fileName) => supportedExtensions.some((extension) => fileName.endsWith(extension)))) {
        companyIds.push(entry.name);
      }
    } catch {
      // Ignore directories that are not company data folders.
    }
  }

  return companyIds.sort((left, right) => left.localeCompare(right, "fi"));
}

function buildDataset(company: z.infer<typeof companySchema>, snapshots: ParsedSnapshot[]) {
  const ownerNames = new Set(snapshots.flatMap((snapshot) => snapshot.owners.map((owner) => owner.owner)));

  const owners = [...ownerNames]
    .map((ownerName) => {
      const points = snapshots.map((snapshot) => {
        const match = snapshot.owners.find((owner) => owner.owner === ownerName);

        return {
          date: snapshot.date,
          rank: match?.rank ?? null,
          shares: match?.shares ?? 0,
          percentage: match?.percentage ?? 0,
          monthlyChangeShares: match?.monthlyChangeShares ?? 0,
          monthlyChangePercentage: match?.monthlyChangePercentage ?? 0,
        };
      });

      const presentPoints = points.filter((point) => point.rank !== null);
      const latestPoint = [...presentPoints].reverse()[0];

      if (!latestPoint) {
        return null;
      }

      return {
        owner: ownerName,
        firstSeen: presentPoints[0].date,
        lastSeen: latestPoint.date,
        monthsTracked: presentPoints.length,
        latestRank: latestPoint.rank,
        latestShares: latestPoint.shares,
        latestPercentage: latestPoint.percentage,
        latestMonthlyChangeShares: latestPoint.monthlyChangeShares,
        latestMonthlyChangePercentage: latestPoint.monthlyChangePercentage,
        points,
      };
    })
    .filter((owner): owner is NonNullable<typeof owner> => owner !== null)
    .sort((left, right) => {
      if (right.latestShares !== left.latestShares) {
        return right.latestShares - left.latestShares;
      }

      return left.owner.localeCompare(right.owner, "fi");
    });

  return datasetSchema.parse({
    company,
    generatedAt: new Date().toISOString(),
    snapshots,
    owners,
  });
}

const companyIds = await discoverCompanies();

if (companyIds.length === 0) {
  throw new Error(`No company folders with .xls files found under ${stocksDir}/.`);
}

const companies = companyIds.map((companyId) => {
  const company = companySchema.parse({
    id: companyId,
    name: formatCompanyName(companyId),
  });
  const shareholderDir = join(stocksDir, companyId);

  return { company, shareholderDir };
});

const parsedDatasets = await Promise.all(
  companies.map(async ({ company, shareholderDir }) => {
    const fileNames = (await readdir(shareholderDir))
      .filter((fileName) => supportedExtensions.some((extension) => fileName.endsWith(extension)))
      .sort();

    const snapshots = fileNames.map((fileName) =>
      parseSnapshot(join(shareholderDir, fileName), basename(fileName)),
    );

    return buildDataset(company, snapshots);
  }),
);

const datasetCollection = datasetCollectionSchema.parse({
  generatedAt: new Date().toISOString(),
  companies: parsedDatasets,
});

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(datasetCollection, null, 2)}\n`);

console.log(
  `Generated ${outputFile} from ${parsedDatasets.length} company dataset(s): ${parsedDatasets
    .map((dataset) => `${dataset.company.id} (${dataset.snapshots.length} snapshots)`)
    .join(", ")}.`,
);
