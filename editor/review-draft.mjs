/** Local author form state. It is deliberately separate from review documents and runtime projects. */
const categories = new Set(['story', 'text', 'art', 'music', 'sfx', 'ui', 'other']);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const signature = item => JSON.stringify([item.target, item.comment]);
export const newFeedbackDraft = () => ({ id: '', category: 'text', target: '', comment: '', actor: '作者（自报）' });

export function hasReviewDraft(feedback, notes, review) {
  return !!feedback.id || !!feedback.comment || review.items.some(item => {
    const note = notes.get(item.id); return !!note && (note.note !== (note.savedNote ?? '') || note.evidence !== (note.savedEvidence ?? ''));
  });
}

export function captureReviewDraft(project, review, feedback, notes) {
  const text = newFeedbackDraft();
  for (const key of Object.keys(text)) if (typeof feedback[key] === 'string') text[key] = feedback[key];
  return { schema: 1, game: project.game, storyVersion: project.version, reviewGame: review.game, reviewVersion: review.storyVersion,
    feedback: text, notes: review.items.flatMap(item => {
      const note = notes.get(item.id);
      return note && (note.note || note.evidence) ? [{ id: item.id, item: signature(item), note: note.note, evidence: note.evidence,
        savedNote: note.savedNote ?? '', savedEvidence: note.savedEvidence ?? '' }] : [];
    }) };
}

export function readReviewDraft(input, project, review, targets) {
  const feedback = newFeedbackDraft(), notes = new Map();
  if (!record(input) || input.schema !== 1 || input.game !== project.game || input.storyVersion !== project.version) return { feedback, notes };
  if (record(input.feedback)) {
    for (const key of Object.keys(feedback)) if (typeof input.feedback[key] === 'string') feedback[key] = input.feedback[key];
    if (!categories.has(feedback.category)) feedback.category = 'text';
    if (!targets.includes(feedback.target)) feedback.target = '';
  }
  if (input.reviewGame === review.game && input.reviewVersion === review.storyVersion && Array.isArray(input.notes)) {
    const items = new Map(review.items.map(item => [item.id, item]));
    for (const entry of input.notes) {
      if (!record(entry) || typeof entry.id !== 'string' || typeof entry.note !== 'string' || typeof entry.evidence !== 'string') continue;
      const item = items.get(entry.id);
      if (item && entry.item === signature(item)) notes.set(entry.id, { note: entry.note, evidence: entry.evidence,
        savedNote: typeof entry.savedNote === 'string' ? entry.savedNote : '', savedEvidence: typeof entry.savedEvidence === 'string' ? entry.savedEvidence : '' });
    }
  }
  return { feedback, notes };
}
