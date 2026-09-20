import type { Collection } from "mongodb";
import type { GitHubInstallationRepository } from "./app-client.js";

export interface ConnectedRepository {
  repositoryId: number;
  installationId: number;
  connectedByUserId: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  connected: boolean;
  agentEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date;
}

export interface ConnectedRepositoryStore {
  init(): Promise<void>;
  syncInstallation(userId: string, installationId: number, repositories: GitHubInstallationRepository[]): Promise<void>;
  listForUser(userId: string): Promise<ConnectedRepository[]>;
  setAgentEnabled(userId: string, repositoryId: number, enabled: boolean): Promise<ConnectedRepository | null>;
  authorizeAgentRepository(userId: string, repositoryId: number): Promise<ConnectedRepository | null>;
}

export class MongoConnectedRepositoryStore implements ConnectedRepositoryStore {
  constructor(private repositories: Collection<ConnectedRepository>) {}

  async init() {
    await Promise.all([
      this.repositories.createIndex({ repositoryId: 1, connectedByUserId: 1 }, { unique: true }),
      this.repositories.createIndex({ connectedByUserId: 1, connected: 1, fullName: 1 }),
      this.repositories.createIndex({ installationId: 1, connectedByUserId: 1 }),
    ]);
  }

  async syncInstallation(userId: string, installationId: number, repositories: GitHubInstallationRepository[]) {
    const now = new Date();
    const currentIds = repositories.map(repository => repository.repositoryId);
    if (currentIds.length) {
      await this.repositories.updateMany(
        {
          connectedByUserId: userId,
          installationId,
          connected: true,
          repositoryId: { $nin: currentIds },
        },
        { $set: { connected: false, agentEnabled: false, updatedAt: now, lastSyncedAt: now } },
      );
    } else {
      await this.repositories.updateMany(
        { connectedByUserId: userId, installationId, connected: true },
        { $set: { connected: false, agentEnabled: false, updatedAt: now, lastSyncedAt: now } },
      );
    }

    await Promise.all(repositories.map(repository => this.repositories.updateOne(
      { repositoryId: repository.repositoryId, connectedByUserId: userId },
      {
        $set: {
          installationId,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
          archived: repository.archived,
          connected: true,
          updatedAt: now,
          lastSyncedAt: now,
        },
        $setOnInsert: {
          repositoryId: repository.repositoryId,
          connectedByUserId: userId,
          agentEnabled: false,
          createdAt: now,
        },
      },
      { upsert: true },
    )));
  }

  async listForUser(userId: string) {
    return this.repositories.find(
      { connectedByUserId: userId, connected: true },
      { projection: { _id: 0 } },
    ).sort({ fullName: 1 }).toArray();
  }

  async setAgentEnabled(userId: string, repositoryId: number, enabled: boolean) {
    const result = await this.repositories.findOneAndUpdate(
      {
        connectedByUserId: userId,
        repositoryId,
        connected: true,
        archived: false,
      },
      { $set: { agentEnabled: enabled, updatedAt: new Date() } },
      { returnDocument: "after", projection: { _id: 0 } },
    );
    return result;
  }

  async authorizeAgentRepository(userId: string, repositoryId: number) {
    return this.repositories.findOne(
      {
        connectedByUserId: userId,
        repositoryId,
        connected: true,
        archived: false,
        agentEnabled: true,
      },
      { projection: { _id: 0 } },
    );
  }
}

export class MemoryConnectedRepositoryStore implements ConnectedRepositoryStore {
  private repositories = new Map<string, ConnectedRepository>();

  async init() {}

  private key(userId: string, repositoryId: number) {
    return `${userId}:${repositoryId}`;
  }

  async syncInstallation(userId: string, installationId: number, repositories: GitHubInstallationRepository[]) {
    const now = new Date();
    const current = new Set(repositories.map(repository => repository.repositoryId));
    for (const [key, repository] of this.repositories) {
      if (repository.connectedByUserId === userId && repository.installationId === installationId && repository.connected && !current.has(repository.repositoryId)) {
        this.repositories.set(key, { ...repository, connected: false, agentEnabled: false, updatedAt: now, lastSyncedAt: now });
      }
    }
    for (const repository of repositories) {
      const key = this.key(userId, repository.repositoryId);
      const existing = this.repositories.get(key);
      this.repositories.set(key, {
        repositoryId: repository.repositoryId,
        installationId,
        connectedByUserId: userId,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        private: repository.private,
        archived: repository.archived,
        connected: true,
        agentEnabled: existing?.agentEnabled ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastSyncedAt: now,
      });
    }
  }

  async listForUser(userId: string) {
    return [...this.repositories.values()]
      .filter(repository => repository.connectedByUserId === userId && repository.connected)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(repository => structuredClone(repository));
  }

  async setAgentEnabled(userId: string, repositoryId: number, enabled: boolean) {
    const key = this.key(userId, repositoryId);
    const repository = this.repositories.get(key);
    if (!repository || !repository.connected || repository.archived) return null;
    const updated = { ...repository, agentEnabled: enabled, updatedAt: new Date() };
    this.repositories.set(key, updated);
    return structuredClone(updated);
  }

  async authorizeAgentRepository(userId: string, repositoryId: number) {
    const repository = this.repositories.get(this.key(userId, repositoryId));
    return repository?.connected && !repository.archived && repository.agentEnabled
      ? structuredClone(repository)
      : null;
  }
}
