export type InvestigationState = { chapterId: string; nodeId: string; evidence: string[] };
export type Evidence = { title: string; detail: string; recordings?: readonly { clipId: string; label: string }[] };
export type StoryAction = {
  id: string; label: string; next: string; collect?: string;
  requiresEvidence?: readonly string[]; hidesWhenCollected?: string; resetEvidence?: boolean;
  tone?: 'danger';
};
export type StoryNode = {
  kind: 'title' | 'dialogue' | 'investigation' | 'evidence' | 'choice' | 'ending' | 'puzzle';
  text: string; location: string; time: string; actions: readonly StoryAction[];
  progress: number; visual?: string; speaker?: string;
  outcome?: 'failure' | 'complete'; puzzle?: { prompt: string; hint: string };
  requiresEvidence?: readonly string[]; excludesEvidence?: readonly string[];
  scene?: { hotspots?: readonly { id: string; actionId: string; label: string; x: number; y: number }[] };
};
export type InvestigationChapter = {
  id: string; order: number; title: string; entryNode: string;
  nodes: Readonly<Record<string, StoryNode>>; evidence: Readonly<Record<string, Evidence>>;
  requiredEvidence: readonly string[];
};
export type CampaignSession = {
  state: InvestigationState; completed: string[]; archive: Record<string, string[]>;
};
