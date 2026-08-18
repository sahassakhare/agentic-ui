/** In-memory ingest-job store (one process; swap for Redis/DB in B3). */

export type JobPhase =
  | 'queued' | 'unpacking' | 'introspecting' | 'discovered' | 'scaffolding' | 'installing'
  | 'building' | 'serving' | 'registering' | 'registered' | 'failed';

export interface JobComponent { name: string; className: string; inputs: readonly string[] }

export interface Job {
  id: string;
  remoteName: string;
  phase: JobPhase;
  log: string[];
  components: JobComponent[];
  remoteEntry?: string;
  error?: string;
  createdAt: string;
}

export class JobStore {
  private jobs = new Map<string, Job>();
  private seq = 0;

  create(remoteName: string, now: string): Job {
    const id = `job_${++this.seq}_${remoteName}`;
    const job: Job = { id, remoteName, phase: 'queued', log: [], components: [], createdAt: now };
    this.jobs.set(id, job);
    return job;
  }
  get(id: string): Job | undefined { return this.jobs.get(id); }
  update(id: string, patch: Partial<Job>): void {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, ...patch });
  }
  log(id: string, line: string): void {
    const j = this.jobs.get(id);
    if (j) j.log.push(line);
  }
}
