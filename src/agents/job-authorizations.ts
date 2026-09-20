import type { Collection } from "mongodb";

export type AgentJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AgentJobAuthorization {
  jobId: string;
  userId: string;
  repositoryId: number;
  status: AgentJobStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentJobAuthorizationStore {
  init(): Promise<void>;
  create(jobId: string, userId: string, repositoryId: number): Promise<AgentJobAuthorization>;
  setStatus(jobId: string, userId: string, status: AgentJobStatus): Promise<AgentJobAuthorization | null>;
  authorizeCredentialJob(userId: string, jobId: string, repositoryId: number): Promise<AgentJobAuthorization | null>;
}

export class MongoAgentJobAuthorizationStore implements AgentJobAuthorizationStore {
  constructor(private jobs: Collection<AgentJobAuthorization>) {}

  async init() {
    await Promise.all([
      this.jobs.createIndex({ jobId: 1 }, { unique: true }),
      this.jobs.createIndex({ userId: 1, repositoryId: 1, status: 1 }),
    ]);
  }

  async create(jobId: string, userId: string, repositoryId: number) {
    const now = new Date();
    const job: AgentJobAuthorization = {
      jobId,
      userId,
      repositoryId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insertOne(job);
    return structuredClone(job);
  }

  async setStatus(jobId: string, userId: string, status: AgentJobStatus) {
    return this.jobs.findOneAndUpdate(
      { jobId, userId },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after", projection: { _id: 0 } },
    );
  }

  async authorizeCredentialJob(userId: string, jobId: string, repositoryId: number) {
    return this.jobs.findOne(
      {
        jobId,
        userId,
        repositoryId,
        status: { $in: ["queued", "running"] },
      },
      { projection: { _id: 0 } },
    );
  }
}

export class MemoryAgentJobAuthorizationStore implements AgentJobAuthorizationStore {
  private jobs = new Map<string, AgentJobAuthorization>();

  async init() {}

  async create(jobId: string, userId: string, repositoryId: number) {
    if (this.jobs.has(jobId)) throw new Error("Agent job already exists");
    const now = new Date();
    const job: AgentJobAuthorization = {
      jobId,
      userId,
      repositoryId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }

  async setStatus(jobId: string, userId: string, status: AgentJobStatus) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) return null;
    const updated = { ...job, status, updatedAt: new Date() };
    this.jobs.set(jobId, updated);
    return structuredClone(updated);
  }

  async authorizeCredentialJob(userId: string, jobId: string, repositoryId: number) {
    const job = this.jobs.get(jobId);
    return job
      && job.userId === userId
      && job.repositoryId === repositoryId
      && (job.status === "queued" || job.status === "running")
      ? structuredClone(job)
      : null;
  }
}
