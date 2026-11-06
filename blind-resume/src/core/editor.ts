import { isCovered, type Candidate, type CandidateDraft } from "./candidates";
import type { Rect, Size } from "./geometry";
import { History } from "./history";
import {
  applyToAllPages,
  removeRedaction,
  replaceRect,
  type ApplyToAllResult,
  type Redaction,
  type RedactionSource,
} from "./redactions";

export interface EditorSnapshot {
  readonly redactions: readonly Redaction[];
  readonly candidates: readonly Candidate[];
}

const EMPTY: EditorSnapshot = Object.freeze({
  redactions: Object.freeze([]) as readonly Redaction[],
  candidates: Object.freeze([]) as readonly Candidate[],
});

export interface AddCandidatesResult {
  readonly added: number;
  readonly duplicates: number;
  readonly covered: number;
}

export class EditorStore {
  private readonly history = new History<EditorSnapshot>(EMPTY);
  private live: EditorSnapshot | null = null;
  private selected: string | null = null;
  private counter = 0;
  private candidateCounter = 0;
  private pageSizes: readonly Size[] = [];
  private readonly listeners = new Set<() => void>();

  get snapshot(): EditorSnapshot {
    return this.live ?? this.history.current;
  }

  get redactions(): readonly Redaction[] {
    return this.snapshot.redactions;
  }

  get candidates(): readonly Candidate[] {
    return this.snapshot.candidates;
  }

  get pendingCandidates(): readonly Candidate[] {
    const redactions = this.redactions;
    return this.candidates.filter((c) => c.decision === "pending" && !isCovered(c, redactions));
  }

  get selectedId(): string | null {
    return this.selected;
  }

  get selectedRedaction(): Redaction | null {
    return this.redactions.find((r) => r.id === this.selected) ?? null;
  }

  get canUndo(): boolean {
    return this.live === null && this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.live === null && this.history.canRedo;
  }

  get sizes(): readonly Size[] {
    return this.pageSizes;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(pageSizes: readonly Size[]): void {
    this.history.reset(EMPTY);
    this.live = null;
    this.selected = null;
    this.counter = 0;
    this.candidateCounter = 0;
    this.pageSizes = pageSizes;
    this.emit();
  }

  nextId(): string {
    this.counter += 1;
    return `r${this.counter}`;
  }

  add(page: number, rect: Rect, source: RedactionSource = "manual"): Redaction {
    const redaction: Redaction = { id: this.nextId(), page, x: rect.x, y: rect.y, width: rect.width, height: rect.height, source };
    this.selected = redaction.id;
    this.commit({ ...this.snapshot, redactions: [...this.redactions, redaction] });
    return redaction;
  }

  preview(id: string, rect: Rect): void {
    const base = this.live ?? this.history.current;
    this.live = { ...base, redactions: replaceRect(base.redactions, id, rect) };
    this.emit();
  }

  finishPreview(): void {
    if (this.live === null) return;
    const next = this.live;
    this.live = null;
    this.history.push(next);
    this.emit();
  }

  cancelPreview(): void {
    if (this.live === null) return;
    this.live = null;
    this.emit();
  }

  update(id: string, rect: Rect): void {
    this.commit({ ...this.snapshot, redactions: replaceRect(this.redactions, id, rect) });
  }

  remove(id: string): void {
    if (!this.redactions.some((r) => r.id === id)) return;
    if (this.selected === id) this.selected = null;
    this.commit({ ...this.snapshot, redactions: removeRedaction(this.redactions, id) });
  }

  select(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.emit();
  }

  applyToAll(id: string): ApplyToAllResult {
    const result = applyToAllPages(this.redactions, id, this.pageSizes, () => this.nextId());
    if (result.added.length > 0) this.commit({ ...this.snapshot, redactions: result.redactions });
    return result;
  }

  addCandidates(drafts: readonly CandidateDraft[]): AddCandidatesResult {
    const known = new Set(this.candidates.map((c) => c.key));
    const fresh: Candidate[] = [];
    let duplicates = 0;
    let covered = 0;
    for (const draft of drafts) {
      if (known.has(draft.key)) {
        duplicates += 1;
        continue;
      }
      known.add(draft.key);
      if (isCovered(draft, this.redactions)) covered += 1;
      this.candidateCounter += 1;
      fresh.push({ ...draft, id: `c${this.candidateCounter}`, decision: "pending" });
    }
    if (fresh.length > 0) this.commit({ ...this.snapshot, candidates: [...this.candidates, ...fresh] });
    return { added: fresh.length - covered, duplicates, covered };
  }

  decide(ids: readonly string[], decision: "apply" | "skip"): number {
    const targets = new Set(ids);
    const added: Redaction[] = [];
    let changed = 0;
    const candidates = this.candidates.map((c) => {
      if (!targets.has(c.id) || c.decision !== "pending") return c;
      changed += 1;
      if (decision === "apply") {
        for (const r of c.rects) {
          added.push({ id: this.nextId(), page: c.page, x: r.x, y: r.y, width: r.width, height: r.height, source: "candidate" });
        }
      }
      return { ...c, decision };
    });
    if (changed > 0) this.commit({ redactions: [...this.redactions, ...added], candidates });
    return changed;
  }

  undo(): boolean {
    this.live = null;
    const changed = this.history.undo();
    this.afterTimeTravel();
    return changed;
  }

  redo(): boolean {
    this.live = null;
    const changed = this.history.redo();
    this.afterTimeTravel();
    return changed;
  }

  private afterTimeTravel(): void {
    if (this.selected !== null && !this.redactions.some((r) => r.id === this.selected)) this.selected = null;
    this.emit();
  }

  private commit(next: EditorSnapshot): void {
    this.live = null;
    this.history.push(next);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
