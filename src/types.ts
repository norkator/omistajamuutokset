export type Company = {
  id: string;
  name: string;
};

export type SnapshotOwner = {
  owner: string;
  rank: number;
  shares: number;
  percentage: number;
  monthlyChangeShares: number;
  monthlyChangePercentage: number;
};

export type Snapshot = {
  date: string;
  fileName: string;
  owners: SnapshotOwner[];
  top50Shares: number;
  top50Percentage: number;
};

export type OwnerTimelinePoint = {
  date: string;
  rank: number | null;
  shares: number;
  percentage: number;
  monthlyChangeShares: number;
  monthlyChangePercentage: number;
};

export type OwnerSeries = {
  owner: string;
  firstSeen: string;
  lastSeen: string;
  monthsTracked: number;
  latestRank: number | null;
  latestShares: number;
  latestPercentage: number;
  latestMonthlyChangeShares: number;
  latestMonthlyChangePercentage: number;
  points: OwnerTimelinePoint[];
};

export type ShareholderDataset = {
  company: Company;
  generatedAt: string;
  snapshots: Snapshot[];
  owners: OwnerSeries[];
};

export type ShareholderDatasetCollection = {
  generatedAt: string;
  companies: ShareholderDataset[];
};
