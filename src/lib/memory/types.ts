export const FILE_KINDS = ["soul", "user", "curated", "daily", "qmd", "heartbeat"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const QMD_TYPES = [
  "session",
  "identity",
  "person",
  "preferences",
  "setup",
  "project",
  "index",
] as const;
export type QmdType = (typeof QMD_TYPES)[number];

export const QMD_FOLDERS = [
  "core",
  "sessions",
  "projects",
  "inbox",
  "archive",
  "learner-sessions",
] as const;
export type QmdFolder = (typeof QMD_FOLDERS)[number];

export const PRIORITIES = ["low", "medium", "high"] as const;
export type MemoryPriority = (typeof PRIORITIES)[number];

export const STATUSES = ["active", "completed", "on-hold", "draft", "archived"] as const;
export type MemoryStatus = (typeof STATUSES)[number];

export const EVIDENCE = ["", "TOOL-VERIFIED", "USER-VERIFIED", "INFERRED"] as const;
export type EvidenceTag = (typeof EVIDENCE)[number];

export const MEMORY_CHAR_TARGET = 15_000;

export type FileRecord = {
  path: string;
  kind: FileKind;
  qmdType: QmdType | null;
  folder: QmdFolder | null;
  slug: string | null;
  title: string;
  body: string;
  summary: string;
  tags: string;
  assistant: string;
  evidence: string;
  day: string | null;
  priority: MemoryPriority;
  status: MemoryStatus;
  access: "public" | "private";
  related: string;
  createdAt: string;
  updatedAt: string;
  chars: number;
};

export type FactRecord = {
  name: string;
  summary: string;
  content: string;
  keyPoints: string;
  assistant: string;
  sourcePath: string | null;
  evidence: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRecord = {
  id: string;
  displayName: string;
  lastSeenAt: string | null;
};

export type VaultStatus = {
  setup: boolean;
  ephemeral: boolean;
};

export type RecallPayload = {
  soul: FileRecord | null;
  user: FileRecord | null;
  memory: FileRecord | null;
  heartbeat: FileRecord | null;
  recent: FileRecord[];
  core: FileRecord[];
  facts: FactRecord[];
  agents: AgentRecord[];
  generatedAt: string;
  memoryChars: number;
};

export const AGENT_PRESETS: { id: string; displayName: string }[] = [
  { id: "cloud-grok", displayName: "Cloud Grok Build" },
  { id: "home-grok", displayName: "Home Grok Build" },
  { id: "ui", displayName: "Locus UI" },
];

export const NAV: {
  id: string;
  label: string;
  short: string;
  hint: string;
  kind?: FileKind;
  folder?: QmdFolder;
  graph?: boolean;
}[] = [
  {
    id: "identity",
    label: "Identity",
    short: "who",
    hint: "SOUL.md, USER.md, HEARTBEAT.md. Main session only.",
    kind: "soul",
  },
  {
    id: "curated",
    label: "MEMORY.md",
    short: "L1",
    hint: "Curated long-term memory. Target under 15,000 characters. Main session only.",
    kind: "curated",
  },
  {
    id: "daily",
    label: "Daily logs",
    short: "L2",
    hint: "Raw session notes. Today and yesterday load at start. Append, do not duplicate.",
    kind: "daily",
  },
  {
    id: "core",
    label: "Core QMD",
    short: "L3",
    hint: "identity, people, preferences, setup, plus INDEX.qmd.",
    kind: "qmd",
    folder: "core",
  },
  {
    id: "sessions",
    label: "Sessions",
    short: "L3",
    hint: "Distilled daily summaries.",
    kind: "qmd",
    folder: "sessions",
  },
  {
    id: "projects",
    label: "Projects",
    short: "L3",
    hint: "Active project notes.",
    kind: "qmd",
    folder: "projects",
  },
  {
    id: "inbox",
    label: "Inbox",
    short: "L3",
    hint: "Capture zone. Process within 24 hours.",
    kind: "qmd",
    folder: "inbox",
  },
  {
    id: "learner",
    label: "Learner",
    short: "L3",
    hint: "Autonomous research notes from learner-sessions.",
    kind: "qmd",
    folder: "learner-sessions",
  },
  {
    id: "graph",
    label: "Fact graph",
    short: "L4",
    hint: "Two-way with home Neo4j through this hub. Native clustering is one-way.",
    graph: true,
  },
];
