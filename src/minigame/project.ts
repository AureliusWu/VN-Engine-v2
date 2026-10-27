import type { EngineProject } from '../runtime/project.js';
import type { StageCue } from '../stage/types.js';
import { validateMiniGame } from './session.js';

export function validateProjectMiniGames(project: EngineProject): void {
  const inspect = (cue: StageCue | undefined, context: string, actions?: string[]) => {
    if (!cue?.miniGame) return;
    if (!actions?.length) throw new Error(`Mini-game must bind to a final line with story actions: ${context}`);
    try { validateMiniGame(cue.miniGame, actions); } catch (error) { throw new Error(`${context}: ${String(error)}`); }
  };
  if (project.type === 'script') {
    inspect(project.defaults, 'defaults');
    for (const block of project.program.blocks) {
      const actions = block.exit.type === 'choice' ? block.exit.choices.map(choice => choice.id) : undefined;
      inspect(block.cue, block.id, block.lines.length === 1 ? actions : undefined);
      block.lines.forEach((line, index) => inspect(line.cue, line.id, index === block.lines.length - 1 ? actions : undefined));
    }
  } else if (project.type === 'narrative') {
    inspect(project.stage?.defaults, 'stage.defaults');
    const sceneIds = new Set<string>(), lineIds = new Set<string>();
    for (const scene of project.scenes) {
      const actions = [...(scene.choices ?? []).map(choice => choice.id), ...(scene.continuation ? ['@continue'] : [])];
      sceneIds.add(scene.id); inspect(project.stage?.scenes?.[scene.id], scene.id, scene.lines.length === 1 ? actions : undefined);
      scene.lines.forEach((line, index) => { const id = line.id ?? `${scene.id}/${index}`; lineIds.add(id); inspect(project.stage?.lines?.[id], id, index === scene.lines.length - 1 ? actions : undefined); });
    }
    for (const [id, cue] of Object.entries(project.stage?.scenes ?? {})) if (!sceneIds.has(id)) inspect(cue, id);
    for (const [id, cue] of Object.entries(project.stage?.lines ?? {})) if (!lineIds.has(id)) inspect(cue, id);
  } else if (project.type === 'investigation') {
    inspect(project.stage?.defaults, 'stage.defaults');
    for (const [key, cue] of Object.entries(project.stage?.nodes ?? {})) {
      const chapter = project.chapters.find(chapter => key.startsWith(chapter.id + '/')), node = chapter?.nodes[key.slice(chapter.id.length + 1)];
      inspect(cue, key, node ? [...node.actions.map(action => action.id), ...(node.outcome === 'complete' ? project.chapters.filter(c => c.id !== chapter?.id).map(c => '@chapter:' + c.id) : [])] : undefined);
    }
  } else inspect(project.defaults, 'defaults');
}
